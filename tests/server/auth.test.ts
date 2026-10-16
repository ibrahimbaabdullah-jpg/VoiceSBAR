import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../server/env';
import { createDatabase, makeHarness, pwKey, resetDatabase, SETUP_CODE, type Harness } from './harness';

let mf: Awaited<ReturnType<typeof createDatabase>>['mf'];
let db: Env['DB'];
let h: Harness;

beforeAll(async () => {
  ({ mf, db } = await createDatabase());
});
afterAll(() => mf.dispose());
beforeEach(async () => {
  await resetDatabase(db);
  h = makeHarness(db);
});

describe('first-run setup', () => {
  it('reports that setup is needed until an admin exists', async () => {
    const c = h.client();
    expect(await (await c.get('/api/setup-status')).json()).toMatchObject({
      needsSetup: true,
      setupCodeConfigured: true,
    });
    await c.registerAdmin();
    expect(await (await c.get('/api/setup-status')).json()).toMatchObject({ needsSetup: false });
  });

  it('creates the first admin with the setup code, and only once', async () => {
    const admin = h.client();
    const body = await admin.registerAdmin('owner');
    expect(body).toMatchObject({ user: { username: 'owner', role: 'admin' } });
    expect(admin.cookie).toMatch(/^wtc_session=/);

    const again = await h.client().post('/api/auth/register', {
      code: SETUP_CODE,
      username: 'second',
      passwordKey: pwKey('second'),
    });
    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({ error: { code: 'invalid_code' } });
  });

  it('rejects unknown codes and bad usernames', async () => {
    const c = h.client();
    const bad = await c.post('/api/auth/register', { code: 'WTC-NOPE-NOPE', username: 'someone', passwordKey: pwKey('a') });
    expect(bad.status).toBe(400);
    const badName = await c.post('/api/auth/register', { code: SETUP_CODE, username: 'a b', passwordKey: pwKey('a') });
    expect(badName.status).toBe(400);
    expect(await badName.json()).toMatchObject({ error: { code: 'invalid_request' } });
  });
});

describe('invites and sign-in', () => {
  it('lets an invited user register once, accepting a loosely typed code', async () => {
    const admin = h.client();
    await admin.registerAdmin();
    const code = await admin.invite({ note: 'Sara', dailyLimitMinutes: 12 });
    expect(code).toMatch(/^WTC(-[A-Z0-9]{4}){5}$/);

    const user = h.client();
    const sloppy = code.toLowerCase().replace(/-/g, ' ');
    const reg = await user.post('/api/auth/register', { code: sloppy, username: 'sara', passwordKey: pwKey('sara') });
    expect(reg.status).toBe(201);

    const me = await (await user.get('/api/me')).json();
    expect(me).toMatchObject({ user: { username: 'sara', role: 'user' }, usage: { dayLimitSeconds: 720 } });

    const reuse = await h.client().post('/api/auth/register', { code, username: 'other', passwordKey: pwKey('o') });
    expect(reuse.status).toBe(400);

    const invites = await (await admin.get('/api/admin/invites')).json();
    expect(invites.invites[0]).toMatchObject({ usedByUsername: 'sara', note: 'Sara' });
  });

  it('refuses a taken username without using up the invite', async () => {
    const admin = h.client();
    await admin.registerAdmin('admin');
    const code = await admin.invite();
    const res = await h.client().post('/api/auth/register', { code, username: 'ADMIN', passwordKey: pwKey('x') });
    expect(res.status).toBe(409);
    await h.client().register(code, 'fresh');
  });

  it('rejects expired invites', async () => {
    const admin = h.client();
    await admin.registerAdmin();
    const code = await admin.invite({ expiresInDays: 1 });
    h.clock.now += 2 * 86400_000;
    const res = await h.client().post('/api/auth/register', { code, username: 'late', passwordKey: pwKey('late') });
    expect(res.status).toBe(400);
  });

  it('signs in with the right key and rejects the wrong one', async () => {
    await h.client().registerAdmin('admin');
    const c = h.client();
    const wrong = await c.post('/api/auth/login', { username: 'admin', passwordKey: pwKey('nope') });
    expect(wrong.status).toBe(401);
    const unknown = await c.post('/api/auth/login', { username: 'ghost', passwordKey: pwKey('nope') });
    expect(unknown.status).toBe(401);
    // Same answer either way, so usernames cannot be discovered by guessing.
    expect(await unknown.json()).toEqual(await wrong.json());
    const ok = await c.post('/api/auth/login', { username: 'Admin', passwordKey: pwKey('admin') });
    expect(ok.status).toBe(200);
    expect((await c.get('/api/me')).status).toBe(200);
  });

  it('rate-limits repeated failed sign-ins for one account', async () => {
    await h.client().registerAdmin('admin');
    const c = h.client();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await c.post('/api/auth/login', { username: 'admin', passwordKey: pwKey(`bad${i}`) })).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    const last = await c.post('/api/auth/login', { username: 'admin', passwordKey: pwKey('admin') });
    expect(last.status).toBe(429);
    expect(last.headers.get('retry-after')).toBeTruthy();
    h.clock.now += 16 * 60_000;
    expect((await c.post('/api/auth/login', { username: 'admin', passwordKey: pwKey('admin') })).status).toBe(200);
  });

  it('expires sessions and requires sign-in', async () => {
    const c = h.client();
    await c.registerAdmin();
    h.clock.now += 31 * 86400_000;
    expect((await c.get('/api/me')).status).toBe(401);
  });

  it('slides the session forward when it is used', async () => {
    const c = h.client();
    await c.registerAdmin();
    h.clock.now += 20 * 86400_000;
    expect((await c.get('/api/me')).status).toBe(200);
    h.clock.now += 20 * 86400_000;
    expect((await c.get('/api/me')).status).toBe(200);
  });

  it('signs out', async () => {
    const c = h.client();
    await c.registerAdmin();
    const saved = c.cookie;
    expect((await c.post('/api/auth/logout')).status).toBe(200);
    c.cookie = saved; // a stolen copy of the old cookie must not work either
    expect((await c.get('/api/me')).status).toBe(401);
  });
});

describe('CSRF protection', () => {
  it('blocks state-changing requests without the client header', async () => {
    const res = await h.client().request('/api/auth/login', {
      method: 'POST',
      headers: { 'x-wtc-client': '', 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'a', passwordKey: pwKey('a') }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'csrf' } });
  });

  it('blocks cross-site origins', async () => {
    const res = await h.client().request('/api/auth/login', {
      method: 'POST',
      headers: { origin: 'https://evil.example', host: 'localhost', 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'a', passwordKey: pwKey('a') }),
    });
    expect(res.status).toBe(403);
  });

  it('allows same-origin requests', async () => {
    const res = await h.client().request('/api/auth/login', {
      method: 'POST',
      headers: { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'nobody', passwordKey: pwKey('a') }),
    });
    expect(res.status).toBe(401);
  });
});

describe('passwords', () => {
  it('changes the password and signs out other devices', async () => {
    const laptop = h.client();
    await laptop.registerAdmin('admin');
    const phone = h.client();
    await phone.post('/api/auth/login', { username: 'admin', passwordKey: pwKey('admin') });

    const wrong = await laptop.post('/api/auth/change-password', { currentKey: pwKey('bad'), newKey: pwKey('new') });
    expect(wrong.status).toBe(400);
    const ok = await laptop.post('/api/auth/change-password', { currentKey: pwKey('admin'), newKey: pwKey('new') });
    expect(ok.status).toBe(200);

    expect((await laptop.get('/api/me')).status).toBe(200);
    expect((await phone.get('/api/me')).status).toBe(401);
    expect((await h.client().post('/api/auth/login', { username: 'admin', passwordKey: pwKey('new') })).status).toBe(200);
  });

  it('resets a forgotten password with an admin-issued code', async () => {
    const admin = h.client();
    await admin.registerAdmin();
    const user = h.client();
    const { user: u } = await user.register(await admin.invite(), 'omar');

    const created = await admin.post(`/api/admin/users/${u.id}/reset-code`);
    expect(created.status).toBe(201);
    const { code } = (await created.json()) as { code: string };
    expect(code).toMatch(/^RST-/);

    // The code only works for the account it was issued for.
    const wrongUser = await h.client().post('/api/auth/reset', { code, username: 'admin', passwordKey: pwKey('hack') });
    expect(wrongUser.status).toBe(400);

    const fresh = h.client();
    const reset = await fresh.post('/api/auth/reset', { code, username: 'omar', passwordKey: pwKey('omar2') });
    expect(reset.status).toBe(200);
    expect((await user.get('/api/me')).status).toBe(401); // old session revoked
    expect((await fresh.get('/api/me')).status).toBe(200);
    expect((await h.client().post('/api/auth/login', { username: 'omar', passwordKey: pwKey('omar') })).status).toBe(401);
    expect((await h.client().post('/api/auth/reset', { code, username: 'omar', passwordKey: pwKey('x') })).status).toBe(400);
  });
});

describe('admin controls', () => {
  it('keeps admin routes away from regular users', async () => {
    const admin = h.client();
    await admin.registerAdmin();
    const user = h.client();
    await user.register(await admin.invite(), 'lina');
    expect((await user.get('/api/admin/users')).status).toBe(403);
    expect((await user.post('/api/admin/invites', {})).status).toBe(403);
    expect((await h.client().get('/api/admin/users')).status).toBe(401);
  });

  it('disables a user, which also ends their sessions', async () => {
    const admin = h.client();
    await admin.registerAdmin();
    const user = h.client();
    const { user: u } = await user.register(await admin.invite(), 'lina');
    expect((await admin.patch(`/api/admin/users/${u.id}`, { disabled: true })).status).toBe(200);
    expect((await user.get('/api/me')).status).toBe(401);
    const login = await h.client().post('/api/auth/login', { username: 'lina', passwordKey: pwKey('lina') });
    expect(login.status).toBe(403);
    expect(await login.json()).toMatchObject({ error: { code: 'account_disabled' } });
  });

  it('never leaves the site without an active admin', async () => {
    const admin = h.client();
    const { user } = (await admin.registerAdmin()) as { user: { id: number } };
    expect((await admin.patch(`/api/admin/users/${user.id}`, { role: 'user' })).status).toBe(400);
    expect((await admin.patch(`/api/admin/users/${user.id}`, { disabled: true })).status).toBe(400);
    expect((await admin.del(`/api/admin/users/${user.id}`)).status).toBe(400);
  });

  it('lists users with their limits and deletes users', async () => {
    const admin = h.client();
    await admin.registerAdmin();
    const { user: u } = await h.client().register(await admin.invite(), 'nora');
    await admin.patch(`/api/admin/users/${u.id}`, { dailyLimitMinutes: 5, monthlyLimitMinutes: null, enhanceAllowed: false });
    const list = (await (await admin.get('/api/admin/users')).json()) as { users: Record<string, unknown>[] };
    expect(list.users.find((x) => x.username === 'nora')).toMatchObject({
      dailyLimitSeconds: 300,
      customDailyLimit: true,
      customMonthlyLimit: false,
      monthlyLimitSeconds: 300 * 60,
      enhanceAllowed: false,
    });
    expect((await admin.del(`/api/admin/users/${u.id}`)).status).toBe(200);
    expect((await (await admin.get('/api/admin/users')).json()).users).toHaveLength(1);
  });

  it('revokes unused invites', async () => {
    const admin = h.client();
    await admin.registerAdmin();
    const code = await admin.invite();
    const { invites } = (await (await admin.get('/api/admin/invites')).json()) as { invites: { id: number }[] };
    expect((await admin.del(`/api/admin/invites/${invites[0]!.id}`)).status).toBe(200);
    const reg = await h.client().post('/api/auth/register', { code, username: 'late', passwordKey: pwKey('l') });
    expect(reg.status).toBe(400);
  });
});

describe('misc', () => {
  it('answers health checks and unknown routes with JSON', async () => {
    const c = h.client();
    expect(await (await c.get('/api/health')).json()).toMatchObject({ ok: true, version: '0.1.0' });
    const missing = await c.get('/api/nope');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects oversized JSON bodies', async () => {
    const res = await h.client().post('/api/auth/login', { username: 'a', passwordKey: 'x'.repeat(70_000) });
    expect(res.status).toBe(413);
  });
});
