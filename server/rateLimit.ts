import type { D1Database } from '@cloudflare/workers-types';
import { tooManyRequests } from './errors';

/**
 * Fixed-window counter stored in D1. One atomic UPSERT per check, which is plenty for a
 * small group of users and needs no paid Cloudflare features.
 */
export async function hitRateLimit(
  db: D1Database,
  key: string,
  limit: number,
  windowSeconds: number,
  nowSec: number,
): Promise<{ allowed: boolean; retryAfter: number; count: number }> {
  const windowStart = nowSec - (nowSec % windowSeconds);
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN rate_limits.window_start = excluded.window_start
                      THEN rate_limits.count + 1 ELSE 1 END,
         window_start = excluded.window_start
       RETURNING count`,
    )
    .bind(key, windowStart)
    .first<{ count: number }>();
  const count = row?.count ?? 1;
  return {
    allowed: count <= limit,
    retryAfter: Math.max(1, windowStart + windowSeconds - nowSec),
    count,
  };
}

export async function enforceRateLimit(
  db: D1Database,
  key: string,
  limit: number,
  windowSeconds: number,
  nowSec: number,
  message?: string,
): Promise<void> {
  const res = await hitRateLimit(db, key, limit, windowSeconds, nowSec);
  if (!res.allowed) throw tooManyRequests(res.retryAfter, message);
}

/** Drops counters from old windows. Called opportunistically so the table stays tiny. */
export async function pruneRateLimits(db: D1Database, nowSec: number): Promise<void> {
  await db.prepare('DELETE FROM rate_limits WHERE window_start < ?1').bind(nowSec - 86400).run();
}

/**
 * A true cooldown (not a fixed window): allows one request per `seconds`, measured from the last
 * allowed request. The check and the update are one atomic UPSERT, so parallel requests cannot
 * both pass.
 */
export async function enforceCooldown(
  db: D1Database,
  key: string,
  seconds: number,
  nowSec: number,
  message?: string,
): Promise<void> {
  const allowed = await db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT (key) DO UPDATE SET window_start = excluded.window_start, count = rate_limits.count + 1
         WHERE excluded.window_start - rate_limits.window_start >= ?3
       RETURNING window_start`,
    )
    .bind(key, nowSec, seconds)
    .first<{ window_start: number }>();
  if (allowed) return;
  const last = await db
    .prepare('SELECT window_start FROM rate_limits WHERE key = ?1')
    .bind(key)
    .first<{ window_start: number }>();
  throw tooManyRequests(Math.max(1, (last?.window_start ?? nowSec) + seconds - nowSec), message);
}
