/**
 * Vibe-code projects — apps previewable/editable in the KovZu right panel.
 *
 * Convention turbinobash : un projet = une app `/apps/<id>/app`, un port de dev
 * Vite local. Deux façons de créer un projet :
 *   1. Vibe-coder directement dans le workspace de la conversation en cours.
 *   2. `tb app sudo/way/noweb/create <id>` → espace app isolé (user/DB//apps/<id>/),
 *      puis dev sur un port local ; mise en prod via
 *      `tb app sudo/way/proxy/create <id> http://127.0.0.1:<port> --certbot`
 *      (ou ingress Cloudflare tunnel) pour un sous-domaine public.
 *
 * Registre : scan `/apps` + override env VIBE_PROJECTS =
 *   "id|Label|port,id2|Label2|port2"  (chemin déduit : /apps/<id>/app)
 */

import { discoverAppsFromFilesystem, isValidAppId, labelFromAppId } from './vibeApps.js';

const DEFAULTS = [
  { id: 'crmdemo-v1', label: 'CRM Demo', devPort: 7597 },
  { id: 'crmxavdp-v1', label: 'CRM Xavdp', devPort: 7607 },
];

function parseEnv() {
  const raw = String(process.env.VIBE_PROJECTS || '').trim();
  if (!raw) return null;
  const out = [];
  for (const part of raw.split(',')) {
    const [id, label, port] = part.split('|').map((s) => s.trim());
    if (!id || !port) continue;
    out.push({ id, label: label || id, devPort: Number(port) });
  }
  return out.length ? out : null;
}

function decorate(p) {
  const id = p.id;
  const appPath = p.appPath || `/apps/${id}/app`;
  return {
    id,
    label: p.label || id,
    devPort: Number(p.devPort) || 0,
    appPath,
    rootPath: p.rootPath || `/apps/${id}`,
    hasAppDir: p.hasAppDir !== false,
    existsOnDisk: p.existsOnDisk !== false,
    devHost: '127.0.0.1',
    previewPath: `/api/preview/${id}/`,
  };
}

function buildProjectList() {
  const discovered = discoverAppsFromFilesystem();
  const byId = new Map(discovered.map((p) => [p.id, decorate(p)]));
  const explicit = parseEnv() || DEFAULTS;
  for (const row of explicit) {
    const cur = byId.get(row.id);
    byId.set(row.id, decorate({
      id: row.id,
      label: row.label || cur?.label || row.id,
      devPort: row.devPort || cur?.devPort || 0,
      appPath: cur?.appPath,
      rootPath: cur?.rootPath,
      hasAppDir: cur?.hasAppDir ?? true,
      existsOnDisk: Boolean(cur),
    }));
  }
  return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function listVibeProjects() {
  return buildProjectList();
}

export function getVibeProject(id) {
  const want = String(id || '').trim();
  const found = listVibeProjects().find((p) => p.id === want);
  if (found) return found;
  if (isValidAppId(want)) {
    return decorate({
      id: want,
      label: labelFromAppId(want),
      devPort: 0,
      hasAppDir: false,
      existsOnDisk: false,
    });
  }
  return null;
}

export function invalidateVibeProjects() {
  /* no-op — list is rebuilt from /apps on each call */
}
