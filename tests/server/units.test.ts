import { describe, expect, it } from 'vitest';
import {
  fromBase64Url,
  generateCode,
  hashPasswordKey,
  normalizeCode,
  timingSafeEqual,
  toBase64Url,
  verifyPasswordKey,
} from '../../server/crypto';
import { cleanModelOutput } from '../../server/enhance';
import { loadConfig } from '../../server/env';
import { periodKeys } from '../../server/time';
import { numberTokens, technicalTokens, tokenEditDistance, verifyEnhancement, wordTokens } from '../../server/verify';
import { checkKeyterm, checkKeytermList } from '../../shared/rules';
import type { Env } from '../../server/env';
import { pwKey } from './harness';

describe('verifyEnhancement', () => {
  const accept = (a: string, b: string) => expect(verifyEnhancement(a, b)).toEqual({ ok: true });
  const reject = (a: string, b: string, reason: RegExp) => {
    const r = verifyEnhancement(a, b);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(reason);
  };

  it('accepts punctuation and capitalisation fixes', () => {
    accept('the results were significant p less than 0.05', 'The results were significant, p less than 0.05.');
    accept('هل تناول المريض الدواء', 'هل تناول المريض الدواء؟');
    accept(
      'المريض عنده hypertension و نعطيه amlodipine خمسة mg مرة يوميا',
      'المريض عنده hypertension، و نعطيه amlodipine خمسة mg مرة يومياً.',
    );
  });

  it('tolerates Arabic spelling normalisation (hamza, ta marbuta, alef maqsura, tashkeel)', () => {
    accept('اعطيته الدواء في المدرسه علي الطاوله', 'أعطيته الدواءَ في المدرسة على الطاولة.');
  });

  it('treats Arabic-Indic and Western digits as the same value', () => {
    accept('الجرعة ٥٠٠ ملغ', 'الجرعة 500 ملغ.');
  });

  it('rejects changed, added or removed numbers', () => {
    reject('dose is 2.5 mg', 'Dose is 25 mg.', /number/);
    reject('dose is 5 mg', 'Dose is 5 mg twice, 2 times.', /number/);
    reject('take 3 tablets', 'Take tablets.', /number/);
  });

  it('rejects changed acronyms and technical terms', () => {
    reject('HbA1c was high', 'HBA1C was high.', /HbA1c/);
    reject('mRNA vaccine', 'MRNA vaccine.', /mRNA/);
    reject('IL-6 levels', 'IL 6 levels.', /IL-6/);
  });

  it('rejects translation and rewording', () => {
    reject('المريض عنده ضغط', 'The patient has high blood pressure.', /wording|added/);
    reject('we gave metformin', 'We gave metformin and insulin.', /wording/);
    reject('we gave metformin and insulin today', 'We gave metformin.', /wording/);
    reject('patient takes metformin', 'Patient takes metformine.', /wording/);
  });

  it('rejects empty and padded output', () => {
    reject('hello', '   ', /empty/);
    reject('hi', 'hi '.repeat(40), /added/);
  });

  it('allows a tiny amount of token drift on long texts only', () => {
    const long = Array.from({ length: 80 }, (_, i) => `word${i % 7 ? 'a' : 'b'}`).join(' ');
    accept(long, long.replace('worda', 'world'));
    reject('a short note', 'a short notes', /wording/);
  });
});

describe('verify helpers', () => {
  it('tokenises mixed scripts', () => {
    expect(wordTokens('Hello، مرحباً world!')).toEqual(['hello', 'مرحبا', 'world']);
    expect(numberTokens('1,000 و ٢٫٥ and 3')).toEqual(['1,000', '2.5', '3']);
    expect(technicalTokens('The DNA and mRNA of IL-6 in B12, not The or A')).toEqual(['DNA', 'mRNA', 'IL-6', 'B12']);
  });

  it('computes token edit distance', () => {
    expect(tokenEditDistance(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(0);
    expect(tokenEditDistance(['a', 'b', 'c'], ['a', 'c'])).toBe(1);
    expect(tokenEditDistance(['a', 'b'], ['a', 'x'])).toBe(2);
    expect(tokenEditDistance([], ['a'])).toBe(1);
  });
});

describe('cleanModelOutput', () => {
  it('strips wrappers the model may add', () => {
    expect(cleanModelOutput('```\nHello.\n```', 'hello')).toBe('Hello.');
    expect(cleanModelOutput('<transcript>\nHello.\n</transcript>', 'hello')).toBe('Hello.');
    expect(cleanModelOutput('"Hello."', 'hello')).toBe('Hello.');
    expect(cleanModelOutput('"Hello."', '"hello"')).toBe('"Hello."');
  });
});

describe('crypto helpers', () => {
  it('round-trips base64url', () => {
    const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
  });

  it('hashes password keys with a random salt and verifies them', async () => {
    const key = pwKey('secret');
    const a = await hashPasswordKey(key);
    const b = await hashPasswordKey(key);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^v1\$[\w-]{22}\$[\w-]{43}$/);
    expect(await verifyPasswordKey(key, a)).toBe(true);
    expect(await verifyPasswordKey(pwKey('other'), a)).toBe(false);
    expect(await verifyPasswordKey(key, 'garbage')).toBe(false);
  });

  it('generates readable single-use codes', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateCode()));
    expect(codes.size).toBe(200);
    for (const code of codes) expect(code).toMatch(/^WTC-[A-HJKMNP-TV-Z2-9]{4}(-[A-HJKMNP-TV-Z2-9]{4}){4}$/);
    expect(normalizeCode(' wtc-ab12 cd34 ')).toBe('WTCAB12CD34');
  });

  it('compares in constant time', () => {
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 0]))).toBe(false);
  });
});

describe('keyterm rules', () => {
  it('validates single terms', () => {
    expect(checkKeyterm('  Kaplan   Meier ')).toEqual({ ok: true, value: 'Kaplan Meier' });
    expect(checkKeyterm('x'.repeat(50)).ok).toBe(false);
    expect(checkKeyterm('x'.repeat(49)).ok).toBe(true);
    expect(checkKeyterm('a b c d e f').ok).toBe(false);
    expect(checkKeyterm('{json}').ok).toBe(false);
    expect(checkKeyterm('').ok).toBe(false);
  });

  it('dedupes lists case-insensitively and caps the size', () => {
    const res = checkKeytermList(['ECG', 'ecg', ' ', 'تخطيط القلب']);
    expect(res).toEqual({ terms: ['ECG', 'تخطيط القلب'], errors: [] });
    const many = checkKeytermList(Array.from({ length: 105 }, (_, i) => `t${i}`));
    expect(many.terms).toHaveLength(100);
    expect(many.errors).toHaveLength(1);
  });
});

describe('config and time', () => {
  it('uses safe defaults and ignores invalid values', () => {
    const cfg = loadConfig({ DB: {} as Env['DB'], MAX_UPLOAD_MB: 'lots', USAGE_TIME_ZONE: 'Mars/Base' });
    expect(cfg.elevenlabs).toMatchObject({ modelId: 'scribe_v2', baseUrl: 'https://api.elevenlabs.io', apiKey: null });
    expect(cfg.enhance).toMatchObject({ model: 'gpt-6-luna', reasoningEffort: 'none', apiKey: null });
    expect(cfg.maxUploadBytes).toBe(25 * 1024 * 1024);
    expect(cfg.timeZone).toBe('UTC');
    expect(cfg.defaultDailySeconds).toBe(1800);
  });

  it('computes day and month keys in the configured time zone', () => {
    const t = Date.UTC(2026, 9, 31, 22, 30); // 22:30 UTC on 31 Oct = 01:30 on 1 Nov in Riyadh
    expect(periodKeys(t, 'UTC')).toEqual({ day: '2026-10-31', month: '2026-10' });
    expect(periodKeys(t, 'Asia/Riyadh')).toEqual({ day: '2026-11-01', month: '2026-11' });
  });
});
