// Test harness: the real Hono app against a real (in-memory) D1 database from Miniflare,
// with ElevenLabs/OpenAI replaced by a mocked fetch. No network access or API keys needed.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { vi } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import { createApp } from '../../server/app';
import type { Env } from '../../server/env';

const MIGRATIONS_DIR = join(import.meta.dirname, '../../migrations');
const TABLES = ['usage_events', 'vocabulary', 'invites', 'sessions', 'rate_limits', 'users'];

export const SETUP_CODE = 'test-setup-code-1234567890';

/** A valid-looking 43-char base64url password key; the server never sees the real password. */
export const pwKey = (seed: string) => seed.padEnd(43, 'x').slice(0, 43).replace(/[^A-Za-z0-9_-]/g, 'y');

export function migrationStatements(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .flatMap((f) =>
      readFileSync(join(MIGRATIONS_DIR, f), 'utf8')
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean),
    );
}

export async function createDatabase() {
  // Wrangler's platform proxy runs a local workerd with the D1 binding from wrangler.toml,
  // kept in memory only (persist: false).
  const proxy = await getPlatformProxy<{ DB: Env['DB'] }>({
    configPath: join(import.meta.dirname, '../../wrangler.toml'),
    persist: false,
  });
  const db = proxy.env.DB;
  for (const sql of migrationStatements()) await db.prepare(sql).run();
  return { mf: proxy, db };
}

export async function resetDatabase(db: Env['DB']) {
  await db.batch(TABLES.map((t) => db.prepare(`DELETE FROM ${t}`)));
}

export type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

export interface Harness {
  env: Env;
  fetchMock: FetchMock;
  clock: { now: number };
  client: (name?: string) => TestClient;
}

export function makeHarness(db: Env['DB'], envOverrides: Partial<Env> = {}): Harness {
  const env: Env = {
    DB: db,
    ELEVENLABS_API_KEY: 'test-elevenlabs-key',
    ADMIN_SETUP_CODE: SETUP_CODE,
    ...envOverrides,
  };
  const fetchMock: FetchMock = vi.fn<typeof fetch>(async () => {
    throw new Error('Unexpected outbound fetch');
  });
  const clock = { now: Date.UTC(2026, 9, 15, 12, 0, 0) };
  const app = createApp({ fetch: fetchMock, now: () => clock.now });
  return {
    env,
    fetchMock,
    clock,
    client: () => new TestClient(app, env),
  };
}

/** Minimal browser stand-in: keeps the session cookie and sends the CSRF header. */
export class TestClient {
  cookie = '';
  constructor(
    private app: ReturnType<typeof createApp>,
    private env: Env,
  ) {}

  async request(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (!headers.has('x-wtc-client')) headers.set('x-wtc-client', 'web');
    if (this.cookie) headers.set('cookie', this.cookie);
    let body = init.body;
    if (init.json !== undefined) {
      headers.set('content-type', 'application/json');
      body = JSON.stringify(init.json);
    }
    const res = await this.app.request(`http://localhost${path}`, { ...init, headers, body }, this.env);
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const match = /wtc_session=([^;]*)/.exec(setCookie);
      if (match) this.cookie = match[1] ? `wtc_session=${match[1]}` : '';
      if (/Max-Age=0/i.test(setCookie)) this.cookie = '';
    }
    return res;
  }

  get = (path: string) => this.request(path);
  post = (path: string, json?: unknown) => this.request(path, { method: 'POST', json: json ?? {} });
  put = (path: string, json: unknown) => this.request(path, { method: 'PUT', json });
  patch = (path: string, json: unknown) => this.request(path, { method: 'PATCH', json });
  del = (path: string) => this.request(path, { method: 'DELETE' });

  async registerAdmin(username = 'admin') {
    const res = await this.post('/api/auth/register', { code: SETUP_CODE, username, passwordKey: pwKey(username) });
    if (res.status !== 201) throw new Error(`admin registration failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async invite(body: Record<string, unknown> = {}): Promise<string> {
    const res = await this.post('/api/admin/invites', body);
    if (res.status !== 201) throw new Error(`invite failed: ${res.status} ${await res.text()}`);
    return ((await res.json()) as { code: string }).code;
  }

  async register(code: string, username: string) {
    const res = await this.post('/api/auth/register', { code, username, passwordKey: pwKey(username) });
    if (res.status !== 201) throw new Error(`registration failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as { user: { id: number } };
  }

  transcribe(query: Record<string, string | number>, audio: Uint8Array = fakeAudio(), type = 'audio/webm;codecs=opus') {
    const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]));
    return this.request(`/api/transcribe?${qs}`, {
      method: 'POST',
      headers: { 'content-type': type, 'content-length': String(audio.byteLength) },
      body: audio as BodyInit,
    });
  }
}

export function fakeAudio(bytes = 4000): Uint8Array {
  const data = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) data[i] = (i * 31) % 251;
  return data;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export function scribeOk(text: string, extra: Record<string, unknown> = {}): Response {
  return jsonResponse({
    language_code: 'ara',
    language_probability: 0.97,
    text,
    words: [{ text, type: 'word', start: 0, end: 4.2, logprob: -0.1 }],
    audio_duration_secs: 4.5,
    ...extra,
  });
}

export function chatOk(content: string): Response {
  return jsonResponse({ choices: [{ index: 0, message: { role: 'assistant', content } }] });
}
