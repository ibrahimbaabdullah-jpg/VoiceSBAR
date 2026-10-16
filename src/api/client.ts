import type {
  AdminInviteRow,
  AdminOverview,
  AdminUserRow,
  ApiErrorBody,
  CreatedCode,
  EnhanceResponse,
  MeResponse,
  PublicUser,
  SetupStatus,
  TranscribeResponse,
  VocabularyResponse,
} from '../../shared/api';
import type { LanguageHint } from '../../shared/rules';
import { derivePasswordKey } from '../lib/passwordKey';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, retryable = false, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

/** Called when the session expires mid-use so the app can show the sign-in screen. */
export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

interface RequestOptions {
  body?: BodyInit;
  json?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-WTC-Client': 'web', ...opts.headers };
  let body = opts.body;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.json);
  }
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body, credentials: 'same-origin', signal: opts.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    throw new ApiError(
      0,
      offline ? 'offline' : 'network',
      offline
        ? 'You appear to be offline. Check your internet connection and try again.'
        : 'Could not reach the server. Check your internet connection and try again.',
      true,
    );
  }

  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    if (res.status === 401 && !path.startsWith('/api/auth/')) {
      for (const listener of unauthorizedListeners) listener();
    }
    throw new ApiError(
      res.status,
      err?.code ?? 'http_error',
      err?.message ?? `The server returned an error (${res.status}). Please try again.`,
      err?.retryable ?? res.status >= 500,
      err?.details,
    );
  }
  return data as T;
}

export interface TranscribeParams {
  durationSeconds: number;
  language: LanguageHint;
  enhance: boolean;
  keyterms: boolean;
  removeFillers: boolean;
}

export const api = {
  setupStatus: () => request<SetupStatus>('GET', '/api/setup-status'),
  me: () => request<MeResponse>('GET', '/api/me'),

  async login(username: string, password: string) {
    const passwordKey = await derivePasswordKey(username, password);
    return request<{ user: PublicUser }>('POST', '/api/auth/login', { json: { username, passwordKey } });
  },
  async register(code: string, username: string, password: string) {
    const passwordKey = await derivePasswordKey(username, password);
    return request<{ user: PublicUser }>('POST', '/api/auth/register', { json: { code, username, passwordKey } });
  },
  async resetPassword(code: string, username: string, password: string) {
    const passwordKey = await derivePasswordKey(username, password);
    return request<{ user: PublicUser }>('POST', '/api/auth/reset', { json: { code, username, passwordKey } });
  },
  async changePassword(username: string, current: string, next: string) {
    const [currentKey, newKey] = await Promise.all([
      derivePasswordKey(username, current),
      derivePasswordKey(username, next),
    ]);
    return request<{ ok: true }>('POST', '/api/auth/change-password', { json: { currentKey, newKey } });
  },
  logout: () => request<{ ok: true }>('POST', '/api/auth/logout'),
  logoutAll: () => request<{ ok: true }>('POST', '/api/auth/logout-all'),

  getVocabulary: () => request<VocabularyResponse>('GET', '/api/vocabulary'),
  saveVocabulary: (terms: string[]) => request<VocabularyResponse>('PUT', '/api/vocabulary', { json: { terms } }),

  transcribe(audio: Blob, params: TranscribeParams, signal?: AbortSignal) {
    const qs = new URLSearchParams({
      duration: params.durationSeconds.toFixed(2),
      language: params.language,
      enhance: params.enhance ? '1' : '0',
      keyterms: params.keyterms ? '1' : '0',
      noVerbatim: params.removeFillers ? '1' : '0',
    });
    return request<TranscribeResponse>('POST', `/api/transcribe?${qs}`, {
      body: audio,
      headers: { 'Content-Type': audio.type || 'audio/webm' },
      signal,
    });
  },
  enhance: (text: string) => request<EnhanceResponse>('POST', '/api/enhance', { json: { text } }),

  admin: {
    overview: () => request<AdminOverview>('GET', '/api/admin/overview'),
    users: () => request<{ users: AdminUserRow[] }>('GET', '/api/admin/users'),
    updateUser: (
      id: number,
      patch: Partial<{
        disabled: boolean;
        role: 'admin' | 'user';
        enhanceAllowed: boolean;
        dailyLimitMinutes: number | null;
        monthlyLimitMinutes: number | null;
      }>,
    ) => request<{ ok: true }>('PATCH', `/api/admin/users/${id}`, { json: patch }),
    deleteUser: (id: number) => request<{ ok: true }>('DELETE', `/api/admin/users/${id}`),
    resetCode: (id: number) => request<CreatedCode>('POST', `/api/admin/users/${id}/reset-code`, { json: {} }),
    invites: () => request<{ invites: AdminInviteRow[] }>('GET', '/api/admin/invites'),
    createInvite: (body: {
      role: 'admin' | 'user';
      dailyLimitMinutes: number | null;
      monthlyLimitMinutes: number | null;
      expiresInDays: number;
      note?: string;
    }) => request<CreatedCode>('POST', '/api/admin/invites', { json: body }),
    deleteInvite: (id: number) => request<{ ok: true }>('DELETE', `/api/admin/invites/${id}`),
  },
};
