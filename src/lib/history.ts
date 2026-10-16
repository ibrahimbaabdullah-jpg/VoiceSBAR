import { useCallback, useState } from 'react';
import { readJson, removeKey, writeJson } from './storage';

/** Transcripts are kept only in this browser; the server never stores them. */
export interface HistoryEntry {
  id: string;
  createdAt: number;
  text: string;
  rawText: string;
  languageCode: string | null;
  durationSeconds: number;
  enhanced: boolean;
}

export const HISTORY_LIMIT = 200;

const keyFor = (username: string) => `wtc.history.v1.${username.toLowerCase()}`;

export function loadHistory(username: string): HistoryEntry[] {
  const list = readJson<HistoryEntry[]>(keyFor(username), []);
  return Array.isArray(list) ? list : [];
}

export function clearStoredHistory(username: string): void {
  removeKey(keyFor(username));
}

function newId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useHistory(username: string) {
  // The signed-in view is remounted for each user, so the initial load is enough.
  const [entries, setEntries] = useState<HistoryEntry[]>(() => loadHistory(username));

  const persist = useCallback(
    (next: HistoryEntry[]) => {
      // If storage is full, drop the oldest half and try once more.
      if (!writeJson(keyFor(username), next)) writeJson(keyFor(username), next.slice(0, Math.floor(next.length / 2)));
    },
    [username],
  );

  const add = useCallback(
    (entry: Omit<HistoryEntry, 'id' | 'createdAt'>) => {
      setEntries((prev) => {
        const next = [{ ...entry, id: newId(), createdAt: Date.now() }, ...prev].slice(0, HISTORY_LIMIT);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const remove = useCallback(
    (id: string) => {
      setEntries((prev) => {
        const next = prev.filter((e) => e.id !== id);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const clear = useCallback(() => {
    clearStoredHistory(username);
    setEntries([]);
  }, [username]);

  return { entries, add, remove, clear };
}
