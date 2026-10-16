export type CopyMethod = 'clipboard' | 'fallback' | 'failed';

/**
 * Copies text, falling back to the legacy execCommand path when the async Clipboard API is
 * missing or blocked (e.g. no user gesture on Safari, or an embedded/insecure context).
 */
export async function copyText(text: string): Promise<CopyMethod> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return 'clipboard';
    } catch {
      // fall through to the legacy path
    }
  }
  return legacyCopy(text) ? 'fallback' : 'failed';
}

function legacyCopy(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '0';
  area.style.opacity = '0';
  area.style.pointerEvents = 'none';
  document.body.appendChild(area);
  const selection = document.getSelection();
  const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  area.select();
  area.setSelectionRange(0, text.length);
  let ok: boolean;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(area);
  if (previous && selection) {
    selection.removeAllRanges();
    selection.addRange(previous);
  }
  return ok;
}
