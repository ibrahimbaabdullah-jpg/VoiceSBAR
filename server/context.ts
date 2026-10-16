import type { Context, MiddlewareHandler } from 'hono';
import type { z } from 'zod';
import type { Config, Env } from './env';
import type { UserRow } from './auth';
import { loadSessionUser } from './auth';
import { badRequest, forbidden, unauthorized } from './errors';
import { nowSeconds } from './time';

/** Injected so tests can control the clock and mock ElevenLabs/OpenAI without network access. */
export interface Deps {
  fetch: typeof fetch;
  now: () => number;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    cfg: Config;
    deps: Deps;
    nowMs: number;
    user: UserRow;
    sessionHash: string;
  };
};

export type AppContext = Context<AppEnv>;

export const nowSec = (c: AppContext) => nowSeconds(c.get('nowMs'));

export async function readJson<T>(c: AppContext, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest('The request body must be JSON.');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    throw badRequest(`${where}${issue?.message ?? 'Invalid request.'}`);
  }
  return parsed.data;
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await loadSessionUser(c, c.env.DB, nowSec(c), c.get('cfg').sessionSeconds);
  if (!session) throw unauthorized();
  c.set('user', session.user);
  c.set('sessionHash', session.tokenHash);
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get('user').role !== 'admin') throw forbidden('Only the site admin can do that.');
  await next();
};

export function parseId(raw: string | undefined): number {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) throw badRequest('Invalid id.');
  return id;
}
