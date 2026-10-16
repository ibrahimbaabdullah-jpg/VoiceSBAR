import { useEffect, useLayoutEffect, useRef } from 'react';

/** Keys that produce text, so they must not trigger recording while the user is typing. */
export function isTypingKey(code: string): boolean {
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return false;
  if (/^(Alt|Control|Shift|Meta)(Left|Right)$/.test(code)) return false;
  if (['Pause', 'ScrollLock', 'Insert', 'CapsLock', 'ContextMenu', 'Escape'].includes(code)) return false;
  return true;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file'].includes(type);
  }
  return false;
}

interface HotkeyOptions {
  code: string;
  enabled: boolean;
  onPress: () => void;
  onRelease: () => void;
}

/**
 * Press-and-release handling for one key, active only while this page has focus. Releases
 * automatically when the window loses focus so a recording can never get stuck "on".
 */
export function useHotkey({ code, enabled, onPress, onRelease }: HotkeyOptions) {
  const held = useRef(false);
  const handlers = useRef({ onPress, onRelease });
  useLayoutEffect(() => {
    handlers.current = { onPress, onRelease };
  });

  useEffect(() => {
    if (!enabled || !code) return;

    const release = () => {
      if (!held.current) return;
      held.current = false;
      handlers.current.onRelease();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== code) return;
      if (isTypingKey(code) && isEditableTarget(e.target)) return;
      if (isTypingKey(code) && (e.ctrlKey || e.metaKey || e.altKey)) return;
      e.preventDefault(); // also stops Space from "clicking" a focused button or scrolling
      if (e.repeat || held.current) return;
      held.current = true;
      handlers.current.onPress();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== code) return;
      if (held.current) e.preventDefault();
      release();
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') release();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', onHidden);
      held.current = false;
    };
  }, [code, enabled]);
}
