import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../server/env';
import {
  chatOk,
  createDatabase,
  fakeAudio,
  jsonResponse,
  makeHarness,
  resetDatabase,
  scribeOk,
  type Harness,
  type TestClient,
} from './harness';

let mf: Awaited<ReturnType<typeof createDatabase>>['mf'];
let db: Env['DB'];

beforeAll(async () => {
  ({ mf, db } = await createDatabase());
});
afterAll(() => mf.dispose());
beforeEach(() => resetDatabase(db));

const MIXED = 'المريض عنده hypertension و نعطيه amlodipine خمسة mg مرة يوميا';

async function setup(env: Partial<Env> = {}): Promise<{ h: Harness; admin: TestClient; user: TestClient; userId: number }> {
  const h = makeHarness(db, env);
  const admin = h.client();
  await admin.registerAdmin();
  const user = h.client();
  const { user: u } = await user.register(await admin.invite(), 'reem');
  return { h, admin, user, userId: u.id };
}

function formOf(call: unknown[]): FormData {
  return (call[1] as RequestInit).body as FormData;
}

describe('POST /api/transcribe', () => {
  it('sends the recording to ElevenLabs Scribe v2 with auto language detection', async () => {
    const { h, user } = await setup();
    h.fetchMock.mockResolvedValueOnce(scribeOk(MIXED));

    const res = await user.transcribe({ duration: 4.4, language: 'auto' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      text: MIXED,
      rawText: MIXED,
      languageCode: 'ara',
      durationSeconds: 4.5,
      keytermsUsed: 0,
      enhancement: { status: 'off' },
      usage: { daySeconds: 4.5, dayLimitSeconds: 1800 },
    });

    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    const call = h.fetchMock.mock.calls[0]!;
    expect(call[0]).toBe('https://api.elevenlabs.io/v1/speech-to-text');
    const init = call[1] as RequestInit;
    expect(new Headers(init.headers).get('xi-api-key')).toBe('test-elevenlabs-key');
    const form = formOf(call);
    expect(form.get('model_id')).toBe('scribe_v2');
    expect(form.has('language_code')).toBe(false); // auto-detect, so Arabic + English both work
    expect(form.get('tag_audio_events')).toBe('false');
    expect(form.getAll('keyterms')).toEqual([]);
    const file = form.get('file') as File;
    expect(file.name).toBe('recording.webm');
    expect(file.size).toBe(4000);
  });

  it('passes a language hint, filler removal and the user vocabulary when asked', async () => {
    const { h, user } = await setup();
    await user.put('/api/vocabulary', { terms: ['amlodipine', 'HbA1c', 'Kaplan-Meier'] });
    h.fetchMock.mockResolvedValueOnce(scribeOk('ok'));
    const res = await user.transcribe({ duration: 3, language: 'ar', keyterms: 1, noVerbatim: 1 });
    expect(res.status).toBe(200);
    expect((await res.json()).keytermsUsed).toBe(3);
    const form = formOf(h.fetchMock.mock.calls[0]!);
    expect(form.get('language_code')).toBe('ar');
    expect(form.get('no_verbatim')).toBe('true');
    expect(form.getAll('keyterms')).toEqual(['amlodipine', 'HbA1c', 'Kaplan-Meier']);
  });

  it('does not send keyterms when the admin disabled them', async () => {
    const { h, user } = await setup({ ALLOW_KEYTERMS: 'false' });
    await user.put('/api/vocabulary', { terms: ['amlodipine'] });
    h.fetchMock.mockResolvedValueOnce(scribeOk('ok'));
    await user.transcribe({ duration: 3, keyterms: 1 });
    expect(formOf(h.fetchMock.mock.calls[0]!).getAll('keyterms')).toEqual([]);
  });

  it('requests zero retention when configured', async () => {
    const { h, user } = await setup({ ELEVENLABS_ZERO_RETENTION: 'true', ELEVENLABS_BASE_URL: 'https://api.eu.residency.elevenlabs.io/' });
    h.fetchMock.mockResolvedValueOnce(scribeOk('ok'));
    await user.transcribe({ duration: 3 });
    expect(h.fetchMock.mock.calls[0]![0]).toBe('https://api.eu.residency.elevenlabs.io/v1/speech-to-text?enable_logging=false');
  });

  it('requires sign-in', async () => {
    const h = makeHarness(db);
    const res = await h.client().transcribe({ duration: 2 });
    expect(res.status).toBe(401);
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it('explains when the ElevenLabs key is missing', async () => {
    const { user, h } = await setup({ ELEVENLABS_API_KEY: '' });
    const res = await user.transcribe({ duration: 2 });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: 'stt_not_configured' } });
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it('validates the upload before spending credits', async () => {
    const { h, user } = await setup({ MAX_RECORDING_SECONDS: '60', MAX_UPLOAD_MB: '1' });
    expect((await user.transcribe({ duration: 2 }, fakeAudio(), 'text/plain')).status).toBe(415);
    expect((await user.transcribe({ duration: 2 }, fakeAudio(100))).status).toBe(400);
    expect((await user.transcribe({ duration: 120 })).status).toBe(413);
    expect((await user.transcribe({ duration: 10 }, fakeAudio(2 * 1024 * 1024))).status).toBe(413);
    expect((await user.transcribe({})).status).toBe(400);
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it('enforces the daily quota before calling ElevenLabs', async () => {
    const { h, admin, user, userId } = await setup();
    await admin.patch(`/api/admin/users/${userId}`, { dailyLimitMinutes: 1 });
    h.fetchMock.mockImplementation(async () => scribeOk('first', { audio_duration_secs: 50 }));
    expect((await user.transcribe({ duration: 50 })).status).toBe(200);
    const res = await user.transcribe({ duration: 20 });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: { code: 'daily_quota_exceeded' } });
    expect(h.fetchMock).toHaveBeenCalledTimes(1);

    // A new day resets the daily quota.
    h.clock.now += 86400_000;
    expect((await user.transcribe({ duration: 20 })).status).toBe(200);
  });

  it('estimates duration from the upload size so a fake duration cannot dodge limits', async () => {
    const { h, admin, user, userId } = await setup();
    await admin.patch(`/api/admin/users/${userId}`, { dailyLimitMinutes: 1 });
    // ~4 MB at no more than 48 kB/s is at least 83 s of audio, whatever the browser claims.
    const res = await user.transcribe({ duration: 1 }, fakeAudio(4_000_000));
    expect(res.status).toBe(429);
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it('enforces the site-wide budget across users', async () => {
    const { h, admin, user } = await setup({ GLOBAL_DAILY_LIMIT_MINUTES: '1' });
    h.fetchMock.mockImplementation(async () => scribeOk('x', { audio_duration_secs: 40 }));
    expect((await admin.transcribe({ duration: 40 })).status).toBe(200);
    const res = await user.transcribe({ duration: 30 });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: { code: 'site_quota_exceeded' } });
  });

  it('rate-limits rapid requests per user', async () => {
    const { h, user } = await setup({ TRANSCRIBE_PER_MINUTE: '2' });
    h.fetchMock.mockImplementation(async () => scribeOk('x'));
    expect((await user.transcribe({ duration: 1 })).status).toBe(200);
    expect((await user.transcribe({ duration: 1 })).status).toBe(200);
    const third = await user.transcribe({ duration: 1 });
    expect(third.status).toBe(429);
    expect(await third.json()).toMatchObject({ error: { code: 'rate_limited', retryable: true } });
  });

  it.each([
    [402, { detail: { type: 'payment_required', code: 'insufficient_credits', message: 'no credits' } }, 'stt_credits_exhausted', 503],
    [401, { detail: { status: 'quota_exceeded', message: 'This request exceeds your quota.' } }, 'stt_credits_exhausted', 503],
    [401, { detail: { type: 'authentication_error', code: 'invalid_api_key' } }, 'stt_auth', 503],
    [429, { detail: { type: 'rate_limit_error', code: 'concurrent_limit_exceeded' } }, 'stt_busy', 503],
    [400, { detail: { type: 'validation_error', code: 'audio_too_short' } }, 'audio_too_short', 400],
    [400, { detail: { type: 'validation_error', code: 'invalid_audio_format' } }, 'audio_invalid', 400],
    [500, { detail: { type: 'internal_error', code: 'internal_error' } }, 'stt_unavailable', 503],
  ])('maps ElevenLabs HTTP %i to %s', async (status, body, code, ourStatus) => {
    const { h, user } = await setup();
    h.fetchMock.mockResolvedValueOnce(jsonResponse(body, status));
    const res = await user.transcribe({ duration: 3 });
    expect(res.status).toBe(ourStatus);
    expect(await res.json()).toMatchObject({ error: { code } });
    // Failed requests do not count against the user's minutes.
    const me = await (await user.get('/api/me')).json();
    expect(me.usage.daySeconds).toBe(0);
  });

  it('reports network failures as retryable', async () => {
    const { h, user } = await setup();
    h.fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const res = await user.transcribe({ duration: 3 });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: { code: 'stt_unreachable', retryable: true } });
  });
});

describe('AI clean-up', () => {
  const RAW = 'the patient has hba1c of 7.2 percent and takes metformin 500 mg';
  const CLEAN = 'The patient has hba1c of 7.2 percent and takes metformin 500 mg.';

  it('applies safe punctuation fixes from the OpenAI-compatible API', async () => {
    const { h, user } = await setup({ OPENAI_API_KEY: 'sk-test' });
    h.fetchMock.mockResolvedValueOnce(scribeOk(RAW)).mockResolvedValueOnce(chatOk(CLEAN));
    const body = await (await user.transcribe({ duration: 4, enhance: 1 })).json();
    expect(body).toMatchObject({ text: CLEAN, rawText: RAW, enhancement: { status: 'applied' } });

    const [url, init] = h.fetchMock.mock.calls[1]!;
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(new Headers((init as RequestInit).headers).get('authorization')).toBe('Bearer sk-test');
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent).toMatchObject({ model: 'gpt-6-luna', reasoning_effort: 'none' });
    expect(sent.messages[0].content).toContain('Never translate');
    expect(sent.messages[1].content).toContain(RAW);
    expect(body.usage.enhanceToday).toBe(1);
  });

  it('keeps the original when the model changes a number', async () => {
    const { h, user } = await setup({ OPENAI_API_KEY: 'sk-test' });
    h.fetchMock
      .mockResolvedValueOnce(scribeOk(RAW))
      .mockResolvedValueOnce(chatOk('The patient has HbA1c of 7.5 percent and takes metformin 500 mg.'));
    const body = await (await user.transcribe({ duration: 4, enhance: 1 })).json();
    expect(body.text).toBe(RAW);
    expect(body.enhancement.status).toBe('rejected');
    expect(body.enhancement.message).toMatch(/number/);
  });

  it('keeps the original when the model translates mixed Arabic-English text', async () => {
    const { h, user } = await setup({ OPENAI_API_KEY: 'sk-test' });
    h.fetchMock
      .mockResolvedValueOnce(scribeOk(MIXED))
      .mockResolvedValueOnce(chatOk('The patient has hypertension and we give him amlodipine five mg once daily.'));
    const body = await (await user.transcribe({ duration: 4, enhance: 1 })).json();
    expect(body.text).toBe(MIXED);
    expect(body.enhancement.status).toBe('rejected');
  });

  it('still returns the transcript when clean-up fails or is out of credits', async () => {
    const { h, user } = await setup({ OPENAI_API_KEY: 'sk-test' });
    h.fetchMock
      .mockResolvedValueOnce(scribeOk(RAW))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'insufficient_quota', type: 'insufficient_quota' } }, 429));
    const res = await user.transcribe({ duration: 4, enhance: 1 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toBe(RAW);
    expect(body.enhancement).toMatchObject({ status: 'failed' });
    expect(body.enhancement.message).toMatch(/out of credits/);
  });

  it('is unavailable without an API key and never calls a provider', async () => {
    const { h, user } = await setup();
    h.fetchMock.mockResolvedValueOnce(scribeOk(RAW));
    const body = await (await user.transcribe({ duration: 4, enhance: 1 })).json();
    expect(body.enhancement.status).toBe('unavailable');
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    const me = await (await user.get('/api/me')).json();
    expect(me.features.enhancementAvailable).toBe(false);
  });

  it('respects a per-user switch-off by the admin', async () => {
    const { h, admin, user, userId } = await setup({ OPENAI_API_KEY: 'sk-test' });
    await admin.patch(`/api/admin/users/${userId}`, { enhanceAllowed: false });
    h.fetchMock.mockResolvedValueOnce(scribeOk(RAW));
    const body = await (await user.transcribe({ duration: 4, enhance: 1 })).json();
    expect(body.enhancement.status).toBe('unavailable');
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cleans up edited text on demand and enforces the daily clean-up limit', async () => {
    const { h, user } = await setup({ OPENAI_API_KEY: 'sk-test', ENHANCE_DAILY_LIMIT: '1' });
    h.fetchMock.mockResolvedValueOnce(chatOk(CLEAN));
    const first = await (await user.post('/api/enhance', { text: RAW })).json();
    expect(first).toMatchObject({ text: CLEAN, enhancement: { status: 'applied' } });
    const second = await (await user.post('/api/enhance', { text: RAW })).json();
    expect(second).toMatchObject({ text: RAW, enhancement: { status: 'unavailable' } });
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('works with other OpenAI-compatible providers such as Gemini', async () => {
    const { h, user } = await setup({
      OPENAI_API_KEY: 'gemini-key',
      ENHANCE_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      ENHANCE_MODEL: 'gemini-3.1-flash-lite',
      ENHANCE_REASONING_EFFORT: '',
    });
    h.fetchMock.mockResolvedValueOnce(chatOk(CLEAN));
    await user.post('/api/enhance', { text: RAW });
    const [url, init] = h.fetchMock.mock.calls[0]!;
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.model).toBe('gemini-3.1-flash-lite');
    expect(sent).not.toHaveProperty('reasoning_effort');
  });
});

describe('vocabulary', () => {
  it('stores, de-duplicates and returns terms', async () => {
    const { user } = await setup();
    const res = await user.put('/api/vocabulary', { terms: ['  HbA1c ', 'hba1c', 'Kaplan  Meier', '', 'دواء'] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ terms: ['HbA1c', 'Kaplan Meier', 'دواء'] });
    expect(await (await user.get('/api/vocabulary')).json()).toEqual({ terms: ['HbA1c', 'Kaplan Meier', 'دواء'] });
  });

  it('rejects terms ElevenLabs would refuse', async () => {
    const { user } = await setup();
    const res = await user.put('/api/vocabulary', { terms: ['ok', 'bad <tag>', 'one two three four five six'] });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_vocabulary');
    expect(body.error.details).toHaveLength(2);
  });

  it('caps the list at 100 terms', async () => {
    const { user } = await setup();
    const terms = Array.from({ length: 101 }, (_, i) => `term${i}`);
    expect((await user.put('/api/vocabulary', { terms })).status).toBe(400);
    expect((await user.put('/api/vocabulary', { terms: terms.slice(0, 100) })).status).toBe(200);
  });
});

describe('admin overview', () => {
  it('summarises usage and estimated cost without exposing transcripts', async () => {
    const { h, admin, user } = await setup();
    await user.put('/api/vocabulary', { terms: ['x'] });
    h.fetchMock.mockImplementation(async () => scribeOk('secret words', { audio_duration_secs: 1800 }));
    await user.transcribe({ duration: 300, keyterms: 1 });
    const overview = await (await admin.get('/api/admin/overview')).json();
    expect(overview).toMatchObject({
      dayAudioSeconds: 1800,
      monthKeytermSeconds: 1800,
      dayRequests: 1,
      users: 2,
      estimatedMonthCostUsd: 0.14, // 0.5 h × $0.22 + 0.5 h × $0.05
      providers: { elevenlabsConfigured: true, enhancementConfigured: false },
    });
    expect(JSON.stringify(overview)).not.toContain('secret words');
    const rows = await db.prepare('SELECT * FROM usage_events').all();
    expect(JSON.stringify(rows.results)).not.toContain('secret words');
  });
});
