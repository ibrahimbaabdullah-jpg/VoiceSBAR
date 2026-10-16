import type { D1Database } from '@cloudflare/workers-types';
import { DEFAULT_GEMINI_BASE_URL, DEFAULT_GEMINI_MODEL } from './sbar';

/** Bindings available to the Pages Functions. Secrets are set in Cloudflare, never committed. */
export interface Env {
  DB: D1Database;

  // Secrets
  ELEVENLABS_API_KEY?: string;
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
  ADMIN_SETUP_CODE?: string;

  // Plain variables (see wrangler.toml)
  ELEVENLABS_BASE_URL?: string;
  ELEVENLABS_MODEL_ID?: string;
  ELEVENLABS_ZERO_RETENTION?: string;
  ENHANCE_BASE_URL?: string;
  ENHANCE_MODEL?: string;
  ENHANCE_REASONING_EFFORT?: string;
  GEMINI_BASE_URL?: string;
  GEMINI_MODEL?: string;
  SBAR_DAILY_LIMIT?: string;
  DEFAULT_DAILY_LIMIT_MINUTES?: string;
  DEFAULT_MONTHLY_LIMIT_MINUTES?: string;
  GLOBAL_DAILY_LIMIT_MINUTES?: string;
  GLOBAL_MONTHLY_LIMIT_MINUTES?: string;
  MAX_RECORDING_SECONDS?: string;
  MAX_UPLOAD_MB?: string;
  TRANSCRIBE_PER_MINUTE?: string;
  ENHANCE_DAILY_LIMIT?: string;
  ALLOW_KEYTERMS?: string;
  USAGE_TIME_ZONE?: string;
  SESSION_DAYS?: string;
  PRICE_AUDIO_PER_HOUR_USD?: string;
  PRICE_KEYTERMS_PER_HOUR_USD?: string;
}

export interface Config {
  elevenlabs: {
    apiKey: string | null;
    baseUrl: string;
    modelId: string;
    zeroRetention: boolean;
  };
  enhance: {
    apiKey: string | null;
    baseUrl: string;
    model: string;
    reasoningEffort: string | null;
  };
  gemini: {
    apiKey: string | null;
    baseUrl: string;
    model: string;
  };
  sbarDailyLimit: number;
  adminSetupCode: string | null;
  defaultDailySeconds: number;
  defaultMonthlySeconds: number;
  globalDailySeconds: number;
  globalMonthlySeconds: number;
  maxRecordingSeconds: number;
  maxUploadBytes: number;
  transcribePerMinute: number;
  enhanceDailyLimit: number;
  allowKeyterms: boolean;
  timeZone: string;
  sessionSeconds: number;
  pricing: { audioPerHourUsd: number; keytermsPerHourUsd: number };
}

function num(value: string | undefined, fallback: number, min = 0): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function secret(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

function validTimeZone(tz: string | undefined): string {
  const candidate = tz?.trim() || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return candidate;
  } catch {
    return 'UTC';
  }
}

export function loadConfig(env: Env): Config {
  return {
    elevenlabs: {
      apiKey: secret(env.ELEVENLABS_API_KEY),
      baseUrl: (env.ELEVENLABS_BASE_URL?.trim() || 'https://api.elevenlabs.io').replace(/\/+$/, ''),
      modelId: env.ELEVENLABS_MODEL_ID?.trim() || 'scribe_v2',
      zeroRetention: bool(env.ELEVENLABS_ZERO_RETENTION, false),
    },
    enhance: {
      apiKey: secret(env.OPENAI_API_KEY),
      baseUrl: (env.ENHANCE_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, ''),
      model: env.ENHANCE_MODEL?.trim() || 'gpt-6-luna',
      reasoningEffort:
        env.ENHANCE_REASONING_EFFORT === undefined
          ? 'none'
          : env.ENHANCE_REASONING_EFFORT.trim() || null,
    },
    gemini: {
      apiKey: secret(env.GEMINI_API_KEY),
      baseUrl: (env.GEMINI_BASE_URL?.trim() || DEFAULT_GEMINI_BASE_URL).replace(/\/+$/, ''),
      model: env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
    },
    sbarDailyLimit: Math.round(num(env.SBAR_DAILY_LIMIT, 50, 1)),
    adminSetupCode: secret(env.ADMIN_SETUP_CODE),
    defaultDailySeconds: Math.round(num(env.DEFAULT_DAILY_LIMIT_MINUTES, 30) * 60),
    defaultMonthlySeconds: Math.round(num(env.DEFAULT_MONTHLY_LIMIT_MINUTES, 300) * 60),
    globalDailySeconds: Math.round(num(env.GLOBAL_DAILY_LIMIT_MINUTES, 180) * 60),
    globalMonthlySeconds: Math.round(num(env.GLOBAL_MONTHLY_LIMIT_MINUTES, 1500) * 60),
    maxRecordingSeconds: Math.round(num(env.MAX_RECORDING_SECONDS, 300, 5)),
    maxUploadBytes: Math.round(num(env.MAX_UPLOAD_MB, 25, 1) * 1024 * 1024),
    transcribePerMinute: Math.round(num(env.TRANSCRIBE_PER_MINUTE, 10, 1)),
    enhanceDailyLimit: Math.round(num(env.ENHANCE_DAILY_LIMIT, 200)),
    allowKeyterms: bool(env.ALLOW_KEYTERMS, true),
    timeZone: validTimeZone(env.USAGE_TIME_ZONE),
    sessionSeconds: Math.round(num(env.SESSION_DAYS, 30, 1) * 86400),
    pricing: {
      audioPerHourUsd: num(env.PRICE_AUDIO_PER_HOUR_USD, 0.22),
      keytermsPerHourUsd: num(env.PRICE_KEYTERMS_PER_HOUR_USD, 0.05),
    },
  };
}
