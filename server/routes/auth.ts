import type { Hono } from 'hono';
import { z } from 'zod';
import type { SetupStatus } from '../../shared/api';
import { APP_VERSION, PASSWORD_KEY_PATTERN, USERNAME_HINT, USERNAME_PATTERN } from '../../shared/rules';
import {
  clearSessionCookie,
  findUserByName,
  publicUser,
  startSession,
  clientIp,
  type UserRow,
} from '../auth';
import { type AppEnv, nowSec, readJson, requireUser } from '../context';
import { hashPasswordKey, hashSecret, normalizeCode, secretsEqual, verifyPasswordKey } from '../crypto';
import { ApiError, badRequest } from '../errors';
import { enforceRateLimit, pruneRateLimits } from '../rateLimit';
import { settleStalePending } from '../usage';

const passwordKey = z.string().regex(PASSWORD_KEY_PATTERN, 'Invalid password key.');
const username = z.string().trim().regex(USERNAME_PATTERN, USERNAME_HINT);

const loginSchema = z.object({ username: z.string().trim().min(1).max(64), passwordKey });
const registerSchema = z.object({ code: z.string().trim().min(4).max(200), username, passwordKey });
const resetSchema = z.object({ code: z.string().trim().min(4).max(200), username: z.string().trim().min(1).max(64), passwordKey });
const changeSchema = z.object({ currentKey: passwordKey, newKey: passwordKey });

// Used when the username does not exist so a failed login takes the same time either way.
const DUMMY_HASH = 'v1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const invalidCode = () =>
  new ApiError(400, 'invalid_code', 'This code is not valid, was already used, or has expired.');

interface InviteRow {
  id: number;
  kind: 'signup' | 'reset';
  role: 'admin' | 'user';
  target_user_id: number | null;
  daily_limit_seconds: number | null;
  monthly_limit_seconds: number | null;
}

async function claimInvite(c: { env: AppEnv['Bindings'] }, code: string, kind: 'signup' | 'reset', now: number) {
  const db = c.env.DB;
  const invite = await db
    .prepare(
      `SELECT id, kind, role, target_user_id, daily_limit_seconds, monthly_limit_seconds
       FROM invites WHERE code_hash = ?1 AND kind = ?2 AND used_at IS NULL AND expires_at > ?3`,
    )
    .bind(await hashSecret(normalizeCode(code)), kind, now)
    .first<InviteRow>();
  if (!invite) return null;
  // Claim atomically so the same code cannot be used twice by parallel requests.
  const claimed = await db
    .prepare('UPDATE invites SET used_at = ?2 WHERE id = ?1 AND used_at IS NULL')
    .bind(invite.id, now)
    .run();
  return claimed.meta.changes === 1 ? invite : null;
}

async function releaseInvite(db: AppEnv['Bindings']['DB'], id: number) {
  await db.prepare('UPDATE invites SET used_at = NULL, used_by = NULL WHERE id = ?1').bind(id).run();
}

export function registerAuthRoutes(app: Hono<AppEnv>) {
  app.post('/auth/login', async (c) => {
    const body = await readJson(c, loginSchema);
    const db = c.env.DB;
    const now = nowSec(c);
    const ip = clientIp(c);
    if (Math.random() < 0.05) {
      await pruneRateLimits(db, now);
      await settleStalePending(db, now);
    }
    await enforceRateLimit(db, `login:ip:${ip}`, 20, 900, now, 'Too many sign-in attempts. Please wait a few minutes.');
    await enforceRateLimit(
      db,
      `login:user:${body.username.toLowerCase()}`,
      10,
      900,
      now,
      'Too many sign-in attempts for this account. Please wait a few minutes.',
    );

    const user = await findUserByName(db, body.username);
    const ok = await verifyPasswordKey(body.passwordKey, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok) {
      throw new ApiError(401, 'invalid_credentials', 'Wrong username or password.');
    }
    if (user.disabled) {
      throw new ApiError(403, 'account_disabled', 'This account is disabled. Please contact the site admin.');
    }
    await db.prepare('UPDATE users SET last_login_at = ?2 WHERE id = ?1').bind(user.id, now).run();
    await startSession(c, db, user.id, now, c.get('cfg').sessionSeconds);
    return c.json({ user: publicUser(user) });
  });

  app.post('/auth/register', async (c) => {
    const body = await readJson(c, registerSchema);
    const db = c.env.DB;
    const cfg = c.get('cfg');
    const now = nowSec(c);
    await enforceRateLimit(db, `register:ip:${clientIp(c)}`, 10, 3600, now);

    if (await findUserByName(db, body.username)) {
      throw new ApiError(409, 'username_taken', 'That username is already taken. Please choose another.');
    }

    const passwordHash = await hashPasswordKey(body.passwordKey);

    // First-run: the ADMIN_SETUP_CODE secret creates the first admin, and only while none exists.
    if (cfg.adminSetupCode && (await secretsEqual(body.code, cfg.adminSetupCode))) {
      const adminCount = await db
        .prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin'`)
        .first<{ n: number }>();
      if ((adminCount?.n ?? 0) > 0) throw invalidCode();
      const user = await db
        .prepare(
          `INSERT INTO users (username, password_hash, role, created_at, last_login_at)
           VALUES (?1, ?2, 'admin', ?3, ?3) RETURNING *`,
        )
        .bind(body.username, passwordHash, now)
        .first<UserRow>();
      if (!user) throw new Error('Failed to create admin');
      await startSession(c, db, user.id, now, cfg.sessionSeconds);
      return c.json({ user: publicUser(user) }, 201);
    }

    const invite = await claimInvite(c, body.code, 'signup', now);
    if (!invite) throw invalidCode();
    let user: UserRow | null;
    try {
      user = await db
        .prepare(
          `INSERT INTO users (username, password_hash, role, daily_limit_seconds, monthly_limit_seconds, created_at, last_login_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6) RETURNING *`,
        )
        .bind(
          body.username,
          passwordHash,
          invite.role,
          invite.daily_limit_seconds,
          invite.monthly_limit_seconds,
          now,
        )
        .first<UserRow>();
    } catch (err) {
      await releaseInvite(db, invite.id);
      if (String(err).includes('UNIQUE')) {
        throw new ApiError(409, 'username_taken', 'That username is already taken. Please choose another.');
      }
      throw err;
    }
    if (!user) throw new Error('Failed to create user');
    await db.prepare('UPDATE invites SET used_by = ?2 WHERE id = ?1').bind(invite.id, user.id).run();
    await startSession(c, db, user.id, now, cfg.sessionSeconds);
    return c.json({ user: publicUser(user) }, 201);
  });

  app.post('/auth/reset', async (c) => {
    const body = await readJson(c, resetSchema);
    const db = c.env.DB;
    const now = nowSec(c);
    await enforceRateLimit(db, `reset:ip:${clientIp(c)}`, 10, 3600, now);

    const user = await findUserByName(db, body.username);
    if (!user) throw invalidCode();
    const invite = await claimInvite(c, body.code, 'reset', now);
    if (!invite) throw invalidCode();
    if (invite.target_user_id !== user.id) {
      await releaseInvite(db, invite.id);
      throw invalidCode();
    }
    if (user.disabled) {
      throw new ApiError(403, 'account_disabled', 'This account is disabled. Please contact the site admin.');
    }
    await db.batch([
      db
        .prepare('UPDATE users SET password_hash = ?2, last_login_at = ?3 WHERE id = ?1')
        .bind(user.id, await hashPasswordKey(body.passwordKey), now),
      db.prepare('UPDATE invites SET used_by = ?2 WHERE id = ?1').bind(invite.id, user.id),
      db.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(user.id),
    ]);
    await startSession(c, db, user.id, now, c.get('cfg').sessionSeconds);
    return c.json({ user: publicUser(user) });
  });

  app.post('/auth/logout', requireUser, async (c) => {
    await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(c.get('sessionHash')).run();
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  app.post('/auth/logout-all', requireUser, async (c) => {
    await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(c.get('user').id).run();
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  app.post('/auth/change-password', requireUser, async (c) => {
    const body = await readJson(c, changeSchema);
    const db = c.env.DB;
    const user = c.get('user');
    await enforceRateLimit(db, `change-password:${user.id}`, 10, 3600, nowSec(c));
    if (!(await verifyPasswordKey(body.currentKey, user.password_hash))) {
      throw new ApiError(400, 'wrong_password', 'Your current password is not correct.');
    }
    if (body.currentKey === body.newKey) throw badRequest('The new password must be different.');
    await db.batch([
      db.prepare('UPDATE users SET password_hash = ?2 WHERE id = ?1').bind(user.id, await hashPasswordKey(body.newKey)),
      // Sign out every other device; this one stays signed in.
      db.prepare('DELETE FROM sessions WHERE user_id = ?1 AND token_hash != ?2').bind(user.id, c.get('sessionHash')),
    ]);
    return c.json({ ok: true });
  });

  app.get('/setup-status', async (c) => {
    const admins = await c.env.DB
      .prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin'`)
      .first<{ n: number }>();
    const status: SetupStatus = {
      needsSetup: (admins?.n ?? 0) === 0,
      setupCodeConfigured: Boolean(c.get('cfg').adminSetupCode),
      version: APP_VERSION,
    };
    return c.json(status);
  });
}
