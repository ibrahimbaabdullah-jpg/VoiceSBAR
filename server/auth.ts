import type { D1Database } from '@cloudflare/workers-types';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { PublicUser, Role } from '../shared/api';
import { hashSecret, randomToken } from './crypto';

export const SESSION_COOKIE = 'wtc_session';

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: Role;
  disabled: number;
  daily_limit_seconds: number | null;
  monthly_limit_seconds: number | null;
  enhance_allowed: number;
  created_at: number;
  last_login_at: number | null;
}

export function publicUser(u: UserRow): PublicUser {
  return { id: u.id, username: u.username, role: u.role, enhanceAllowed: u.enhance_allowed === 1 };
}

export async function findUserByName(db: D1Database, username: string): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE username = ?1').bind(username).first<UserRow>();
}

export async function findUserById(db: D1Database, id: number): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE id = ?1').bind(id).first<UserRow>();
}

export async function countAdmins(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

function isHttps(c: Context): boolean {
  return new URL(c.req.url).protocol === 'https:';
}

/** Creates a session row and sets the HttpOnly cookie. Only the token's hash is stored. */
export async function startSession(c: Context, db: D1Database, userId: number, nowSec: number, ttlSec: number) {
  const token = randomToken(32);
  await db
    .prepare(
      `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at)
       VALUES (?1, ?2, ?3, ?4, ?3)`,
    )
    .bind(await hashSecret(token), userId, nowSec, nowSec + ttlSec)
    .run();
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isHttps(c),
    sameSite: 'Strict',
    path: '/',
    maxAge: ttlSec,
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: isHttps(c), httpOnly: true, sameSite: 'Strict' });
}

interface SessionJoinRow extends UserRow {
  token_hash: string;
  expires_at: number;
  last_seen_at: number;
}

/**
 * Resolves the signed-in user from the session cookie. Sessions slide: when more than half the
 * lifetime has passed, the expiry is pushed forward and the cookie is re-issued.
 */
export async function loadSessionUser(
  c: Context,
  db: D1Database,
  nowSec: number,
  ttlSec: number,
): Promise<{ user: UserRow; tokenHash: string } | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token || token.length > 128) return null;
  const tokenHash = await hashSecret(token);
  const row = await db
    .prepare(
      `SELECT u.*, s.token_hash, s.expires_at, s.last_seen_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?1`,
    )
    .bind(tokenHash)
    .first<SessionJoinRow>();
  if (!row) return null;
  if (row.expires_at <= nowSec || row.disabled) {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(tokenHash).run();
    return null;
  }
  if (row.expires_at - nowSec < ttlSec / 2) {
    await db
      .prepare('UPDATE sessions SET expires_at = ?2, last_seen_at = ?3 WHERE token_hash = ?1')
      .bind(tokenHash, nowSec + ttlSec, nowSec)
      .run();
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure: isHttps(c),
      sameSite: 'Strict',
      path: '/',
      maxAge: ttlSec,
    });
  } else if (nowSec - row.last_seen_at > 3600) {
    await db.prepare('UPDATE sessions SET last_seen_at = ?2 WHERE token_hash = ?1').bind(tokenHash, nowSec).run();
  }
  const { token_hash: _t, expires_at: _e, last_seen_at: _l, ...user } = row;
  return { user, tokenHash };
}

export function clientIp(c: Context): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-real-ip') ?? 'unknown';
}
