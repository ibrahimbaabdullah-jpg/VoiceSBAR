// Every string the recorder passes through L() needs an Arabic entry, or the Arabic Handoff tab
// would silently show English.
import { describe, expect, it } from 'vitest';
import { RECORDER_AR, trRecorder } from '../../shared/sbarI18n';
import source from '../../src/components/DictatePanel.tsx?raw';

/** String literals inside each L(...) call; plain lowercase words are comparisons like 'hold'. */
function recorderStrings(source: string): string[] {
  const found = new Set<string>();
  for (let i = source.indexOf('L('); i !== -1; i = source.indexOf('L(', i + 2)) {
    if (/[\w.]/.test(source[i - 1] ?? '')) continue; // e.g. trRecorder(, URL(
    let depth = 0;
    let end = i + 1;
    for (; end < source.length; end++) {
      if (source[end] === '(') depth++;
      if (source[end] === ')' && --depth === 0) break;
    }
    for (const m of source.slice(i, end).matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)) {
      const text = m[1] ?? m[2] ?? '';
      if (text && !/^[a-z]+$/.test(text)) found.add(text.replace(/\\'/g, "'"));
    }
  }
  return [...found];
}

describe('recorder translations', () => {
  const strings = recorderStrings(source);

  it('finds the recorder strings', () => {
    expect(strings).toContain('Hold to talk');
    expect(strings).toContain('Listening… {elapsed} / {max}');
    expect(strings.length).toBeGreaterThan(40);
  });

  it('has an Arabic translation for every recorder string', () => {
    expect(strings.filter((text) => !Object.hasOwn(RECORDER_AR, text))).toEqual([]);
  });

  it('keeps placeholders and English output unchanged', () => {
    for (const [english, arabic] of Object.entries(RECORDER_AR)) {
      expect(arabic.match(/\{\w+\}/g) ?? []).toEqual(english.match(/\{\w+\}/g) ?? []);
    }
    expect(trRecorder('Listening… {elapsed} / {max}', 'en', { elapsed: '0:05', max: '5:00' })).toBe('Listening… 0:05 / 5:00');
    expect(trRecorder('Listening… {elapsed} / {max}', 'ar', { elapsed: '0:05', max: '5:00' })).toBe('جارٍ التسجيل… 0:05 / 5:00');
  });
});
