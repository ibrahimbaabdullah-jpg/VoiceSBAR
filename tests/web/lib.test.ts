import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pickMimeType, toMicrophoneError } from '../../src/audio/recorder';
import { isEditableTarget, isTypingKey } from '../../src/hooks/useHotkey';
import { copyText } from '../../src/lib/clipboard';
import { formatClock, formatMinutes, keyLabel, languageName } from '../../src/lib/format';
import { loadHistory, useHistory } from '../../src/lib/history';
import { DEFAULT_SETTINGS, loadSettings, useSettings } from '../../src/lib/settings';
import { detectDirection, insertText, wordCount } from '../../src/lib/text';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('text helpers', () => {
  it('detects the direction from the first strong character', () => {
    expect(detectDirection('مرحبا hello')).toBe('rtl');
    expect(detectDirection('  123 hello مرحبا')).toBe('ltr');
    expect(detectDirection('٣ أقراص')).toBe('rtl');
    expect(detectDirection('')).toBe('ltr');
  });

  it('inserts with sensible spacing at the caret or the end', () => {
    expect(insertText('', 'hello')).toEqual({ text: 'hello', caret: 5 });
    expect(insertText('hello', 'world')).toEqual({ text: 'hello world', caret: 11 });
    expect(insertText('hello ', 'world')).toEqual({ text: 'hello world', caret: 11 });
    expect(insertText('one three', 'two', 3)).toEqual({ text: 'one two three', caret: 7 });
    expect(insertText('abc', '  ')).toEqual({ text: 'abc', caret: 3 });
    expect(insertText('abc', 'x', 99).text).toBe('abc x');
  });

  it('starts a new line when an appended piece changes reading direction', () => {
    expect(insertText('المريض بخير', 'The patient is stable.').text).toBe('المريض بخير\nThe patient is stable.');
    expect(insertText('Line one\nالمريض', 'بخير').text).toBe('Line one\nالمريض بخير');
    expect(insertText('English here', 'عربي', 7).text).toBe('English عربي here');
  });

  it('counts words in both scripts', () => {
    expect(wordCount('المريض عنده hypertension, 5 mg')).toBe(5);
  });
});

describe('formatting', () => {
  it('formats minutes, clocks, languages and keys', () => {
    expect(formatMinutes(0)).toBe('0');
    expect(formatMinutes(90)).toBe('1.5');
    expect(formatMinutes(1800)).toBe('30');
    expect(formatClock(65.4)).toBe('1:05');
    expect(languageName('ara')).toBe('Arabic');
    expect(languageName('en')).toBe('English');
    expect(languageName(null)).toBe('Unknown');
    expect(keyLabel('KeyR')).toBe('R');
    expect(keyLabel('F2')).toBe('F2');
    expect(keyLabel('AltRight')).toBe('Right Alt');
  });
});

describe('hotkey helpers', () => {
  it('treats function and modifier keys as safe while typing', () => {
    expect(isTypingKey('Space')).toBe(true);
    expect(isTypingKey('KeyA')).toBe(true);
    expect(isTypingKey('F2')).toBe(false);
    expect(isTypingKey('F12')).toBe(false);
    expect(isTypingKey('AltRight')).toBe(false);
  });

  it('recognises editable targets', () => {
    expect(isEditableTarget(document.createElement('textarea'))).toBe(true);
    expect(isEditableTarget(document.createElement('input'))).toBe(true);
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    expect(isEditableTarget(checkbox)).toBe(false);
    expect(isEditableTarget(document.createElement('button'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe('clipboard', () => {
  it('uses the async Clipboard API when allowed', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    expect(await copyText('نص')).toBe('clipboard');
    expect(writeText).toHaveBeenCalledWith('نص');
    vi.unstubAllGlobals();
  });

  it('falls back to execCommand when the Clipboard API is blocked', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    const exec = vi.fn().mockReturnValue(true);
    document.execCommand = exec;
    expect(await copyText('hello')).toBe('fallback');
    expect(exec).toHaveBeenCalledWith('copy');
    vi.unstubAllGlobals();
  });

  it('reports failure when nothing works', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    document.execCommand = vi.fn().mockImplementation(() => {
      throw new Error('nope');
    });
    expect(await copyText('hello')).toBe('failed');
    vi.unstubAllGlobals();
  });
});

describe('settings', () => {
  it('starts from defaults and persists changes', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    const { result } = renderHook(() => useSettings());
    act(() => result.current[1]({ enhance: true, hotkey: 'F2' }));
    expect(result.current[0]).toMatchObject({ enhance: true, hotkey: 'F2', mode: 'hold' });
    expect(loadSettings()).toMatchObject({ enhance: true, hotkey: 'F2' });
  });

  it('survives corrupt storage', () => {
    localStorage.setItem('wtc.settings.v1', '{not json');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('history', () => {
  it('stores entries per user, newest first, and can delete and clear', () => {
    const { result } = renderHook(() => useHistory('Sara'));
    act(() => result.current.add({ text: 'one', rawText: 'one', languageCode: 'en', durationSeconds: 1, enhanced: false }));
    act(() => result.current.add({ text: 'اثنان', rawText: 'اثنان', languageCode: 'ar', durationSeconds: 2, enhanced: false }));
    expect(result.current.entries.map((e) => e.text)).toEqual(['اثنان', 'one']);
    expect(loadHistory('sara')).toHaveLength(2);
    expect(loadHistory('omar')).toHaveLength(0);
    act(() => result.current.remove(result.current.entries[0]!.id));
    expect(loadHistory('sara').map((e) => e.text)).toEqual(['one']);
    act(() => result.current.clear());
    expect(loadHistory('sara')).toEqual([]);
  });
});

describe('recorder helpers', () => {
  it('prefers Opus in WebM, then Safari MP4', () => {
    expect(pickMimeType((t) => t.startsWith('audio/webm'))).toBe('audio/webm;codecs=opus');
    expect(pickMimeType((t) => t.startsWith('audio/mp4'))).toBe('audio/mp4;codecs=mp4a.40.2');
    expect(pickMimeType(() => false)).toBeUndefined();
    expect(
      pickMimeType(() => {
        throw new Error('boom');
      }),
    ).toBeUndefined();
  });

  it('turns getUserMedia errors into helpful messages', () => {
    const named = (name: string) => Object.assign(new Error(name), { name });
    expect(toMicrophoneError(named('NotAllowedError')).kind).toBe('denied');
    expect(toMicrophoneError(named('NotFoundError')).kind).toBe('not_found');
    expect(toMicrophoneError(named('NotReadableError')).kind).toBe('busy');
    expect(toMicrophoneError(named('SecurityError')).kind).toBe('insecure');
    expect(toMicrophoneError('weird').kind).toBe('unknown');
    expect(toMicrophoneError(named('NotAllowedError')).message).toMatch(/allow the microphone/);
  });
});
