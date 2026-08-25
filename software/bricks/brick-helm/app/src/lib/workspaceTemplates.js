/** Client-side workspace path builders (mirror server sessionCatalog). */

export const WORKSPACE_LAYOUTS = [
  {
    id: 'home_bureau',
    labelKey: 'stepper.layout.home',
    hintKey: 'stepper.layout.homeHint',
    needsProject: true,
  },
  {
    id: 'turbobash_app',
    labelKey: 'stepper.layout.turbobashApp',
    hintKey: 'stepper.layout.turbobashAppHint',
    needsProject: false,
  },
  {
    id: 'turbobash_ws',
    labelKey: 'stepper.layout.turbobashWs',
    hintKey: 'stepper.layout.turbobashWsHint',
    needsProject: true,
  },
  {
    id: 'custom',
    labelKey: 'stepper.layout.custom',
    hintKey: 'stepper.layout.customHint',
    needsProject: false,
    customPath: true,
  },
];

export function buildWorkspacePath(layoutId, user, { project = '', customPath = '' } = {}) {
  const u = String(user || '').trim();
  const proj = String(project || '').trim();
  const custom = String(customPath || '').trim();
  switch (layoutId) {
    case 'home_bureau':
      return u && proj ? `/home/${u}/Bureau/${proj}` : '';
    case 'turbobash_app':
      return u ? `/apps/${u}/app` : '';
    case 'turbobash_ws':
      return u && proj ? `/apps/${u}/ws/${proj}` : '';
    case 'custom':
      return custom;
    default:
      return custom;
  }
}

export function sessionNameFromPath(workspacePath) {
  const raw = String(workspacePath || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  const parts = raw.split('/').filter(Boolean);
  const base = parts[parts.length - 1] || '';
  if (base === 'app' && parts.includes('apps')) {
    const idx = parts.indexOf('apps');
    if (parts[idx + 1]) return parts[idx + 1];
  }
  return base.replace(/[^a-zA-Z0-9._-]/g, '_') || '';
}
