import type { Hono } from 'hono';
import { z } from 'zod';
import type { AdminInviteRow, AdminOverview, AdminUserRow, CreatedCode } from '../../shared/api';
import { countAdmins, findUserById, type UserRow } from '../auth';
import { type AppEnv, nowSec, parseId, readJson, requireAdmin, requireUser } from '../context';
import { generateCode, hashSecret, normalizeCode } from '../crypto';
import { ApiError, badRequest } from '../errors';
import { periodKeys } from '../time';
import { effectiveLimits, globalUsage } from '../usage';

const minutesField = z.number().min(0).max(100_000).nullable().optional();

const patchUserSchema = z.object({
  disabled: z.boolean().optional(),
  role: z.enum(['admin', 'user']).optional(),
  enhanceAllowed: z.boolean().optional(),
  dailyLimitMinutes: minutesField,
  monthlyLimitMinutes: minutesField,
});

const createInviteSchema = z.object({
  role: z.enum(['admin', 'user']).default('user'),
  dailyLimitMinutes: minutesField,
  monthlyLimitMinutes: minutesField,
  expiresInDays: z.number().int().min(1).max(30).default(7),
  note: z.string().trim().max(200).optional(),
});

const toSeconds = (m: number | null | undefined) => (m === null || m === undefined ? null : Math.round(m * 60));

export function registerAdminRoutes(app: Hono<AppEnv>) {
  app.use('/admin/*', requireUser, requireAdmin);

  app.get('/admin/overview', async (c) => {
    const cfg = c.get('cfg');
    const db = c.env.DB;
    const { day, month } = periodKeys(c.get('nowMs'), cfg.timeZone);
    const totals = await globalUsage(db, day, month);
    const stats = await db
      .prepare(
        `SELECT
           COUNT(CASE WHEN kind = 'transcribe' AND day = ?1 THEN 1 END) AS day_requests,
           COUNT(CASE WHEN kind = 'transcribe' AND day = ?1 AND status = 'error' THEN 1 END) AS day_errors,
           COUNT(CASE WHEN kind = 'enhance' AND status != 'error' THEN 1 END) AS month_enhance,
           COALESCE(SUM(CASE WHEN kind = 'transcribe' AND keyterms > 0 AND status != 'error' THEN audio_seconds END), 0) AS keyterm_seconds
         FROM usage_events WHERE month = ?2`,
      )
      .bind(day, month)
      .first<{ day_requests: number; day_errors: number; month_enhance: number; keyterm_seconds: number }>();
    const users = await db.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
    const keytermSeconds = stats?.keyterm_seconds ?? 0;
    const cost =
      (totals.monthSeconds / 3600) * cfg.pricing.audioPerHourUsd +
      (keytermSeconds / 3600) * cfg.pricing.keytermsPerHourUsd;
    const body: AdminOverview = {
      day,
      month,
      timeZone: cfg.timeZone,
      dayAudioSeconds: Math.round(totals.daySeconds),
      monthAudioSeconds: Math.round(totals.monthSeconds),
      monthKeytermSeconds: Math.round(keytermSeconds),
      dayRequests: stats?.day_requests ?? 0,
      dayErrors: stats?.day_errors ?? 0,
      monthEnhanceRequests: stats?.month_enhance ?? 0,
      globalDailyLimitSeconds: cfg.globalDailySeconds,
      globalMonthlyLimitSeconds: cfg.globalMonthlySeconds,
      estimatedMonthCostUsd: Math.round(cost * 100) / 100,
      users: users?.n ?? 0,
      providers: {
        elevenlabsConfigured: Boolean(cfg.elevenlabs.apiKey),
        enhancementConfigured: Boolean(cfg.enhance.apiKey),
        enhanceModel: cfg.enhance.model,
      },
    };
    return c.json(body);
  });

  app.get('/admin/users', async (c) => {
    const cfg = c.get('cfg');
    const { day, month } = periodKeys(c.get('nowMs'), cfg.timeZone);
    const rows = await c.env.DB
      .prepare(
        `SELECT u.*,
           COALESCE(SUM(CASE WHEN e.day = ?1 THEN e.audio_seconds END), 0) AS day_seconds,
           COALESCE(SUM(e.audio_seconds), 0) AS month_seconds
         FROM users u
         LEFT JOIN usage_events e
           ON e.user_id = u.id AND e.month = ?2 AND e.kind = 'transcribe' AND e.status IN ('ok', 'pending')
         GROUP BY u.id
         ORDER BY u.created_at`,
      )
      .bind(day, month)
      .all<UserRow & { day_seconds: number; month_seconds: number }>();
    const users: AdminUserRow[] = rows.results.map((u) => {
      const limits = effectiveLimits(u, cfg);
      return {
        id: u.id,
        username: u.username,
        role: u.role,
        disabled: u.disabled === 1,
        enhanceAllowed: u.enhance_allowed === 1,
        dailyLimitSeconds: limits.daily,
        monthlyLimitSeconds: limits.monthly,
        customDailyLimit: u.daily_limit_seconds !== null,
        customMonthlyLimit: u.monthly_limit_seconds !== null,
        daySeconds: Math.round(u.day_seconds),
        monthSeconds: Math.round(u.month_seconds),
        createdAt: u.created_at,
        lastLoginAt: u.last_login_at,
      };
    });
    return c.json({ users });
  });

  app.patch('/admin/users/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    const body = await readJson(c, patchUserSchema);
    const db = c.env.DB;
    const me = c.get('user');
    const target = await findUserById(db, id);
    if (!target) throw new ApiError(404, 'not_found', 'User not found.');

    const removesAdmin =
      target.role === 'admin' && !target.disabled && (body.disabled === true || body.role === 'user');
    if (removesAdmin) {
      if (target.id === me.id) throw badRequest('You cannot disable or demote your own account.');
      if ((await countAdmins(db)) <= 1) throw badRequest('There must always be at least one active admin.');
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    const set = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = ?${values.length + 1}`);
    };
    if (body.disabled !== undefined) set('disabled', body.disabled ? 1 : 0);
    if (body.role !== undefined) set('role', body.role);
    if (body.enhanceAllowed !== undefined) set('enhance_allowed', body.enhanceAllowed ? 1 : 0);
    if (body.dailyLimitMinutes !== undefined) set('daily_limit_seconds', toSeconds(body.dailyLimitMinutes));
    if (body.monthlyLimitMinutes !== undefined) set('monthly_limit_seconds', toSeconds(body.monthlyLimitMinutes));
    if (!sets.length) throw badRequest('Nothing to change.');

    const statements = [db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?1`).bind(id, ...values)];
    if (body.disabled) statements.push(db.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(id));
    await db.batch(statements);
    return c.json({ ok: true });
  });

  app.delete('/admin/users/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    const db = c.env.DB;
    if (id === c.get('user').id) throw badRequest('You cannot delete your own account.');
    const target = await findUserById(db, id);
    if (!target) throw new ApiError(404, 'not_found', 'User not found.');
    if (target.role === 'admin' && !target.disabled && (await countAdmins(db)) <= 1) {
      throw badRequest('There must always be at least one active admin.');
    }
    // Sessions, vocabulary and reset codes cascade; usage rows keep counting toward site totals.
    await db.prepare('DELETE FROM users WHERE id = ?1').bind(id).run();
    return c.json({ ok: true });
  });

  app.post('/admin/users/:id/reset-code', async (c) => {
    const id = parseId(c.req.param('id'));
    const db = c.env.DB;
    const target = await findUserById(db, id);
    if (!target) throw new ApiError(404, 'not_found', 'User not found.');
    const now = nowSec(c);
    const code = generateCode('RST');
    const expiresAt = now + 3 * 86400;
    await db.batch([
      // Only the newest reset code for a user is valid.
      db.prepare(`DELETE FROM invites WHERE kind = 'reset' AND target_user_id = ?1 AND used_at IS NULL`).bind(id),
      db
        .prepare(
          `INSERT INTO invites (code_hash, kind, role, target_user_id, created_by, created_at, expires_at)
           VALUES (?1, 'reset', 'user', ?2, ?3, ?4, ?5)`,
        )
        .bind(await hashSecret(normalizeCode(code)), id, c.get('user').id, now, expiresAt),
    ]);
    const body: CreatedCode = { code, expiresAt };
    return c.json(body, 201);
  });

  app.get('/admin/invites', async (c) => {
    const rows = await c.env.DB
      .prepare(
        `SELECT i.*, t.username AS target_username, u.username AS used_by_username
         FROM invites i
         LEFT JOIN users t ON t.id = i.target_user_id
         LEFT JOIN users u ON u.id = i.used_by
         ORDER BY i.created_at DESC, i.id DESC
         LIMIT 100`,
      )
      .all<{
        id: number;
        kind: 'signup' | 'reset';
        role: 'admin' | 'user';
        note: string | null;
        daily_limit_seconds: number | null;
        monthly_limit_seconds: number | null;
        created_at: number;
        expires_at: number;
        used_at: number | null;
        target_username: string | null;
        used_by_username: string | null;
      }>();
    const invites: AdminInviteRow[] = rows.results.map((r) => ({
      id: r.id,
      kind: r.kind,
      role: r.role,
      targetUsername: r.target_username,
      note: r.note,
      dailyLimitSeconds: r.daily_limit_seconds,
      monthlyLimitSeconds: r.monthly_limit_seconds,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      usedAt: r.used_at,
      usedByUsername: r.used_by_username,
    }));
    return c.json({ invites });
  });

  app.post('/admin/invites', async (c) => {
    const body = await readJson(c, createInviteSchema);
    const now = nowSec(c);
    const code = generateCode('WTC');
    const expiresAt = now + body.expiresInDays * 86400;
    await c.env.DB
      .prepare(
        `INSERT INTO invites (code_hash, kind, role, daily_limit_seconds, monthly_limit_seconds, note, created_by, created_at, expires_at)
         VALUES (?1, 'signup', ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(
        await hashSecret(normalizeCode(code)),
        body.role,
        toSeconds(body.dailyLimitMinutes),
        toSeconds(body.monthlyLimitMinutes),
        body.note || null,
        c.get('user').id,
        now,
        expiresAt,
      )
      .run();
    const created: CreatedCode = { code, expiresAt };
    return c.json(created, 201);
  });

  app.delete('/admin/invites/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    const res = await c.env.DB.prepare('DELETE FROM invites WHERE id = ?1 AND used_at IS NULL').bind(id).run();
    if (res.meta.changes !== 1) throw new ApiError(404, 'not_found', 'Unused code not found.');
    return c.json({ ok: true });
  });
}
