import type { D1Database } from '@cloudflare/workers-types';
import type { UsageSummary } from '../shared/api';
import type { Config } from './env';
import { ApiError } from './errors';
import { periodKeys } from './time';

export interface UserLimits {
  id: number;
  daily_limit_seconds: number | null;
  monthly_limit_seconds: number | null;
}

export function effectiveLimits(user: UserLimits, cfg: Config) {
  return {
    daily: user.daily_limit_seconds ?? cfg.defaultDailySeconds,
    monthly: user.monthly_limit_seconds ?? cfg.defaultMonthlySeconds,
  };
}

// Pending events count against the quota so parallel uploads cannot overshoot the limit.
const COUNTED = `status IN ('ok', 'pending')`;

export async function userUsage(db: D1Database, userId: number, day: string, month: string) {
  const row = await db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN kind = 'transcribe' AND day = ?2 THEN audio_seconds END), 0) AS day_seconds,
         COALESCE(SUM(CASE WHEN kind = 'transcribe' THEN audio_seconds END), 0) AS month_seconds,
         COUNT(CASE WHEN kind = 'enhance' AND day = ?2 THEN 1 END) AS enhance_today
       FROM usage_events
       WHERE user_id = ?1 AND month = ?3 AND ${COUNTED}`,
    )
    .bind(userId, day, month)
    .first<{ day_seconds: number; month_seconds: number; enhance_today: number }>();
  return {
    daySeconds: row?.day_seconds ?? 0,
    monthSeconds: row?.month_seconds ?? 0,
    enhanceToday: row?.enhance_today ?? 0,
  };
}

export async function globalUsage(db: D1Database, day: string, month: string) {
  const row = await db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN day = ?1 THEN audio_seconds END), 0) AS day_seconds,
         COALESCE(SUM(audio_seconds), 0) AS month_seconds
       FROM usage_events
       WHERE month = ?2 AND kind = 'transcribe' AND ${COUNTED}`,
    )
    .bind(day, month)
    .first<{ day_seconds: number; month_seconds: number }>();
  return { daySeconds: row?.day_seconds ?? 0, monthSeconds: row?.month_seconds ?? 0 };
}

export async function usageSummary(
  db: D1Database,
  user: UserLimits,
  cfg: Config,
  nowMs: number,
): Promise<UsageSummary> {
  const { day, month } = periodKeys(nowMs, cfg.timeZone);
  const used = await userUsage(db, user.id, day, month);
  const limits = effectiveLimits(user, cfg);
  return {
    daySeconds: round1(used.daySeconds),
    dayLimitSeconds: limits.daily,
    monthSeconds: round1(used.monthSeconds),
    monthLimitSeconds: limits.monthly,
    enhanceToday: used.enhanceToday,
    enhanceDailyLimit: cfg.enhanceDailyLimit,
    day,
    month,
    timeZone: cfg.timeZone,
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function minutes(seconds: number): string {
  const m = seconds / 60;
  return m >= 10 ? `${Math.round(m)}` : `${Math.round(m * 10) / 10}`;
}

/** Throws a friendly error if transcribing `seconds` more audio would exceed any limit. */
export async function assertAudioQuota(
  db: D1Database,
  user: UserLimits,
  cfg: Config,
  seconds: number,
  nowMs: number,
): Promise<void> {
  const { day, month } = periodKeys(nowMs, cfg.timeZone);
  const [mine, all] = await Promise.all([userUsage(db, user.id, day, month), globalUsage(db, day, month)]);
  const limits = effectiveLimits(user, cfg);
  if (mine.daySeconds + seconds > limits.daily) {
    throw new ApiError(
      429,
      'daily_quota_exceeded',
      `You have used ${minutes(mine.daySeconds)} of your ${minutes(limits.daily)} minutes for today. The limit resets at midnight (${cfg.timeZone}).`,
    );
  }
  if (mine.monthSeconds + seconds > limits.monthly) {
    throw new ApiError(
      429,
      'monthly_quota_exceeded',
      `You have used ${minutes(mine.monthSeconds)} of your ${minutes(limits.monthly)} minutes for this month. Ask the site admin if you need more.`,
    );
  }
  if (all.daySeconds + seconds > cfg.globalDailySeconds || all.monthSeconds + seconds > cfg.globalMonthlySeconds) {
    throw new ApiError(
      429,
      'site_quota_exceeded',
      'The site has reached its overall transcription budget for now. Please try again later or tell the site admin.',
    );
  }
}

export async function assertEnhanceQuota(
  db: D1Database,
  userId: number,
  cfg: Config,
  nowMs: number,
): Promise<void> {
  const { day, month } = periodKeys(nowMs, cfg.timeZone);
  const used = await userUsage(db, userId, day, month);
  if (used.enhanceToday >= cfg.enhanceDailyLimit) {
    throw new ApiError(
      429,
      'enhance_quota_exceeded',
      `You have reached today's limit of ${cfg.enhanceDailyLimit} AI clean-ups.`,
    );
  }
}

export async function startUsageEvent(
  db: D1Database,
  params: {
    userId: number;
    kind: 'transcribe' | 'enhance';
    audioSeconds: number;
    keyterms: number;
    cfg: Config;
    nowMs: number;
  },
): Promise<number> {
  const { day, month } = periodKeys(params.nowMs, params.cfg.timeZone);
  const row = await db
    .prepare(
      `INSERT INTO usage_events (user_id, kind, day, month, audio_seconds, keyterms, status, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7) RETURNING id`,
    )
    .bind(
      params.userId,
      params.kind,
      day,
      month,
      params.audioSeconds,
      params.keyterms,
      Math.floor(params.nowMs / 1000),
    )
    .first<{ id: number }>();
  if (!row) throw new Error('Failed to record usage');
  return row.id;
}

export async function finishUsageEvent(
  db: D1Database,
  id: number,
  result: { status: 'ok' | 'error'; audioSeconds?: number; errorCode?: string },
): Promise<void> {
  if (result.status === 'ok') {
    await db
      .prepare(`UPDATE usage_events SET status = 'ok', audio_seconds = COALESCE(?2, audio_seconds) WHERE id = ?1`)
      .bind(id, result.audioSeconds ?? null)
      .run();
  } else {
    await db
      .prepare(`UPDATE usage_events SET status = 'error', audio_seconds = 0, error_code = ?2 WHERE id = ?1`)
      .bind(id, result.errorCode ?? 'unknown')
      .run();
  }
}

/**
 * A pending event this old was interrupted (e.g. the browser disconnected mid-request). The
 * provider may still have billed it, so it keeps counting at its estimated duration.
 */
export async function settleStalePending(db: D1Database, nowSec: number): Promise<void> {
  await db
    .prepare(
      `UPDATE usage_events SET status = 'ok', error_code = 'interrupted'
       WHERE status = 'pending' AND created_at < ?1`,
    )
    .bind(nowSec - 600)
    .run();
}
