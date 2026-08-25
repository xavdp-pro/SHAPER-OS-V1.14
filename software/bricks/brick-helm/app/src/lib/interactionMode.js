/** Mobile interaction level. Desktop layout ignores this (always full console). */

export const INTERACTION_MODES = ['route', 'view', 'remote'];

const STORAGE_KEY = 'helm-interaction-mode';

export function normalizeInteractionMode(raw) {
  const v = String(raw || '').trim().toLowerCase();
  return INTERACTION_MODES.includes(v) ? v : 'view';
}

export function loadInteractionMode() {
  try {
    return normalizeInteractionMode(localStorage.getItem(STORAGE_KEY));
  } catch {
    return 'view';
  }
}

export function saveInteractionMode(mode) {
  try {
    localStorage.setItem(STORAGE_KEY, normalizeInteractionMode(mode));
  } catch {
    /* ignore */
  }
}
