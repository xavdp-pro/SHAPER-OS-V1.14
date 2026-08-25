import fs from 'node:fs';
import path from 'node:path';

const APPS_ROOT = '/apps';

/** Turbinobash-style app folder name under /apps. */
export function isValidAppId(id) {
  return /^[a-z0-9][a-z0-9-]*$/i.test(String(id || '').trim());
}

export function normalizeAppId(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Best-effort Vite dev port from vite.config.* */
export function readViteDevPort(dir) {
  const candidates = ['vite.config.js', 'vite.config.ts', 'vite.config.mjs'];
  for (const name of candidates) {
    const file = path.join(dir, name);
    try {
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, 'utf8');
      const serverBlock = text.match(/server:\s*\{[\s\S]*?port:\s*(\d+)/);
      if (serverBlock) return Number(serverBlock[1]);
      const previewBlock = text.match(/preview:\s*\{[\s\S]*?port:\s*(\d+)/);
      if (previewBlock) return Number(previewBlock[1]);
      const anyPort = text.match(/\bport:\s*(\d{4,5})\b/);
      if (anyPort) return Number(anyPort[1]);
    } catch {
      /* ignore unreadable config */
    }
  }
  return null;
}

export function labelFromAppId(id) {
  const base = String(id || '').replace(/-v\d+$/i, '');
  const words = base.split('-').filter(Boolean);
  if (!words.length) return String(id || '');
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Scan /apps — one entry per top-level directory. */
export function discoverAppsFromFilesystem() {
  if (!fs.existsSync(APPS_ROOT)) return [];
  let names;
  try {
    names = fs.readdirSync(APPS_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name);
  } catch {
    return [];
  }
  return names
    .filter((id) => isValidAppId(id))
    .map((id) => {
      const appPath = path.posix.join(APPS_ROOT, id, 'app');
      const rootPath = path.posix.join(APPS_ROOT, id);
      const hasAppDir = fs.existsSync(appPath);
      const portDir = hasAppDir ? appPath : rootPath;
      const devPort = readViteDevPort(portDir) || 0;
      return {
        id,
        label: labelFromAppId(id),
        devPort,
        appPath: hasAppDir ? appPath : rootPath,
        rootPath,
        hasAppDir,
        existsOnDisk: true,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}
