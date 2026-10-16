// Deterministic guard for AI clean-up. The model is only allowed to change punctuation,
// capitalisation and spacing; if it changed numbers, technical terms or wording, we keep the
// original Scribe transcript instead.

export type VerifyResult = { ok: true } | { ok: false; reason: string };

const ARABIC_MARKS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g; // tashkeel + tatweel

function normalizeDigits(text: string): string {
  return text
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\u066B/g, '.') // Arabic decimal separator
    .replace(/\u066C/g, ','); // Arabic thousands separator
}

/** Folds spelling variants an editor may legitimately fix (hamza forms, ta marbuta, alef maqsura). */
function foldArabic(word: string): string {
  return word
    .replace(ARABIC_MARKS, '')
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
    .replace(/\u0629/g, '\u0647')
    .replace(/\u0649/g, '\u064A');
}

export function wordTokens(text: string): string[] {
  const normalized = normalizeDigits(text.normalize('NFKC'));
  return (normalized.match(/[\p{L}\p{M}\p{N}]+/gu) ?? [])
    .map((w) => foldArabic(w).toLowerCase())
    .filter(Boolean);
}

export function numberTokens(text: string): string[] {
  return (normalizeDigits(text.normalize('NFKC')).match(/\d+(?:[.,]\d+)*/g) ?? []).sort();
}

/**
 * Latin tokens whose exact spelling matters: acronyms (DNA), mixed case (mRNA, HbA1c),
 * letter+digit codes (COVID-19, IL-6, B12).
 */
export function technicalTokens(text: string): string[] {
  const out: string[] = [];
  for (const m of normalizeDigits(text.normalize('NFKC')).matchAll(/[A-Za-z0-9][A-Za-z0-9+\-/]*[A-Za-z0-9]|[A-Z]/g)) {
    const t = m[0];
    const hasLetter = /[A-Za-z]/.test(t);
    const hasDigit = /\d/.test(t);
    const innerUpper = /[A-Z]/.test(t.slice(1));
    if (hasLetter && (hasDigit || innerUpper)) out.push(t);
  }
  return out;
}

/** Number of insertions + deletions needed to turn `a` into `b` (via LCS). */
export function tokenEditDistance(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Uint32Array(b.length + 1);
  let curr = new Uint32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, curr[j - 1]!);
    }
    [prev, curr] = [curr, prev];
  }
  const lcs = prev[b.length]!;
  return a.length + b.length - 2 * lcs;
}

function sameMultiset(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const counts = new Map<string, number>();
  for (const x of a) counts.set(x, (counts.get(x) ?? 0) + 1);
  for (const x of b) {
    const n = counts.get(x);
    if (!n) return false;
    counts.set(x, n - 1);
  }
  return true;
}

export function verifyEnhancement(original: string, candidate: string): VerifyResult {
  if (!candidate.trim()) return { ok: false, reason: 'The AI returned empty text.' };
  if (candidate.length > original.length * 1.3 + 40) {
    return { ok: false, reason: 'The AI added text that was not spoken.' };
  }
  if (!sameMultiset(numberTokens(original), numberTokens(candidate))) {
    return { ok: false, reason: 'The AI changed a number.' };
  }
  for (const term of technicalTokens(original)) {
    if (!candidate.includes(term)) {
      return { ok: false, reason: `The AI changed the term “${term}”.` };
    }
  }
  const a = wordTokens(original);
  const b = wordTokens(candidate);
  const allowed = Math.floor(a.length / 40);
  if (tokenEditDistance(a, b) > allowed) {
    return { ok: false, reason: 'The AI changed the wording.' };
  }
  return { ok: true };
}
