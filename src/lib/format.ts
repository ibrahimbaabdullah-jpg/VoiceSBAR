export function formatMinutes(seconds: number): string {
  const m = seconds / 60;
  if (m === 0) return '0';
  if (m < 10) return (Math.round(m * 10) / 10).toString();
  return Math.round(m).toString();
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDay(epochSec: number): string {
  return new Date(epochSec * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const LANGUAGE_NAMES: Record<string, string> = {
  ar: 'Arabic',
  ara: 'Arabic',
  en: 'English',
  eng: 'English',
};

export function languageName(code: string | null | undefined): string {
  if (!code) return 'Unknown';
  return LANGUAGE_NAMES[code.toLowerCase()] ?? code;
}

/** Human name for a KeyboardEvent.code, e.g. "KeyR" → "R", "Space" → "Space". */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const names: Record<string, string> = {
    Space: 'Space',
    Backquote: '`',
    AltLeft: 'Left Alt',
    AltRight: 'Right Alt',
    ControlLeft: 'Left Ctrl',
    ControlRight: 'Right Ctrl',
    ShiftLeft: 'Left Shift',
    ShiftRight: 'Right Shift',
    MetaLeft: 'Left ⌘/Win',
    MetaRight: 'Right ⌘/Win',
    CapsLock: 'Caps Lock',
    Insert: 'Insert',
    Pause: 'Pause',
    ScrollLock: 'Scroll Lock',
  };
  return names[code] ?? code;
}
