export const DISPLAY_MODES = ['expanded', 'collapsed', 'hidden'];

const CONFIG = {
  thinking: {
    storageKey: 'helm-thinking-mode',
    titles: {
      expanded: 'Réflexions dépliées — clic pour replier',
      collapsed: 'Réflexions repliées — clic pour masquer',
      hidden: 'Réflexions masquées — clic pour déplier',
    },
  },
  tool: {
    storageKey: 'helm-tool-mode',
    titles: {
      expanded: 'Outils dépliés — clic pour replier',
      collapsed: 'Outils repliés — clic pour masquer',
      hidden: 'Outils masqués — clic pour déplier',
    },
  },
  log: {
    storageKey: 'helm-log-mode',
    titles: {
      expanded: 'Logs dépliés — clic pour replier',
      collapsed: 'Logs repliés — clic pour masquer',
      hidden: 'Logs masqués — clic pour déplier',
    },
  },
};

export function loadDisplayMode(kind) {
  const cfg = CONFIG[kind];
  if (!cfg) return 'collapsed';
  try {
    const v = localStorage.getItem(cfg.storageKey);
    return DISPLAY_MODES.includes(v) ? v : (kind === 'tool' ? 'expanded' : 'collapsed');
  } catch {
    return 'collapsed';
  }
}

export function saveDisplayMode(kind, mode) {
  const cfg = CONFIG[kind];
  if (!cfg || !DISPLAY_MODES.includes(mode)) return;
  try {
    localStorage.setItem(cfg.storageKey, mode);
  } catch {
    /* ignore */
  }
}

export function nextDisplayMode(current) {
  const i = DISPLAY_MODES.indexOf(current);
  return DISPLAY_MODES[(i + 1) % DISPLAY_MODES.length];
}

export function displayModeTitle(kind, mode) {
  return CONFIG[kind]?.titles[mode] || mode;
}

/** @deprecated — utiliser displayPrefs */
export const THINKING_MODES = DISPLAY_MODES;
export const loadThinkingMode = () => loadDisplayMode('thinking');
export const saveThinkingMode = (mode) => saveDisplayMode('thinking', mode);
export const nextThinkingMode = nextDisplayMode;
export const thinkingModeTitle = (mode) => displayModeTitle('thinking', mode);
