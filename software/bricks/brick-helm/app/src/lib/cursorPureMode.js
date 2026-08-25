/** Cursor IDE–style chat: no auto prime, Groq ack, or help nudge. */

const STORAGE_KEY = 'helm-cursor-pure';

export function loadCursorPureMode() {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_HELM_CURSOR_PURE === '1') return true;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === '1' || v === 'true') return true;
    if (v === '0' || v === 'false') return false;
  } catch {
    /* ignore */
  }
  return false;
}

export function saveCursorPureMode(enabled) {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    /* ignore */
  }
}
