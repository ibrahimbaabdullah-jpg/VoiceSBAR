// Small WebCrypto helpers. Everything here works in Cloudflare Workers and in Node 22.

const encoder = new TextEncoder();

export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function randomToken(length = 32): string {
  return toBase64Url(randomBytes(length));
}

/** Constant-time comparison so secrets cannot be guessed byte by byte from response timing. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export async function sha256(data: string | Uint8Array): Promise<Uint8Array> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

/** Hash used to store and look up high-entropy secrets (session tokens, invite codes). */
export async function hashSecret(secret: string): Promise<string> {
  return toBase64Url(await sha256(secret));
}

export async function secretsEqual(a: string, b: string): Promise<boolean> {
  // Hash first so the comparison time does not depend on where the strings differ or on length.
  return timingSafeEqual(await sha256(a), await sha256(b));
}

async function hmac(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, message as BufferSource));
}

/**
 * Stores a browser-stretched password key (see CLIENT_KDF_ITERATIONS) as
 * `v1$<salt>$<HMAC-SHA256(salt, key)>`.
 */
export async function hashPasswordKey(passwordKey: string): Promise<string> {
  const salt = randomBytes(16);
  const mac = await hmac(salt, fromBase64Url(passwordKey));
  return `v1$${toBase64Url(salt)}$${toBase64Url(mac)}`;
}

export async function verifyPasswordKey(passwordKey: string, stored: string): Promise<boolean> {
  const [version, saltText, macText] = stored.split('$');
  if (version !== 'v1' || !saltText || !macText) return false;
  const mac = await hmac(fromBase64Url(saltText), fromBase64Url(passwordKey));
  return timingSafeEqual(mac, fromBase64Url(macText));
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // no 0/O, 1/I/L, U

/** Human-friendly single-use code such as `WTC-7KQ2-M9XA-4HRT-PZ3D` (~98 bits of entropy). */
export function generateCode(prefix = 'WTC'): string {
  const groups: string[] = [];
  // Rejection sampling keeps every character equally likely.
  const limit = 256 - (256 % CODE_ALPHABET.length);
  let current = '';
  while (groups.length < 5) {
    for (const b of randomBytes(32)) {
      if (b >= limit) continue;
      current += CODE_ALPHABET[b % CODE_ALPHABET.length];
      if (current.length === 4) {
        groups.push(current);
        current = '';
        if (groups.length === 5) break;
      }
    }
  }
  return `${prefix}-${groups.join('-')}`;
}

/** Codes are typed by people, so accept lowercase, spaces and missing dashes. */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
