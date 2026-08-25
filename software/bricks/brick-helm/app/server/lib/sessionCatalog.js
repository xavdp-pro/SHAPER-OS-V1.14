import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config, resolveSessionWorkspace } from '../config.js';
import { cliNodes } from './bridgeClient.js';

/** Workspace layout presets (home vs turbobash-style /apps). */
export const WORKSPACE_LAYOUTS = [
  {
    id: 'home_bureau',
    label: 'Bureau Linux',
    hint: '/home/{user}/Bureau/{projet}',
    needsProject: true,
  },
  {
    id: 'turbobash_app',
    label: 'Turbinobash app',
    hint: '/apps/{user}/app',
    needsProject: false,
  },
  {
    id: 'turbobash_ws',
    label: 'Turbinobash workspace',
    hint: '/apps/{user}/ws/{projet}',
    needsProject: true,
  },
  {
    id: 'custom',
    label: 'Chemin absolu',
    hint: 'Saisie libre',
    needsProject: false,
    customPath: true,
  },
];

/**
 * Parse SSH config Host aliases (names only — not full config sent to client).
 * Skips Host *, Match, and tokens with wildcards.
 */
export function parseSshHostNames(configPath) {
  const file = String(configPath || '').trim();
  if (!file || !fs.existsSync(file)) return [];
  let raw = '';
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const names = new Set();
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.toLowerCase().startsWith('host ')) continue;
    const rest = trimmed.slice(4).trim();
    if (!rest || rest === '*' || rest.toLowerCase().startsWith('match')) continue;
    for (const token of rest.split(/\s+/)) {
      const host = token.trim();
      if (!host || host === '*' || /[*?]/.test(host)) continue;
      names.add(host);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function sshConfigPath() {
  return process.env.CLI_SSH_CONFIG
    || path.join(os.homedir(), '.ssh', 'config');
}

function extraHostsFromEnv() {
  const raw = String(process.env.CLI_SSH_HOSTS || '').trim();
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Build workspace path from layout + user + project/custom. */
export function resolveWorkspacePath(layoutId, user, { project = '', customPath = '' } = {}) {
  const u = String(user || '').trim();
  const proj = String(project || '').trim();
  const custom = String(customPath || '').trim();
  switch (layoutId) {
    case 'home_bureau':
      if (!u || !proj) return '';
      return `/home/${u}/Bureau/${proj}`;
    case 'turbobash_app':
      if (!u) return '';
      return `/apps/${u}/app`;
    case 'turbobash_ws':
      if (!u || !proj) return '';
      return `/apps/${u}/ws/${proj}`;
    case 'custom':
      return custom;
    default:
      return custom || (proj ? `/home/${u}/Bureau/${proj}` : '');
  }
}

/**
 * Machine list for the stepper: CLI nodes (bridged) + SSH Host aliases + env extras.
 * Deduped by name; bridged flag when a cursor-agent-bridge is configured.
 */
export function buildSessionCatalog() {
  const nodes = cliNodes();
  const byName = new Map();

  for (const n of nodes) {
    if (!n?.name) continue;
    byName.set(n.name, {
      name: n.name,
      user: n.user || config.cli.defaultUser || 'zaza',
      bridged: true,
      source: 'cli',
    });
  }

  const sshHosts = [
    ...parseSshHostNames(sshConfigPath()),
    ...extraHostsFromEnv(),
  ];
  for (const name of sshHosts) {
    if (byName.has(name)) {
      const prev = byName.get(name);
      byName.set(name, { ...prev, sshAlias: true });
      continue;
    }
    byName.set(name, {
      name,
      user: config.cli.defaultUser || 'zaza',
      bridged: false,
      source: 'ssh',
    });
  }

  const machines = [...byName.values()].sort((a, b) => {
    if (a.bridged !== b.bridged) return a.bridged ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const knownWorkspaces = [];
  const map = config.cli.sessionWorkspaces || {};
  for (const [key, ws] of Object.entries(map)) {
    if (!ws) continue;
    const slash = key.indexOf('/');
    if (slash > 0) {
      knownWorkspaces.push({
        node: key.slice(0, slash),
        session: key.slice(slash + 1),
        workspace: ws,
      });
    } else {
      knownWorkspaces.push({ node: '', session: key, workspace: ws });
    }
  }

  return {
    machines,
    layouts: WORKSPACE_LAYOUTS,
    knownWorkspaces,
    sshConfig: sshConfigPath(),
    sshHostCount: sshHosts.length,
  };
}

export function sessionNameFromWorkspace(workspacePath) {
  const raw = String(workspacePath || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  const base = raw.split('/').filter(Boolean).pop() || '';
  if (base === 'app') {
    const parts = raw.split('/').filter(Boolean);
    const appsIdx = parts.indexOf('apps');
    if (appsIdx >= 0 && parts[appsIdx + 1]) return parts[appsIdx + 1];
  }
  return base.replace(/[^a-zA-Z0-9._-]/g, '_') || '';
}

export function lookupKnownWorkspace(node, session) {
  return resolveSessionWorkspace(session, node) || '';
}
