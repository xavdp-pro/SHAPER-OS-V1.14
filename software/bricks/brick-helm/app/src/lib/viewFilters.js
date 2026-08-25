const KEYS = {
  thinking: 'helm-filter-thinking',
  tools: 'helm-filter-tools',
  terminal: 'helm-filter-terminal',
  logs: 'helm-filter-logs',
};

function loadBool(key, defaultValue = true) {
  try {
    const v = localStorage.getItem(key);
    if (v === '0' || v === 'false') return false;
    if (v === '1' || v === 'true') return true;
  } catch {
    /* ignore */
  }
  return defaultValue;
}

function saveBool(key, value) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export const DEFAULT_VIEW_FILTERS = {
  thinking: true,
  tools: true,
  terminal: true,
  logs: true,
};

export const VIEW_PRESETS = {
  all: {
    id: 'all',
    label: 'Tout afficher',
    filters: { thinking: true, tools: true, terminal: true, logs: true },
  },
  responseOnly: {
    id: 'responseOnly',
    label: 'Réponse seule',
    filters: { thinking: false, tools: false, terminal: false, logs: false },
  },
  noThinking: {
    id: 'noThinking',
    label: 'Sans réflexion',
    filters: { thinking: false, tools: true, terminal: true, logs: true },
  },
  noTools: {
    id: 'noTools',
    label: 'Sans outils',
    filters: { thinking: true, tools: false, terminal: false, logs: false },
  },
  none: {
    id: 'none',
    label: 'Tout masquer',
    filters: { thinking: false, tools: false, terminal: false, logs: false },
  },
};

/** True if the user has already made an explicit display choice. */
export function hasStoredViewFilters() {
  try {
    return Object.values(KEYS).some((k) => localStorage.getItem(k) != null);
  } catch {
    return false;
  }
}

/**
 * Default filters by role: a standard (non-admin) user sees
 * the conversation alone — thinking, tools, terminal, and logs are hidden
 * (simple mode). Admin/power users see everything. An explicit choice
 * (localStorage) always takes precedence.
 */
export function defaultFiltersForRole(role) {
  const admin = String(role || '').toLowerCase() === 'admin';
  return admin
    ? { ...VIEW_PRESETS.all.filters }
    : { ...VIEW_PRESETS.responseOnly.filters };
}

export function loadViewFilters(role) {
  if (role !== undefined && !hasStoredViewFilters()) {
    return defaultFiltersForRole(role);
  }
  return {
    thinking: loadBool(KEYS.thinking, true),
    tools: loadBool(KEYS.tools, true),
    terminal: loadBool(KEYS.terminal, true),
    logs: loadBool(KEYS.logs, true),
  };
}

export function saveViewFilters(filters) {
  const next = { ...DEFAULT_VIEW_FILTERS, ...filters };
  Object.entries(next).forEach(([name, enabled]) => {
    if (name in KEYS) saveBool(KEYS[name], enabled);
  });
  return next;
}

export function saveViewFilter(name, enabled) {
  if (!(name in KEYS)) return;
  saveBool(KEYS[name], Boolean(enabled));
}

export function toggleViewFilter(filters, name) {
  const next = { ...filters, [name]: !filters[name] };
  saveViewFilter(name, next[name]);
  return next;
}

export function applyViewPreset(presetId) {
  const preset = VIEW_PRESETS[presetId];
  if (!preset) return loadViewFilters();
  return saveViewFilters(preset.filters);
}

export const FILTER_LABELS = {
  thinking: 'Réflexion',
  tools: 'Outils',
  terminal: 'Terminal',
  logs: 'Logs',
};
