// Validation rules shared by the browser and the server so both agree on what is valid.

export const APP_VERSION = '0.1.0';

/** ElevenLabs bills a 20-second minimum per request above 100 keyterms, so we stay at or below 100. */
export const KEYTERM_MAX_COUNT = 100;
export const KEYTERM_MAX_CHARS = 49; // ElevenLabs: "each under 50 characters"
export const KEYTERM_MAX_WORDS = 5;
const KEYTERM_FORBIDDEN = /[<>{}[\]\\]/;

export type KeytermCheck = { ok: true; value: string } | { ok: false; error: string };

/** Normalises and validates one vocabulary term against the ElevenLabs keyterm limits. */
export function checkKeyterm(raw: string): KeytermCheck {
  const value = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!value) return { ok: false, error: 'Term is empty.' };
  if ([...value].length > KEYTERM_MAX_CHARS) {
    return { ok: false, error: `Term must be under 50 characters.` };
  }
  if (value.split(' ').length > KEYTERM_MAX_WORDS) {
    return { ok: false, error: `Term can have at most ${KEYTERM_MAX_WORDS} words.` };
  }
  if (KEYTERM_FORBIDDEN.test(value)) {
    return { ok: false, error: 'Term cannot contain < > { } [ ] or \\.' };
  }
  return { ok: true, value };
}

export type KeytermListCheck = { terms: string[]; errors: { term: string; error: string }[] };

/** Validates a whole list: trims, removes case-insensitive duplicates and enforces the count limit. */
export function checkKeytermList(raw: readonly string[]): KeytermListCheck {
  const terms: string[] = [];
  const seen = new Set<string>();
  const errors: { term: string; error: string }[] = [];
  for (const item of raw) {
    if (!item.trim()) continue;
    const res = checkKeyterm(item);
    if (!res.ok) {
      errors.push({ term: item, error: res.error });
      continue;
    }
    const key = res.value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(res.value);
  }
  if (terms.length > KEYTERM_MAX_COUNT) {
    errors.push({
      term: terms.slice(KEYTERM_MAX_COUNT).join(', '),
      error: `Only ${KEYTERM_MAX_COUNT} terms are allowed.`,
    });
    terms.length = KEYTERM_MAX_COUNT;
  }
  return { terms, errors };
}

export const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,32}$/;
export const USERNAME_HINT = '3–32 characters: letters, numbers, dot, dash or underscore.';
export const PASSWORD_MIN_LENGTH = 10;

/**
 * Passwords are stretched in the browser (PBKDF2-SHA256, 600k iterations, salted with the
 * username) and the server stores an HMAC of that key with a random per-user salt. This keeps the
 * Worker well inside the Cloudflare free-plan CPU limit while an attacker who steals the database
 * still has to pay the full PBKDF2 cost for every password guess.
 */
export const CLIENT_KDF_ITERATIONS = 600_000;
export const CLIENT_KDF_SALT_PREFIX = 'whispertocursor:v1:';
/** base64url encoding of a 32-byte key. */
export const PASSWORD_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const LANGUAGE_HINTS = ['auto', 'ar', 'en'] as const;
export type LanguageHint = (typeof LANGUAGE_HINTS)[number];

/** Longest text the AI clean-up will accept, to bound cost and verification time. */
export const ENHANCE_MAX_CHARS = 8000;
