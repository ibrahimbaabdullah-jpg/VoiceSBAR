import type { Hono } from 'hono';
import { z } from 'zod';
import type {
  EnhanceResponse,
  EnhancementResult,
  MeResponse,
  TranscribeResponse,
  VocabularyResponse,
} from '../../shared/api';
import { checkKeytermList, ENHANCE_MAX_CHARS, LANGUAGE_HINTS } from '../../shared/rules';
import { publicUser, type UserRow } from '../auth';
import { type AppContext, type AppEnv, nowSec, readJson, requireUser } from '../context';
import { enhanceSafely } from '../enhance';
import { transcribeWithScribe } from '../elevenlabs';
import { ApiError, badRequest } from '../errors';
import { enforceRateLimit } from '../rateLimit';
import {
  assertAudioQuota,
  assertEnhanceQuota,
  finishUsageEvent,
  startUsageEvent,
  usageSummary,
} from '../usage';

const MIN_AUDIO_BYTES = 500;
/** Upper bound on audio bitrate (384 kbit/s) used to estimate duration from upload size. */
const MAX_BYTES_PER_SECOND = 48_000;

const ACCEPTED_TYPES = /^(audio\/[a-z0-9.+-]+|video\/(webm|mp4))(;.*)?$/i;

const flag = z
  .enum(['0', '1', 'true', 'false'])
  .optional()
  .transform((v) => v === '1' || v === 'true');

const transcribeQuery = z.object({
  duration: z.coerce.number().positive().max(36_000),
  language: z.enum(LANGUAGE_HINTS).optional().default('auto'),
  enhance: flag,
  keyterms: flag,
  noVerbatim: flag,
});

const enhanceSchema = z.object({ text: z.string().min(1).max(ENHANCE_MAX_CHARS) });
const vocabularySchema = z.object({ terms: z.array(z.string().max(500)).max(1000) });

async function loadTerms(c: AppContext, userId: number): Promise<string[]> {
  const rows = await c.env.DB
    .prepare('SELECT term FROM vocabulary WHERE user_id = ?1 ORDER BY position')
    .bind(userId)
    .all<{ term: string }>();
  return rows.results.map((r) => r.term);
}

/** Checks whether this user may use AI clean-up right now; returns a reason when not. */
async function enhancementBlocker(c: AppContext, user: UserRow, text: string): Promise<EnhancementResult | null> {
  const cfg = c.get('cfg');
  if (!cfg.enhance.apiKey) {
    return { status: 'unavailable', message: 'AI clean-up is not set up on this site.' };
  }
  if (user.enhance_allowed !== 1) {
    return { status: 'unavailable', message: 'AI clean-up is turned off for your account.' };
  }
  if (text.length > ENHANCE_MAX_CHARS) {
    return { status: 'unavailable', message: 'The text is too long for AI clean-up.' };
  }
  try {
    await assertEnhanceQuota(c.env.DB, user.id, cfg, c.get('nowMs'));
  } catch (err) {
    if (err instanceof ApiError) return { status: 'unavailable', message: err.message };
    throw err;
  }
  return null;
}

async function runEnhancement(c: AppContext, user: UserRow, text: string) {
  const cfg = c.get('cfg');
  const db = c.env.DB;
  const eventId = await startUsageEvent(db, {
    userId: user.id,
    kind: 'enhance',
    audioSeconds: 0,
    keyterms: 0,
    cfg,
    nowMs: c.get('nowMs'),
  });
  const outcome = await enhanceSafely({
    fetch: c.get('deps').fetch,
    baseUrl: cfg.enhance.baseUrl,
    apiKey: cfg.enhance.apiKey!,
    model: cfg.enhance.model,
    reasoningEffort: cfg.enhance.reasoningEffort,
    text,
  });
  await finishUsageEvent(
    db,
    eventId,
    outcome.providerCalled ? { status: 'ok' } : { status: 'error', errorCode: 'enhance_unreachable' },
  );
  return outcome;
}

export function registerDictationRoutes(app: Hono<AppEnv>) {
  app.get('/me', requireUser, async (c) => {
    const cfg = c.get('cfg');
    const user = c.get('user');
    const body: MeResponse = {
      user: publicUser(user),
      usage: await usageSummary(c.env.DB, user, cfg, c.get('nowMs')),
      features: {
        enhancementAvailable: Boolean(cfg.enhance.apiKey) && user.enhance_allowed === 1,
        keytermsAvailable: cfg.allowKeyterms,
        maxRecordingSeconds: cfg.maxRecordingSeconds,
        maxUploadBytes: cfg.maxUploadBytes,
        pricing: cfg.pricing,
      },
    };
    return c.json(body);
  });

  app.get('/vocabulary', requireUser, async (c) => {
    const body: VocabularyResponse = { terms: await loadTerms(c, c.get('user').id) };
    return c.json(body);
  });

  app.put('/vocabulary', requireUser, async (c) => {
    const { terms: raw } = await readJson(c, vocabularySchema);
    const { terms, errors } = checkKeytermList(raw);
    if (errors.length) {
      throw new ApiError(400, 'invalid_vocabulary', 'Some terms are not valid.', { details: errors });
    }
    const db = c.env.DB;
    const userId = c.get('user').id;
    await db.batch([
      db.prepare('DELETE FROM vocabulary WHERE user_id = ?1').bind(userId),
      ...terms.map((term, i) =>
        db.prepare('INSERT INTO vocabulary (user_id, position, term) VALUES (?1, ?2, ?3)').bind(userId, i, term),
      ),
    ]);
    const body: VocabularyResponse = { terms };
    return c.json(body);
  });

  app.post('/transcribe', requireUser, async (c) => {
    const cfg = c.get('cfg');
    const db = c.env.DB;
    const user = c.get('user');
    const nowMs = c.get('nowMs');

    if (!cfg.elevenlabs.apiKey) {
      throw new ApiError(
        503,
        'stt_not_configured',
        'Transcription is not set up yet: the site admin needs to add the ElevenLabs API key.',
      );
    }
    await enforceRateLimit(
      db,
      `transcribe:${user.id}`,
      cfg.transcribePerMinute,
      60,
      nowSec(c),
      'You are sending recordings very quickly. Please wait a moment and try again.',
    );

    const query = transcribeQuery.safeParse(c.req.query());
    if (!query.success) throw badRequest('Missing or invalid recording details.');
    const opts = query.data;

    const mimeType = c.req.header('content-type') ?? '';
    if (!ACCEPTED_TYPES.test(mimeType)) {
      throw new ApiError(415, 'audio_unsupported', 'Unsupported audio format.');
    }
    const declaredLength = Number(c.req.header('content-length') ?? '0');
    if (declaredLength > cfg.maxUploadBytes) {
      throw new ApiError(413, 'audio_too_large', 'This recording is too large. Please record a shorter clip.');
    }
    if (opts.duration > cfg.maxRecordingSeconds + 5) {
      throw new ApiError(
        413,
        'audio_too_long',
        `Recordings can be at most ${Math.round(cfg.maxRecordingSeconds / 60)} minutes long.`,
      );
    }

    const audio = await c.req.arrayBuffer();
    if (audio.byteLength > cfg.maxUploadBytes) {
      throw new ApiError(413, 'audio_too_large', 'This recording is too large. Please record a shorter clip.');
    }
    if (audio.byteLength < MIN_AUDIO_BYTES) {
      throw new ApiError(400, 'audio_too_short', 'The recording is too short. Hold the button a little longer.');
    }

    // Never trust the browser's duration alone: also estimate from the upload size.
    const estimate = Math.min(
      Math.max(opts.duration, audio.byteLength / MAX_BYTES_PER_SECOND, 1),
      cfg.maxRecordingSeconds + 5,
    );
    await assertAudioQuota(db, user, cfg, estimate, nowMs);

    const keyterms = opts.keyterms && cfg.allowKeyterms ? await loadTerms(c, user.id) : [];

    const eventId = await startUsageEvent(db, {
      userId: user.id,
      kind: 'transcribe',
      audioSeconds: estimate,
      keyterms: keyterms.length,
      cfg,
      nowMs,
    });

    let result;
    try {
      result = await transcribeWithScribe({
        fetch: c.get('deps').fetch,
        baseUrl: cfg.elevenlabs.baseUrl,
        apiKey: cfg.elevenlabs.apiKey,
        modelId: cfg.elevenlabs.modelId,
        audio,
        mimeType,
        languageCode: opts.language === 'auto' ? undefined : opts.language,
        keyterms,
        noVerbatim: opts.noVerbatim,
        zeroRetention: cfg.elevenlabs.zeroRetention,
      });
    } catch (err) {
      await finishUsageEvent(db, eventId, {
        status: 'error',
        errorCode: err instanceof ApiError ? err.code : 'internal',
      });
      throw err;
    }

    const durationSeconds = Math.round((result.durationSeconds ?? estimate) * 10) / 10;
    await finishUsageEvent(db, eventId, { status: 'ok', audioSeconds: durationSeconds });

    let text = result.text;
    let enhancement: EnhancementResult = { status: 'off' };
    if (opts.enhance && result.text) {
      const blocker = await enhancementBlocker(c, user, result.text);
      if (blocker) {
        enhancement = blocker;
      } else {
        const outcome = await runEnhancement(c, user, result.text);
        text = outcome.text;
        enhancement = outcome.enhancement;
      }
    }

    const body: TranscribeResponse = {
      text,
      rawText: result.text,
      languageCode: result.languageCode,
      languageProbability: result.languageProbability,
      durationSeconds,
      keytermsUsed: keyterms.length,
      enhancement,
      usage: await usageSummary(db, user, cfg, nowMs),
    };
    return c.json(body);
  });

  app.post('/enhance', requireUser, async (c) => {
    const { text } = await readJson(c, enhanceSchema);
    const user = c.get('user');
    await enforceRateLimit(c.env.DB, `enhance:${user.id}`, 20, 60, nowSec(c));
    const blocker = await enhancementBlocker(c, user, text);
    let body: EnhanceResponse;
    if (blocker) {
      body = {
        text,
        enhancement: blocker,
        usage: await usageSummary(c.env.DB, user, c.get('cfg'), c.get('nowMs')),
      };
    } else {
      const outcome = await runEnhancement(c, user, text);
      body = {
        text: outcome.text,
        enhancement: outcome.enhancement,
        usage: await usageSummary(c.env.DB, user, c.get('cfg'), c.get('nowMs')),
      };
    }
    return c.json(body);
  });
}
