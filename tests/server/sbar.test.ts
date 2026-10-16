// Ported from nursing-sbar-handoff/tests/test_sbar.py, plus the route's auth, consent and cooldown.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../server/env';
import { REPORT_SCHEMA, systemInstruction } from '../../server/sbar';
import { CHECK_KEYS, missingItems, SbarError, validateNotes, validateReport, type SbarReport } from '../../shared/sbar';
import { SAMPLE_NOTES, SAMPLE_NOTES_EN, sampleReport } from '../../shared/sbarExamples';
import { createDatabase, jsonResponse, makeHarness, resetDatabase, type Harness, type TestClient } from './harness';

let mf: Awaited<ReturnType<typeof createDatabase>>['mf'];
let db: Env['DB'];

beforeAll(async () => {
  ({ mf, db } = await createDatabase());
});
afterAll(() => mf.dispose());
beforeEach(() => resetDatabase(db));

const GEMINI_KEY = 'secret-not-to-leak';

function geminiOk(report: unknown = sampleReport(), status = 'completed'): Response {
  return jsonResponse({
    status,
    steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(report) }] }],
  });
}

async function setup(env: Partial<Env> = {}): Promise<{ h: Harness; user: TestClient }> {
  const h = makeHarness(db, { GEMINI_API_KEY: GEMINI_KEY, ...env });
  const admin = h.client();
  await admin.registerAdmin();
  const user = h.client();
  await user.register(await admin.invite(), 'nora');
  return { h, user };
}

const handoff = (user: TestClient, body: Record<string, unknown> = {}) =>
  user.post('/api/sbar', { notes: SAMPLE_NOTES, language: 'ar', consent: true, ...body });

const rejects = (data: unknown, notes = SAMPLE_NOTES) =>
  expect(() => validateReport(data, notes)).toThrow(SbarError);

describe('validateReport (fails closed)', () => {
  it('accepts the example as source-grounded and flags the unknown allergy', () => {
    const report = validateReport(sampleReport(), SAMPLE_NOTES);
    expect(new Set(missingItems(report).map((r) => r.category))).toEqual(new Set(['allergies', 'medications']));
    expect(validateReport(sampleReport('en'), SAMPLE_NOTES_EN)).toEqual(sampleReport('en'));
  });

  it('rejects hallucinated evidence', () => {
    const data = sampleReport();
    data.background[0]!.evidence = 'لا توجد حساسية';
    rejects(data);
  });

  it('tolerates line wrapping in quotes, and nothing else', () => {
    const data = sampleReport();
    for (const key of ['situation', 'background', 'assessment', 'recommendation'] as const) {
      for (const item of data[key]) item.evidence = item.evidence.replace(/\n/g, ' ');
    }
    expect(validateReport(data, SAMPLE_NOTES)).toEqual(data);
    // A changed number is not "wrapping".
    const changed = sampleReport();
    changed.assessment[1]!.evidence = changed.assessment[1]!.evidence.replace('128/76', '128/78');
    rejects(changed);
  });

  it('rejects a duplicate checklist category', () => {
    const data = sampleReport();
    data.checklist[0] = structuredClone(data.checklist[1]!);
    rejects(data);
  });

  it('rejects a missing checklist, or a missing checklist row', () => {
    const noChecklist: Partial<SbarReport> = sampleReport();
    delete noChecklist.checklist;
    rejects(noChecklist);
    const shortList = sampleReport();
    shortList.checklist.pop();
    expect(shortList.checklist).toHaveLength(CHECK_KEYS.length - 1);
    rejects(shortList);
  });

  it('rejects unknown categories, statuses and extra keys', () => {
    const badCategory = sampleReport();
    (badCategory.checklist[0] as { category: string }).category = 'toString';
    rejects(badCategory);
    const badStatus = sampleReport();
    (badStatus.checklist[0] as { status: string }).status = 'normal';
    rejects(badStatus);
    rejects({ ...sampleReport(), score: 10 });
    const extraItemKey = sampleReport();
    (extraItemKey.situation[0] as unknown as Record<string, string>).note = 'x';
    rejects(extraItemKey);
  });

  it('requires empty evidence for missing rows and a real quote for every other row', () => {
    const missingWithQuote = sampleReport();
    missingWithQuote.checklist[0] = { category: 'allergies', status: 'missing', evidence: 'الحساسية غير معروفة' };
    rejects(missingWithQuote);
    const documentedWithoutQuote = sampleReport();
    documentedWithoutQuote.checklist[1]!.evidence = '  ';
    rejects(documentedWithoutQuote);
  });

  it('rejects empty items and non-object input', () => {
    const empty = sampleReport();
    empty.situation[0]!.text = '   ';
    rejects(empty);
    rejects(null);
    rejects([]);
    rejects('{"situation": []}');
  });
});

describe('validateNotes', () => {
  it.each(['', '  ', 'قصير', 'a'.repeat(6001)])('rejects %#', (notes) => {
    expect(() => validateNotes(notes)).toThrow(SbarError);
  });
  it('counts characters, not UTF-16 units, and trims', () => {
    expect(validateNotes(`  ${'ب'.repeat(6000)}  `)).toHaveLength(6000);
  });
});

describe('POST /api/sbar', () => {
  it('needs a signed-in user', async () => {
    const h = makeHarness(db, { GEMINI_API_KEY: GEMINI_KEY });
    const res = await handoff(h.client());
    expect(res.status).toBe(401);
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it.each(['', '  ', 'قصير', 'a'.repeat(6001)])('never sends bad input to Gemini (%#)', async (notes) => {
    const { h, user } = await setup();
    const res = await handoff(user, { notes });
    expect(res.status).toBe(400);
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it('never sends notes without consent', async () => {
    const { h, user } = await setup();
    for (const consent of [false, undefined]) {
      const res = await handoff(user, { consent });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('sbar_consent');
    }
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it('never calls Gemini without a key', async () => {
    const { h, user } = await setup({ GEMINI_API_KEY: '' });
    const res = await handoff(user);
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('sbar_not_configured');
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it('makes one stateless call with the key in a header and the JSON schema', async () => {
    const { h, user } = await setup();
    h.fetchMock.mockResolvedValueOnce(geminiOk());
    const res = await handoff(user);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ report: sampleReport(), language: 'ar', model: 'gemini-3.5-flash-lite' });

    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = h.fetchMock.mock.calls[0]!;
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(String(url)).not.toContain(GEMINI_KEY);
    expect(new Headers((init as RequestInit).headers).get('x-goog-api-key')).toBe(GEMINI_KEY);
    const payload = JSON.parse((init as RequestInit).body as string);
    expect(payload.store).toBe(false);
    expect(payload.input).toBe(SAMPLE_NOTES);
    expect(payload.response_format).toEqual({ type: 'text', mime_type: 'application/json', schema: REPORT_SCHEMA });
    expect(payload.system_instruction).toBe(systemInstruction('ar'));
  });

  it.each([400, 401, 403, 404, 429, 500, 503])('turns Gemini HTTP %i into a safe message, without retrying', async (status) => {
    const { h, user } = await setup();
    h.fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: `upstream detail ${GEMINI_KEY}` } }, status));
    const res = await handoff(user);
    expect(res.status).toBeGreaterThanOrEqual(500);
    const text = await res.text();
    expect(text).not.toContain(GEMINI_KEY);
    expect(text).not.toContain('upstream detail');
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['timeout', new DOMException('The operation timed out.', 'TimeoutError'), 'sbar_timeout'],
    ['connection', new TypeError('sensitive content'), 'sbar_unreachable'],
  ])('keeps network failures safe (%s)', async (_name, error, code) => {
    const { h, user } = await setup();
    h.fetchMock.mockRejectedValueOnce(error);
    const res = await handoff(user);
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text).error.code).toBe(code);
    expect(text).not.toContain('sensitive content');
  });

  it('rejects an incomplete or malformed response', async () => {
    const { h, user } = await setup();
    h.fetchMock.mockResolvedValueOnce(geminiOk(sampleReport(), 'failed'));
    expect((await (await handoff(user)).json()).error.code).toBe('sbar_incomplete');
    h.clock.now += 10_000;
    h.fetchMock.mockResolvedValueOnce(new Response('not json', { status: 200 }));
    expect((await (await handoff(user)).json()).error.code).toBe('sbar_incomplete');
  });

  it('shows nothing when one quote is not in the notes', async () => {
    const { h, user } = await setup();
    const data = sampleReport();
    data.background.push({ text: 'No known allergies.', evidence: 'No known allergies' });
    h.fetchMock.mockResolvedValueOnce(geminiOk(data));
    const res = await handoff(user);
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text).error.code).toBe('sbar_unverified');
    expect(text).not.toContain('No known allergies');
    expect(text).not.toContain('situation');
  });

  it.each([
    ['ar', 'Arabic'],
    ['en', 'English'],
    ['invalid', 'Arabic'],
  ])('writes the report in %s without translating the source evidence', async (language, expected) => {
    const { h, user } = await setup();
    h.fetchMock.mockResolvedValueOnce(geminiOk());
    const res = await handoff(user, { language });
    const body = await res.json();
    const payload = JSON.parse((h.fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(payload.system_instruction).toContain(`into ${expected} SBAR`);
    expect(payload.system_instruction).toContain(`concise ${expected} text`);
    expect(payload.system_instruction).toContain('keep evidence in the original source language');
    expect(payload.input).toBe(SAMPLE_NOTES);
    expect(body.report.situation[0].evidence).toBe(sampleReport().situation[0]!.evidence);
  });

  it('returns errors in the selected language', async () => {
    const { user } = await setup();
    const ar = await (await handoff(user, { consent: false })).json();
    expect(ar.error.message).toMatch(/^أكد أولًا/);
    const en = await (await handoff(user, { consent: false, language: 'en' })).json();
    expect(en.error.message).toBe('First confirm that these notes describe a fictional case and that you consent to sending them.');
  });

  it('enforces the ten-second cooldown, but not on rejected input', async () => {
    const { h, user } = await setup();
    expect((await handoff(user, { notes: 'قصير' })).status).toBe(400);
    h.fetchMock.mockImplementation(async () => geminiOk());
    expect((await handoff(user)).status).toBe(200);

    h.clock.now += 9_000;
    const blocked = await handoff(user, { language: 'en' });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('1');
    expect((await blocked.json()).error.message).toBe('Wait ten seconds between requests to conserve the available quota.');
    expect(h.fetchMock).toHaveBeenCalledTimes(1);

    h.clock.now += 1_000;
    expect((await handoff(user)).status).toBe(200);
    expect(h.fetchMock).toHaveBeenCalledTimes(2);
  });

  it('caps reports per day', async () => {
    const { h, user } = await setup({ SBAR_DAILY_LIMIT: '2' });
    h.fetchMock.mockImplementation(async () => geminiOk());
    for (let i = 0; i < 2; i++) {
      expect((await handoff(user)).status).toBe(200);
      h.clock.now += 10_000;
    }
    const res = await handoff(user, { language: 'en' });
    expect(res.status).toBe(429);
    expect((await res.json()).error.message).toMatch(/daily limit for SBAR reports/);
    expect(h.fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stores neither notes nor reports in D1', async () => {
    const { h, user } = await setup();
    h.fetchMock.mockResolvedValueOnce(geminiOk());
    expect((await handoff(user)).status).toBe(200);
    const dump: unknown[] = [];
    for (const table of ['users', 'sessions', 'invites', 'vocabulary', 'usage_events', 'rate_limits']) {
      dump.push((await db.prepare(`SELECT * FROM ${table}`).all()).results);
    }
    const text = JSON.stringify(dump);
    expect(text).not.toContain('التهاب');
    expect(text).not.toContain('مزرعة');
  });
});
