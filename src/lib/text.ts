// Helpers for mixed Arabic (right-to-left) and English (left-to-right) text.

const RTL_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const LTR_CHAR = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/;

/** Direction of the first strongly-directional character, like the HTML dir="auto" rule. */
export function detectDirection(text: string): 'rtl' | 'ltr' {
  for (const ch of text) {
    if (RTL_CHAR.test(ch)) return 'rtl';
    if (LTR_CHAR.test(ch)) return 'ltr';
  }
  return 'ltr';
}

export function hasArabic(text: string): boolean {
  return RTL_CHAR.test(text);
}

export interface InsertResult {
  text: string;
  /** Caret position right after the inserted text. */
  caret: number;
}

/**
 * Inserts `insertion` at `position` (or at the end), adding a space so words from separate
 * recordings do not run together. When appending a piece whose direction differs from the last
 * paragraph (Arabic after English or the reverse), it starts a new line so each paragraph keeps
 * a single reading direction.
 */
export function insertText(current: string, insertion: string, position?: number | null): InsertResult {
  const piece = insertion.trim();
  if (!piece) return { text: current, caret: position ?? current.length };
  const at = position === null || position === undefined || position < 0 || position > current.length
    ? current.length
    : position;
  const before = current.slice(0, at);
  const after = current.slice(at);
  let lead = '';
  if (before.length > 0 && !/\s$/.test(before)) {
    const lastParagraph = before.slice(before.lastIndexOf('\n') + 1);
    lead = !after && detectDirection(lastParagraph) !== detectDirection(piece) ? '\n' : ' ';
  }
  const needsSpaceAfter = after.length > 0 && !/^\s/.test(after);
  const inserted = `${lead}${piece}${needsSpaceAfter ? ' ' : ''}`;
  return { text: before + inserted + after, caret: before.length + inserted.length - (needsSpaceAfter ? 1 : 0) };
}

export function wordCount(text: string): number {
  return (text.match(/[\p{L}\p{N}]+/gu) ?? []).length;
}
