#!/usr/bin/env node
// Local stand-in for the ElevenLabs Speech-to-Text API and an OpenAI-compatible Chat Completions
// API, for trying the site without API keys or cost. Never used in production.
//
//   npm run mock:providers              # listens on http://127.0.0.1:8790
//   MOCK_SCRIBE_MODE=credits npm run mock:providers   # simulate "out of credits"
//
// Then put these in .dev.vars:
//   ELEVENLABS_API_KEY=mock
//   ELEVENLABS_BASE_URL=http://127.0.0.1:8790
//   OPENAI_API_KEY=mock
//   ENHANCE_BASE_URL=http://127.0.0.1:8790/v1

import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 8790);
const MODE = process.env.MOCK_SCRIBE_MODE || 'ok'; // ok | credits | busy | auth | down

const SAMPLES = [
  'المريض عنده hypertension ونعطيه amlodipine خمسة mg مرة يوميا',
  'the HbA1c was 7.2 percent so we increased metformin to 1000 mg twice daily',
  'نتائج الدراسة كانت significant مع p value أقل من 0.05 في مجموعة العلاج',
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

createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const run =
    req.method === 'POST' && path === '/v1/speech-to-text'
      ? speechToText
      : req.method === 'POST' && path === '/v1/chat/completions'
        ? chatCompletions
        : null;
  if (!run) return send(res, 404, { error: 'not found' });
  run(req, res).catch((err) => {
    console.error(err);
    send(res, 500, { detail: { type: 'internal_error', code: 'internal_error' } });
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Mock ElevenLabs + OpenAI-compatible API on http://127.0.0.1:${PORT} (mode: ${MODE})`);
});
