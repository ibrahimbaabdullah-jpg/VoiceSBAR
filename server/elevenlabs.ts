import { z } from 'zod';
import { ApiError } from './errors';

export interface ScribeRequest {
  fetch: typeof fetch;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  audio: ArrayBuffer;
  mimeType: string;
  /** ISO-639-1 code, or undefined to let Scribe detect the language(s) automatically. */
  languageCode?: string;
  keyterms?: readonly string[];
  noVerbatim: boolean;
  zeroRetention: boolean;
  timeoutMs?: number;
}

export interface ScribeResult {
  text: string;
  languageCode: string | null;
  languageProbability: number | null;
  /** Billed duration when ElevenLabs reports it, otherwise the end of the last word. */
  durationSeconds: number | null;
}

const wordSchema = z.object({
  type: z.string().optional(),
  end: z.number().nullable().optional(),
});

const responseSchema = z.object({
  text: z.string(),
  language_code: z.string().nullable().optional(),
  language_probability: z.number().nullable().optional(),
  words: z.array(wordSchema).nullable().optional(),
  audio_duration_secs: z.number().nullable().optional(),
});

const errorSchema = z.object({
  detail: z
    .union([
      z.object({
        type: z.string().optional(),
        code: z.string().optional(),
        status: z.string().optional(),
        message: z.string().optional(),
      }),
      z.string(),
      z.array(z.unknown()),
    ])
    .optional(),
});

function extensionFor(mimeType: string): string {
  const base = mimeType.split(';')[0]!.trim().toLowerCase();
  const map: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/aac': 'aac',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/flac': 'flac',
    'video/webm': 'webm',
    'video/mp4': 'mp4',
  };
  return map[base] ?? 'webm';
}

export async function transcribeWithScribe(req: ScribeRequest): Promise<ScribeResult> {
  const form = new FormData();
  form.append('model_id', req.modelId);
  form.append(
    'file',
    new Blob([req.audio], { type: req.mimeType }),
    `recording.${extensionFor(req.mimeType)}`,
  );
  form.append('tag_audio_events', 'false');
  form.append('diarize', 'false');
  form.append('timestamps_granularity', 'word');
  if (req.languageCode) form.append('language_code', req.languageCode);
  if (req.noVerbatim) form.append('no_verbatim', 'true');
  for (const term of req.keyterms ?? []) form.append('keyterms', term);

  const url = new URL(`${req.baseUrl}/v1/speech-to-text`);
  if (req.zeroRetention) url.searchParams.set('enable_logging', 'false');

  let res: Response;
  try {
    res = await req.fetch(url.toString(), {
      method: 'POST',
      headers: { 'xi-api-key': req.apiKey },
      body: form,
      signal: AbortSignal.timeout(req.timeoutMs ?? 180_000),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new ApiError(504, 'stt_timeout', 'ElevenLabs took too long to respond. Please try again.', {
        retryable: true,
      });
    }
    throw new ApiError(502, 'stt_unreachable', 'Could not reach ElevenLabs. Please try again in a moment.', {
      retryable: true,
    });
  }

  if (!res.ok) throw await scribeError(res);

  let parsed: z.infer<typeof responseSchema>;
  try {
    parsed = responseSchema.parse(await res.json());
  } catch {
    throw new ApiError(502, 'stt_bad_response', 'ElevenLabs returned an unexpected response. Please try again.', {
      retryable: true,
    });
  }

  let lastWordEnd: number | null = null;
  for (const w of parsed.words ?? []) {
    if (typeof w.end === 'number') lastWordEnd = Math.max(lastWordEnd ?? 0, w.end);
  }

  return {
    text: parsed.text.trim(),
    languageCode: parsed.language_code ?? null,
    languageProbability: parsed.language_probability ?? null,
    durationSeconds: parsed.audio_duration_secs ?? lastWordEnd,
  };
}

/** Turns an ElevenLabs error response into a message an end user (or the admin) can act on. */
export async function scribeError(res: Response): Promise<ApiError> {
  let code = '';
  let providerMessage = '';
  try {
    const body = errorSchema.parse(await res.json());
    if (body.detail && typeof body.detail === 'object' && !Array.isArray(body.detail)) {
      code = body.detail.code || body.detail.status || body.detail.type || '';
      providerMessage = body.detail.message ?? '';
    } else if (typeof body.detail === 'string') {
      providerMessage = body.detail;
    }
  } catch {
    // Non-JSON error body; fall back to the status code.
  }
  const lower = `${code} ${providerMessage}`.toLowerCase();

  if (res.status === 402 || /insufficient_credits|quota_exceeded|quota/.test(lower)) {
    return new ApiError(
      503,
      'stt_credits_exhausted',
      'The ElevenLabs account for this site is out of credits. Please tell the site admin.',
    );
  }
  if (res.status === 401 || res.status === 403) {
    return new ApiError(
      503,
      'stt_auth',
      "The site's ElevenLabs API key was rejected. Please tell the site admin.",
    );
  }
  if (res.status === 429) {
    return new ApiError(
      503,
      'stt_busy',
      'ElevenLabs is busy right now (too many requests at once). Wait a few seconds and press Retry.',
      { retryable: true, headers: { 'Retry-After': '5' } },
    );
  }
  if (res.status === 413 || /request_too_large|too_long/.test(lower)) {
    return new ApiError(413, 'audio_too_large', 'This recording is too large to transcribe.');
  }
  if (res.status === 400 || res.status === 422) {
    if (/too_short/.test(lower)) {
      return new ApiError(400, 'audio_too_short', 'The recording is too short. Hold the button a little longer.');
    }
    if (/audio|file|format/.test(lower)) {
      return new ApiError(
        400,
        'audio_invalid',
        'ElevenLabs could not read this recording. Try again, or try a different browser.',
      );
    }
    return new ApiError(502, 'stt_rejected', 'ElevenLabs rejected the request. Please tell the site admin.', {
      details: code || undefined,
    });
  }
  return new ApiError(
    503,
    'stt_unavailable',
    'ElevenLabs is having a temporary problem. Please try again in a minute.',
    { retryable: true },
  );
}
