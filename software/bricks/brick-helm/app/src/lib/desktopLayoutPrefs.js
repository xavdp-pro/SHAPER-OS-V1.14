/** Desktop shell layout — persisted in localStorage (lg+ only). */

const DESKTOP_MQ = '(min-width: 1024px)';

const KEYS = {
  sidebarOpen: 'helm-desktop-sidebar-open',
  workspaceOpen: 'helm-desktop-workspace-open',
  vibeProjectId: 'helm-vibe-project-id',
  vibePreviewRoutes: 'helm-vibe-preview-routes',
  workspaceTab: 'helm-desktop-workspace-tab',
  vibeRemovedProjects: 'helm-vibe-removed-projects',
  vibeAddedProjects: 'helm-vibe-added-projects',
};

export function isDesktopLayout() {
  return typeof window !== 'undefined' && window.matchMedia(DESKTOP_MQ).matches;
}

function loadBool(key, defaultValue) {
  try {
    const v = localStorage.getItem(key);
    if (v === '1' || v === 'true') return true;
    if (v === '0' || v === 'false') return false;
  } catch {
    /* ignore */
  }
  return defaultValue;
}

function saveBool(key, value) {
  try {
    localStorage.setItem(key, Boolean(value) ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function loadSidebarOpen() {
  return loadBool(KEYS.sidebarOpen, true);
}

export function saveSidebarOpen(open) {
  saveBool(KEYS.sidebarOpen, open);
}

export function loadWorkspaceOpen() {
  return loadBool(KEYS.workspaceOpen, false);
}

export function saveWorkspaceOpen(open) {
  saveBool(KEYS.workspaceOpen, open);
}

export function loadVibeProjectId() {
  try {
    return localStorage.getItem(KEYS.vibeProjectId) || '';
  } catch {
    return '';
  }
}

export function saveVibeProjectId(id) {
  try {
    if (id) localStorage.setItem(KEYS.vibeProjectId, id);
    else localStorage.removeItem(KEYS.vibeProjectId);
  } catch {
    /* ignore */
  }
}

function loadPreviewRoutes() {
  try {
    const raw = localStorage.getItem(KEYS.vibePreviewRoutes);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function savePreviewRoutes(routes) {
  try {
    localStorage.setItem(KEYS.vibePreviewRoutes, JSON.stringify(routes));
  } catch {
    /* ignore */
  }
}

/** Relative path inside a vibe preview iframe (pathname + search + hash). */
export function loadVibePreviewPath(projectId) {
  if (!projectId) return '/';
  const routes = loadPreviewRoutes();
  const path = routes[projectId];
  return typeof path === 'string' && path ? path : '/';
}

export function saveVibePreviewPath(projectId, subPath) {
  if (!projectId) return;
  const routes = loadPreviewRoutes();
  const next = String(subPath || '/').trim() || '/';
  routes[projectId] = next;
  savePreviewRoutes(routes);
}

/** Build same-origin preview URL from API base path + saved sub-route. */
export function buildPreviewSrc(previewPath, subPath = '/') {
  const base = String(previewPath || '/').replace(/\/$/, '');
  const sub = String(subPath || '/').trim() || '/';
  if (sub === '/') return `${base}/`;
  const suffix = sub.startsWith('/') ? sub : `/${sub}`;
  return `${base}${suffix}`;
}

/** Extract sub-route from a preview iframe location (same-origin). */
export function previewSubPathFromLocation(projectId, location) {
  if (!projectId || !location) return '/';
  const prefix = `/api/preview/${projectId}`;
  let path = String(location.pathname || '/');
  if (path.startsWith(prefix)) path = path.slice(prefix.length) || '/';
  if (!path.startsWith('/')) path = `/${path}`;
  return `${path}${location.search || ''}${location.hash || ''}`;
}

export function loadWorkspaceTab() {
  try {
    const v = localStorage.getItem(KEYS.workspaceTab);
    if (v === 'preview' || v === 'debug' || v === 'browser') return v;
  } catch {
    /* ignore */
  }
  return 'preview';
}

export function saveWorkspaceTab(tab) {
  try {
    if (tab) localStorage.setItem(KEYS.workspaceTab, tab);
  } catch {
    /* ignore */
  }
}

/** Project ids removed from the workspace picker — UI only, nothing on disk. */
export function loadRemovedVibeProjects() {
  try {
    const raw = localStorage.getItem(KEYS.vibeRemovedProjects)
      || localStorage.getItem('helm-vibe-hidden-projects');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map((id) => String(id || '').trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

function saveRemovedVibeProjects(ids) {
  try {
    localStorage.setItem(KEYS.vibeRemovedProjects, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

export function removeVibeProjectFromList(projectId) {
  const id = String(projectId || '').trim();
  if (!id) return;
  const removed = loadRemovedVibeProjects();
  if (removed.includes(id)) return;
  saveRemovedVibeProjects([...removed, id]);
  const routes = loadPreviewRoutes();
  if (routes[id]) {
    delete routes[id];
    savePreviewRoutes(routes);
  }
}

export function loadAddedVibeProjects() {
  try {
    const raw = localStorage.getItem(KEYS.vibeAddedProjects);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map((id) => String(id || '').trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

export function registerAddedVibeProject(projectId) {
  const id = String(projectId || '').trim();
  if (!id) return;
  const added = loadAddedVibeProjects();
  if (added.includes(id)) return;
  try {
    localStorage.setItem(KEYS.vibeAddedProjects, JSON.stringify([...added, id]));
  } catch {
    /* ignore */
  }
}

/** Removable from the KovZu picker (UI only — nothing on disk). */
export function canRemoveVibeProject(projectId) {
  return Boolean(String(projectId || '').trim());
}
