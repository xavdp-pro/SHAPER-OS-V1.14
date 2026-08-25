import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { findNode } from './bridgeClient.js';

const execFileAsync = promisify(execFile);

const SSH_BASE = [
  '-o', 'BatchMode=yes',
  '-o', 'ConnectTimeout=10',
  '-o', 'StrictHostKeyChecking=accept-new',
  '-o', 'LogLevel=ERROR',
];

/** Normalize and guard absolute paths (no traversal). */
export function sanitizeAbsPath(raw) {
  const input = String(raw || '').trim() || '/';
  if (!input.startsWith('/')) return null;
  const normalized = path.posix.normalize(input.replace(/\\/g, '/'));
  if (normalized.includes('..')) return null;
  return normalized || '/';
}

/** Suggested browse roots for a Unix user. */
export function defaultBrowseRoots(user) {
  const u = String(user || '').trim() || 'zaza';
  const roots = [
    `/home/${u}`,
    `/home/${u}/Bureau`,
    `/apps/${u}`,
    `/apps/${u}/app`,
    `/apps/${u}/ws`,
  ];
  return [...new Set(roots)];
}

function mapDirEntries(dirPath, names) {
  return names
    .filter((name) => name && name !== '.' && name !== '..')
    .map((name) => {
      const isDir = name.endsWith('/');
      const clean = name.replace(/\/$/, '');
      return {
        name: clean,
        path: path.posix.join(dirPath, clean),
        dir: isDir,
      };
    })
    .filter((e) => e.dir)
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function listLocalDir(absPath) {
  const entries = fs.readdirSync(absPath, { withFileTypes: true });
  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => ({
      name: e.name,
      path: path.posix.join(absPath, e.name),
      dir: true,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    ok: true,
    path: absPath,
    parent: absPath === '/' ? null : path.posix.dirname(absPath),
    entries: dirs,
    source: 'local',
  };
}

async function listViaBridge(node, absPath) {
  const url = `${node.url.replace(/\/$/, '')}/api/fs/list?path=${encodeURIComponent(absPath)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${node.token}` },
    signal: AbortSignal.timeout(12000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `Bridge FS ${res.status}`);
  }
  return { ...data, source: 'bridge' };
}

async function sshExec(target, remoteArgs) {
  const { stdout } = await execFileAsync('ssh', [...SSH_BASE, target, ...remoteArgs], {
    timeout: 15000,
    maxBuffer: 512 * 1024,
  });
  return String(stdout || '');
}

/**
 * SSH targets for a CLI machine name.
 * Prefer WireGuard aliases (gbs-asus → 10.87.78.x) over LAN Host asus → 192.168.x
 * which is often unreachable from gbs-h1.
 */
export function sshTargetsForMachine(machine, user) {
  const m = String(machine || '').trim();
  const u = String(user || '').trim();
  if (!m) return [];
  const hosts = [];
  if (/^(asus|acer|inspiron)$/i.test(m)) {
    hosts.push(`gbs-${m.toLowerCase()}`);
  }
  hosts.push(m);
  const targets = [];
  for (const host of hosts) {
    targets.push(host);
    if (u && !host.includes('@')) targets.push(`${u}@${host}`);
  }
  return [...new Set(targets)];
}

/**
 * List directories over SSH Host alias.
 * Tries: gbs-<machine> → Host alias → user@host → sudo -n -u user (when landed as root).
 */
async function listViaSsh(host, user, absPath) {
  const lsArgs = ['ls', '-1p', '--', absPath];
  const targets = sshTargetsForMachine(host, user);

  let lastErr = null;
  for (const target of targets) {
    try {
      const stdout = await sshExec(target, lsArgs);
      const lines = stdout.split('\n').filter(Boolean);
      return {
        ok: true,
        path: absPath,
        parent: absPath === '/' ? null : path.posix.dirname(absPath),
        entries: mapDirEntries(absPath, lines),
        source: 'ssh',
      };
    } catch (err) {
      lastErr = err;
      try {
        const stdout = await sshExec(target, ['sudo', '-n', '-u', user, ...lsArgs]);
        const lines = stdout.split('\n').filter(Boolean);
        return {
          ok: true,
          path: absPath,
          parent: absPath === '/' ? null : path.posix.dirname(absPath),
          entries: mapDirEntries(absPath, lines),
          source: 'ssh',
        };
      } catch (err2) {
        lastErr = err2;
      }
    }
  }

  const msg = String(lastErr?.stderr || lastErr?.message || 'SSH list failed')
    .replace(/\s+/g, ' ')
    .trim();
  if (/No such file|not a directory|N'est pas un|No existe/i.test(msg)) {
    throw new Error(`Directory not found: ${absPath}`);
  }
  throw new Error(msg.slice(0, 220) || 'SSH list failed');
}

function friendlyBrowseError(err) {
  const raw = String(err?.message || err || '').trim();
  if (/No route to host|Connection timed out|Connection refused/i.test(raw)) {
    return 'Machine unreachable (VPN / SSH)';
  }
  if (/route inconnue|404|not found/i.test(raw)) {
    return 'Bridge without FS explorer';
  }
  if (/Permission denied|sudo/i.test(raw)) {
    return 'Permission denied to list this directory';
  }
  if (/not found|introuvable/i.test(raw)) {
    return raw.slice(0, 180);
  }
  if (/Command failed:/i.test(raw)) {
    const tail = raw
      .replace(/^Command failed:[^\n]*/i, '')
      .replace(/Warning:[^\n]*/gi, '')
      .trim();
    return (tail || 'Cannot list this directory').slice(0, 180);
  }
  return raw.slice(0, 180) || 'Cannot list this directory';
}

/**
 * List directories on a remote machine for the workspace picker.
 * Bridged nodes → bridge API; fallback → SSH Host alias / local.
 */
export async function browseRemoteDirectory({ node: nodeName, user, path: rawPath }) {
  const machine = String(nodeName || '').trim();
  const unixUser = String(user || '').trim();
  if (!machine) return { ok: false, error: 'machine is required' };
  if (!unixUser) return { ok: false, error: 'user is required' };

  const absPath = sanitizeAbsPath(rawPath || defaultBrowseRoots(unixUser)[0]);
  if (!absPath) return { ok: false, error: 'invalid path' };

  const node = findNode(machine);
  const errors = [];

  if (node?.url) {
    try {
      return await listViaBridge(node, absPath);
    } catch (err) {
      errors.push(`bridge: ${err.message}`);
    }
  }

  if (node?.url?.includes('127.0.0.1') && fs.existsSync(absPath)) {
    try {
      return await listLocalDir(absPath);
    } catch (err) {
      return { ok: false, error: friendlyBrowseError(err) };
    }
  }

  try {
    return await listViaSsh(machine, unixUser, absPath);
  } catch (err) {
    errors.push(`ssh: ${err.message}`);
    return { ok: false, error: friendlyBrowseError(err), detail: errors };
  }
}

export function machineIsBridged(nodeName) {
  return Boolean(findNode(nodeName)?.url);
}
