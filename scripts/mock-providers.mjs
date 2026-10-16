#!/usr/bin/env node
// Local stand-in for the ElevenLabs Speech-to-Text API, an OpenAI-compatible Chat Completions API
// and the Gemini Interactions API, for trying the site without API keys or cost. Never used in
// production.
//
//   npm run mock:providers              # listens on http://127.0.0.1:8790
//   MOCK_SCRIBE_MODE=credits npm run mock:providers   # simulate "out of credits"
//   MOCK_GEMINI_MODE=hallucinate npm run mock:providers   # a quote that is not in the notes
//
// Then put these in .dev.vars:
//   ELEVENLABS_API_KEY=mock
//   ELEVENLABS_BASE_URL=http://127.0.0.1:8790
//   OPENAI_API_KEY=mock
//   ENHANCE_BASE_URL=http://127.0.0.1:8790/v1
//   GEMINI_API_KEY=mock
//   GEMINI_BASE_URL=http://127.0.0.1:8790

import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 8790);
const MODE = process.env.MOCK_SCRIBE_MODE || 'ok'; // ok | credits | busy | auth | down
// ok | hallucinate | incomplete | badjson | quota | auth | down
const GEMINI_MODE = process.env.MOCK_GEMINI_MODE || 'ok';

// Fictional handoff dictations (a sentence or two each), so the Handoff tab can be tried end to end.
const SAMPLES = [
  'حالة وهمية للتدريب. المريض 65 سنة، دخل أمس بسبب التهاب رئوي. الساعة 7 صباحًا: الضغط 128/76، النبض 92، الحرارة 37.8 مئوية، التنفس 20 في الدقيقة، تشبع الأكسجين 95% على هواء الغرفة.',
  'Fictional training case. Alert and responsive. Pain 2/10. Has an IV cannula in the left hand. Allergies are unknown in these notes.',
  'الخطة الموثقة: متابعة نتيجة مزرعة الدم المعلقة وتسليمها للفريق في الوردية التالية.',
];
let counter = 0;

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function speechToText(req, res) {
  if (!req.headers['xi-api-key']) {
    return send(res, 401, { detail: { type: 'authentication_error', code: 'missing_api_key', message: 'Missing key' } });
  }
  const body = await readBody(req);
  const form = await new Response(body, { headers: { 'content-type': req.headers['content-type'] } }).formData();
  const file = form.get('file');
  const keyterms = form.getAll('keyterms');
  console.log(
    `[scribe] model=${form.get('model_id')} language=${form.get('language_code') ?? 'auto'} ` +
      `no_verbatim=${form.get('no_verbatim') ?? 'false'} keyterms=${keyterms.length} file=${file?.size ?? 0} bytes`,
  );
  if (MODE === 'credits') {
    return send(res, 402, { detail: { type: 'payment_required', code: 'insufficient_credits', message: 'No credits' } });
  }
  if (MODE === 'busy') {
    return send(res, 429, { detail: { type: 'rate_limit_error', code: 'concurrent_limit_exceeded', message: 'Busy' } });
  }
  if (MODE === 'auth') {
    return send(res, 401, { detail: { type: 'authentication_error', code: 'invalid_api_key', message: 'Bad key' } });
  }
  if (MODE === 'down') return send(res, 503, { detail: { type: 'service_unavailable', code: 'maintenance' } });

  const text = SAMPLES[counter++ % SAMPLES.length];
  const duration = Math.max(1, Math.round(((file?.size ?? 6000) / 6000) * 10) / 10);
  const arabic = /[؀-ۿ]/.test(text);
  send(res, 200, {
    language_code: arabic ? 'ara' : 'eng',
    language_probability: 0.97,
    text,
    words: [{ text, type: 'word', start: 0, end: duration, logprob: -0.05 }],
    audio_duration_secs: duration,
    transcription_id: `mock-${counter}`,
  });
}

/** Pretend clean-up: capitalise the first Latin letter and end with a full stop. */
function tidy(text) {
  let out = text.trim().replace(/^([a-z])/, (c) => c.toUpperCase());
  if (!/[.!?؟]$/.test(out)) out += /[؀-ۿ]/.test(out.slice(-1)) ? '.' : '.';
  return out;
}

async function chatCompletions(req, res) {
  const body = JSON.parse((await readBody(req)).toString('utf8'));
  const user = body.messages?.find((m) => m.role === 'user')?.content ?? '';
  const text = user.replace(/^<transcript>\n?/, '').replace(/\n?<\/transcript>$/, '');
  console.log(`[chat] model=${body.model} reasoning_effort=${body.reasoning_effort ?? '-'} chars=${text.length}`);
  send(res, 200, {
    id: 'mock',
    object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content: tidy(text) }, finish_reason: 'stop' }],
  });
}

// --- Gemini Interactions API -------------------------------------------------------------------
// A crude, deterministic "model": every item quotes one whole sentence of the notes, so the server's
// evidence check passes. It does not summarize or translate; it only exercises the pipeline.

const CHECK_PATTERNS = {
  allergies: /allerg|حساسي/i,
  vitals: /\bBP\b|blood pressure|pulse|\bHR\b|الضغط|النبض/i,
  vitals_time: /\b\d{1,2}(:\d{2})?\s?(AM|PM)\b|الساعة \d/i,
  history: /history|diabet|admitted|سكري|دخل/i,
  medications: /medication|antibiotic|\bmg\b|دواء|المضاد/i,
  consciousness: /alert|responsive|conscious|واعٍ|متجاوب/i,
  pain: /pain|الألم/i,
  oxygen: /oxygen|SpO2|room air|الأكسجين|هواء الغرفة/i,
  lines: /cannula|\bIV\b|catheter|كانيولا|قسطرة/i,
  plan: /plan|الخطة/i,
};
const VITAL_PARTS = [/\bBP\b|الضغط/i, /pulse|\bHR\b|النبض/i, /respirat|\bRR\b|التنفس/i, /temperature|الحرارة/i, /SpO2|saturation|تشبع/i];
const UNKNOWN = /unknown|not recorded|غير معروفة|غير مكتوبة/i;

function sentences(notes) {
  // Collapse whitespace the same way the server's evidence check does, then split after . ! ? ؟
  return notes.replace(/\s+/g, ' ').trim().split(/(?<=[.!?؟])\s+/).filter((s) => s.length > 1);
}

function mockReport(notes) {
  const parts = sentences(notes);
  const item = (s) => ({ text: s, evidence: s });
  const report = { situation: [], background: [], assessment: [], recommendation: [], checklist: [] };
  parts.forEach((s, i) => {
    if (CHECK_PATTERNS.plan.test(s)) report.recommendation.push(item(s));
    else if (i === 0) report.situation.push(item(s));
    else if (CHECK_PATTERNS.history.test(s) || CHECK_PATTERNS.allergies.test(s)) report.background.push(item(s));
    else report.assessment.push(item(s));
  });
  for (const [category, pattern] of Object.entries(CHECK_PATTERNS)) {
    const hit = parts.find((s) => pattern.test(s));
    let status = hit ? 'documented' : 'missing';
    if (hit && UNKNOWN.test(hit)) status = 'unclear';
    if (hit && category === 'vitals' && VITAL_PARTS.filter((p) => p.test(hit)).length < VITAL_PARTS.length) status = 'partial';
    report.checklist.push({ category, status, evidence: hit ?? '' });
  }
  return report;
}

async function interactions(req, res) {
  const body = JSON.parse((await readBody(req)).toString('utf8'));
  const notes = typeof body.input === 'string' ? body.input : '';
  const language = /into English SBAR/.test(body.system_instruction ?? '') ? 'en' : 'ar';
  // Log sizes and flags only, never the notes.
  console.log(`[gemini] model=${body.model} store=${body.store} language=${language} chars=${notes.length} mode=${GEMINI_MODE}`);
  if (!req.headers['x-goog-api-key']) return send(res, 401, { error: { code: 401, status: 'UNAUTHENTICATED' } });
  if (body.store !== false || body.response_format?.mime_type !== 'application/json') {
    return send(res, 400, { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'mock expects store=false and a JSON schema' } });
  }
  if (GEMINI_MODE === 'quota') return send(res, 429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED' } });
  if (GEMINI_MODE === 'auth') return send(res, 401, { error: { code: 401, status: 'UNAUTHENTICATED' } });
  if (GEMINI_MODE === 'down') return send(res, 503, { error: { code: 503, status: 'UNAVAILABLE' } });
  const report = mockReport(notes);
  if (GEMINI_MODE === 'hallucinate') report.background.push({ text: 'No known allergies.', evidence: 'No known allergies' });
  const text = GEMINI_MODE === 'badjson' ? '{"situation": [' : JSON.stringify(report);
  send(res, 200, {
    id: `mock-interaction-${++counter}`,
    status: GEMINI_MODE === 'incomplete' ? 'failed' : 'completed',
    steps: [{ type: 'model_output', content: [{ type: 'text', text }] }],
  });
}

createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const run =
    req.method === 'POST' && path === '/v1/speech-to-text'
      ? speechToText
      : req.method === 'POST' && path === '/v1/chat/completions'
        ? chatCompletions
        : req.method === 'POST' && path === '/v1beta/interactions'
          ? interactions
          : null;
  if (!run) return send(res, 404, { error: 'not found' });
  run(req, res).catch((err) => {
    console.error(err);
    send(res, 500, { detail: { type: 'internal_error', code: 'internal_error' } });
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Mock ElevenLabs + OpenAI-compatible + Gemini API on http://127.0.0.1:${PORT} (scribe: ${MODE}, gemini: ${GEMINI_MODE})`);
});
