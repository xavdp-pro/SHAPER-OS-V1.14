/** Final segment of a machine/user/conversation path. */
export function convNameFromPath(path) {
  const raw = String(path || '');
  const idx = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf(':'));
  return idx >= 0 ? raw.slice(idx + 1) : raw;
}

/** Human display label for a CLI node (agy → Antigravity). */
const NODE_DISPLAY_LABELS = {
  agy: 'Antigravity',
  antigravity: 'Antigravity',
  cursor: 'Cursor',
  claude: 'Claude Code',
  opencode: 'OpenCode',
};

export function displayNodeLabel(node) {
  const key = String(node || '').trim().toLowerCase();
  return NODE_DISPLAY_LABELS[key] || String(node || '').trim() || '—';
}

/** Deconstructs machine/user/name. */
export function parseConversationPath(path) {
  const parts = String(path || '').trim().split(/[/:]/).filter(Boolean);
  if (parts.length >= 3) {
    return {
      node: parts[0],
      user: parts[1],
      name: parts.slice(2).join('/'),
      path: `${parts[0]}/${parts[1]}/${parts.slice(2).join('/')}`,
    };
  }
  if (parts.length === 2) {
    return { node: parts[0], user: '', name: parts[1], path: '' };
  }
  return { node: '', user: '', name: parts[0] || '', path: '' };
}

/** Builds canonical machine/user/name path. */
export function buildConversationPath(node, user, name) {
  const n = String(node || '').trim();
  const u = String(user || '').trim();
  const c = String(name || '').trim();
  if (!n || !u || !c) return '';
  return `${n}/${u}/${c}`;
}

const LOCAL_KEY = 'helm-local-conversations';

export function loadLocalConversationPaths() {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((p) => typeof p === 'string' && p.includes('/')) : [];
  } catch {
    return [];
  }
}

export function rememberLocalConversation(path) {
  const key = String(path || '').trim();
  if (!key) return;
  const prev = loadLocalConversationPaths();
  if (!prev.includes(key)) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify([...prev, key]));
  }
}

export function forgetLocalConversation(path) {
  const key = String(path || '').trim();
  if (!key) return;
  const next = loadLocalConversationPaths().filter((p) => p !== key);
  localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
}

export function conversationEntryFromPath(path) {
  const { node, user, name } = parseConversationPath(path);
  return {
    id: path,
    path,
    name: name || convNameFromPath(path),
    node,
    user,
    port: 4200,
    local: true,
  };
}

/** Normalizes to machine/user/name (1 or 2 segment shortcuts). */
export function normalizeConversationPath(input, { node = 'local', user = 'zaza' } = {}) {
  const parts = String(input || '').trim().split(/[/:]/).filter(Boolean);
  if (parts.length >= 3) return parts.join('/');
  if (parts.length === 2) return `${parts[0]}/${user}/${parts[1]}`;
  if (parts.length === 1) return `${node}/${user}/${parts[0]}`;
  return '';
}

/** Same bridge conversation (final segment) between old and new path. */
export function pathsMatchConversation(a, b) {
  return convNameFromPath(a) === convNameFromPath(b);
}

/** `/console/node/user/name` — bookmarkable. */
export function conversationPathToUrl(path) {
  const raw = String(path || '').trim();
  if (!raw) return '/console';
  const segments = raw.split('/').filter(Boolean).map(encodeURIComponent);
  return `/console/${segments.join('/')}`;
}

/** Extract conversation path from `/console/...` pathname. */
export function conversationPathFromLocation(pathname) {
  const raw = String(pathname || '');
  if (!raw.startsWith('/console')) return '';
  const rest = raw.slice('/console'.length).replace(/^\//, '');
  if (!rest) return '';
  try {
    return rest.split('/').filter(Boolean).map(decodeURIComponent).join('/');
  } catch {
    return rest.split('/').filter(Boolean).join('/');
  }
}

/**
 * Resolve a URL path (full or name-only) against known conversation paths.
 * Returns a concrete path to open, or '' if nothing matches.
 */
export function resolveConversationFromUrl(urlPath, availablePaths = []) {
  const want = String(urlPath || '').trim();
  if (!want) return '';
  const list = Array.isArray(availablePaths) ? availablePaths.filter(Boolean) : [];
  const exact = list.find((p) => p === want);
  if (exact) return exact;
  const byName = list.find((p) => pathsMatchConversation(p, want));
  if (byName) return byName;
  // Full path not listed yet (new / local) — still bookmarkable
  if (want.includes('/')) return want;
  return '';
}
