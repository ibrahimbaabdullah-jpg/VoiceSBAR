import type { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import {
  normalizeLanguage,
  SBAR_COOLDOWN_SECONDS,
  SbarError,
  validateNotes,
  type SbarResponse,
} from '../../shared/sbar';
import { tr } from '../../shared/sbarI18n';
import { type AppContext, type AppEnv, nowSec, readJson, requireUser } from '../context';
import { ApiError } from '../errors';
import { enforceCooldown, enforceRateLimit } from '../rateLimit';
import { summarize } from '../sbar';

// The real length check is validateNotes (20–6000 characters); this only bounds the parser.
const sbarSchema = z.object({
  notes: z.string().max(24_000),
  language: z.string().optional(),
  consent: z.boolean().optional(),
});

/** HTTP status for each SbarError code; anything else is a 502 from the provider. */
const STATUS: Record<string, ContentfulStatusCode> = {
  sbar_consent: 400,
  sbar_notes_short: 400,
  sbar_notes_long: 400,
  sbar_not_configured: 503,
  sbar_auth: 503,
  sbar_forbidden: 503,
  sbar_model: 503,
  sbar_rejected: 503,
  sbar_quota: 503,
};
/** The browser never retries on its own (one Gemini call per click); this only labels the error. */
const RETRYABLE = new Set(['sbar_timeout', 'sbar_unreachable', 'sbar_unavailable', 'sbar_incomplete', 'sbar_unverified']);

async function handoff(c: AppContext, body: z.infer<typeof sbarSchema>): Promise<SbarResponse> {
  const language = normalizeLanguage(body.language);
  const cfg = c.get('cfg');
  const db = c.env.DB;
  const userId = c.get('user').id;

  // Same order as app.py: nothing is spent (cooldown, quota, provider call) on input that fails.
  if (body.consent !== true) {
    throw new SbarError('sbar_consent', 'أكد أولًا أن الملاحظات تخص حالة وهمية وأنك توافق على إرسالها.');
  }
  const notes = validateNotes(body.notes);
  if (!cfg.gemini.apiKey) {
    throw new SbarError('sbar_not_configured', 'مفتاح Gemini غير مهيّأ. أضفه من إعدادات الاتصال.');
  }
  await enforceCooldown(
    db,
    `sbar-cooldown:${userId}`,
    SBAR_COOLDOWN_SECONDS,
    nowSec(c),
    tr('انتظر عشر ثوانٍ بين محاولات التلخيص للحفاظ على الحصة المتاحة.', language),
  );
  await enforceRateLimit(
    db,
    `sbar-day:${userId}`,
    cfg.sbarDailyLimit,
    86_400,
    nowSec(c),
    tr('وصلت إلى الحد اليومي لتقارير SBAR. حاول مجددًا غدًا.', language),
  );
  const report = await summarize({
    fetch: c.get('deps').fetch,
    baseUrl: cfg.gemini.baseUrl,
    apiKey: cfg.gemini.apiKey,
    model: cfg.gemini.model,
    notes,
    language,
  });
  return { report, language, model: cfg.gemini.model };
}

export function registerSbarRoutes(app: Hono<AppEnv>) {
  // Notes and reports pass through memory only: nothing here writes them to D1 or to logs.
  app.post('/sbar', requireUser, async (c) => {
    const body = await readJson(c, sbarSchema);
    try {
      return c.json(await handoff(c, body));
    } catch (err) {
      if (err instanceof SbarError) {
        throw new ApiError(STATUS[err.code] ?? 502, err.code, tr(err.message, normalizeLanguage(body.language)), {
          retryable: RETRYABLE.has(err.code),
        });
      }
      throw err;
    }
  });
}
