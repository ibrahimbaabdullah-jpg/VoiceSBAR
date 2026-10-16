import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { APP_VERSION } from '../shared/rules';
import type { AppEnv, Deps } from './context';
import { loadConfig } from './env';
import { ApiError } from './errors';
import { registerAdminRoutes } from './routes/admin';
import { registerAuthRoutes } from './routes/auth';
import { registerDictationRoutes } from './routes/dictation';
import { registerSbarRoutes } from './routes/sbar';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function createApp(overrides: Partial<Deps> = {}) {
  const deps: Deps = {
    fetch: overrides.fetch ?? ((input, init) => fetch(input, init)),
    now: overrides.now ?? (() => Date.now()),
  };

  const app = new Hono<AppEnv>().basePath('/api');

  app.use('*', async (c, next) => {
    c.set('deps', deps);
    c.set('nowMs', deps.now());
    c.set('cfg', loadConfig(c.env));
    await next();
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Frame-Options', 'DENY');
  });

  // CSRF defence: state-changing requests must carry our custom header (which a cross-site page
  // cannot send without a CORS preflight we never approve) and, when present, a same-host Origin.
  app.use('*', async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method)) {
      if (c.req.header('x-wtc-client') !== 'web') {
        throw new ApiError(403, 'csrf', 'Request blocked for security reasons. Please reload the page.');
      }
      const origin = c.req.header('origin');
      if (origin) {
        const host = c.req.header('host') ?? new URL(c.req.url).host;
        let originHost = '';
        try {
          originHost = new URL(origin).host;
        } catch {
          // fall through to the mismatch error
        }
        if (originHost !== host) {
          throw new ApiError(403, 'csrf', 'Request blocked for security reasons. Please reload the page.');
        }
      }
    }
    await next();
  });

  // JSON endpoints are small; audio uploads have their own limit in /transcribe.
  app.use('*', async (c, next) => {
    if (c.req.path === '/api/transcribe') return next();
    return bodyLimit({
      maxSize: 64 * 1024,
      onError: () => {
        throw new ApiError(413, 'too_large', 'The request is too large.');
      },
    })(c, next);
  });

  app.get('/health', (c) => c.json({ ok: true, version: APP_VERSION }));

  registerAuthRoutes(app);
  registerDictationRoutes(app);
  registerSbarRoutes(app);
  registerAdminRoutes(app);

  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Not found.' } }, 404));

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      for (const [k, v] of Object.entries(err.headers ?? {})) c.header(k, v);
      return c.json(err.toBody(), err.status);
    }
    console.error('Unhandled error', err);
    return c.json(
      { error: { code: 'internal', message: 'Something went wrong on the server. Please try again.', retryable: true } },
      500,
    );
  });

  return app;
}
