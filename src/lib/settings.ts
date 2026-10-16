import { useCallback, useState } from 'react';
import type { LanguageHint } from '../../shared/rules';
import { readJson, writeJson } from './storage';

export interface Settings {
  /** Hold to talk, or press once to start and again to stop. */
  mode: 'hold' | 'toggle';
  /** KeyboardEvent.code of the in-page shortcut. */
  hotkey: string;
  /** Microphone deviceId; empty means the browser default. */
  deviceId: string;
  language: LanguageHint;
  /** ElevenLabs no_verbatim: drop "um", "uh" and false starts. */
  removeFillers: boolean;
  enhance: boolean;
  useVocabulary: boolean;
  autoCopy: boolean;
  insertMode: 'append' | 'replace';
  saveHistory: boolean;
  keepMicOpen: boolean;
  textDirection: 'auto' | 'rtl' | 'ltr';
  /** Do not upload recordings in which no sound was detected (saves credits). */
  skipSilence: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'hold',
  hotkey: 'Space',
  deviceId: '',
  language: 'auto',
  removeFillers: true,
  enhance: false,
  useVocabulary: true,
  autoCopy: true,
  insertMode: 'append',
  saveHistory: true,
  keepMicOpen: false,
  textDirection: 'auto',
  skipSilence: true,
};

const KEY = 'wtc.settings.v1';

export function loadSettings(): Settings {
  const stored = readJson<Partial<Settings>>(KEY, {});
  return { ...DEFAULT_SETTINGS, ...stored };
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      writeJson(KEY, next);
      return next;
    });
  }, []);
  return [settings, update] as const;
}
