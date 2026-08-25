import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { listConversations, parseConversationId } from './bridgeClient.js';
import { resolveSessionWorkspace } from '../config.js';
import { sanitizeAbsPath, sshTargetsForMachine } from './remoteFs.js';

const execFileAsync = promisify(execFile);

const SSH_BASE = [
  '-o', 'BatchMode=yes',
  '-o', 'ConnectTimeout=10',
  '-o', 'StrictHostKeyChecking=accept-new',
  '-o', 'LogLevel=ERROR',
];

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
  '.tar.gz': 'application/gzip',
  '.tgz': 'application/gzip',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.parquet': 'application/octet-stream',
};

export function mimeForPath(filePath) {
  const ext = path.posix.extname(String(filePath || '').toLowerCase());
  return MIME[ext] || 'application/octet-stream';
}

export function isAllowedWorkspacePath(absPath) {
  const p = String(absPath || '');
  if (!p.startsWith('/') || p.includes('..')) return false;
  return /^\/(apps|home|tmp|var\/www)/.test(p);
}

export function resolveWorkspaceAbsPath(rawPath, cwd) {
  const raw = String(rawPath || '').trim();
  if (!raw) return null;
  if (/^(https?:\/\/|data:|blob:)/i.test(raw)) return null;
  let abs = sanitizeAbsPath(raw);
  if (!abs && cwd) {
    const base = sanitizeAbsPath(cwd);
    if (!base) return null;
    abs = sanitizeAbsPath(path.posix.join(base, raw.replace(/^\.\//, '')));
  }
  if (!abs || !isAllowedWorkspacePath(abs)) return null;
  return abs;
}

async function readLocalFile(absPath) {
  if (!fs.existsSync(absPath)) return null;
  const stat = fs.statSync(absPath);
  if (!stat.isFile()) return null;
  if (stat.size > 15 * 1024 * 1024) {
    const err = new Error('File too large (max 15 MB)');
    err.status = 413;
    throw err;
  }
  return fs.readFileSync(absPath);
}

async function sshExec(target, remoteArgs) {
  const { stdout } = await execFileAsync('ssh', [...SSH_BASE, target, ...remoteArgs], {
    timeout: 20000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

async function readViaSsh(machine, user, absPath) {
  const targets = sshTargetsForMachine(machine, user);
  const remote = ['base64', '-w', '0', absPath];
  let lastErr = null;
  for (const target of targets) {
    try {
      const b64 = await sshExec(target, remote);
      return Buffer.from(String(b64).trim(), 'base64');
    } catch (err) {
      lastErr = err;
      try {
        const b64 = await sshExec(target, ['sudo', '-n', '-u', user, ...remote]);
        return Buffer.from(String(b64).trim(), 'base64');
      } catch (err2) {
        lastErr = err2;
      }
    }
  }
  const err = new Error(lastErr?.message || 'SSH read failed');
  err.status = 404;
  throw err;
}

export async function getConversationCwd(conversationId) {
  const id = String(conversationId || '').trim();
  if (!id) return '';
  try {
    const data = await listConversations();
    const hit = (data.conversations || []).find((c) => (c.path || c.id) === id);
    if (hit?.cwd) return String(hit.cwd).trim();
  } catch {
    /* bridge may be down — fall through */
  }
  const parsed = parseConversationId(id);
  if (parsed.conversation) {
    return resolveSessionWorkspace(parsed.conversation, parsed.node || '');
  }
  return '';
}

/** Deliverable subdirectories (briefing convention: assets/docs/data). */
export const DELIVERABLE_DIRS = ['docs', 'assets', 'data'];

const DELIVERABLE_EXT = new Set([
  '.pdf', '.docx', '.odt', '.pptx', '.xlsx', '.csv', '.md', '.txt', '.json',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
]);

/** Internal directories to never list as deliverables. */
const SKIP_DIRS = new Set(['node_modules', 'timelines', '.git', '.cache', 'tmp']);

function parseFindLines(raw, cwd) {
  const out = [];
  for (const line of String(raw || '').split('\n')) {
    const s = line.trim();
    if (!s) continue;
    // format: "<size>\t<mtime_epoch>\t<abspath>"
    const parts = s.split('\t');
    if (parts.length < 3) continue;
    const size = Number(parts[0]) || 0;
    const mtime = Math.floor(Number(parts[1]) || 0);
    const absPath = parts.slice(2).join('\t');
    const ext = path.posix.extname(absPath).toLowerCase();
    if (!DELIVERABLE_EXT.has(ext)) continue;
    const rel = cwd && absPath.startsWith(cwd) ? absPath.slice(cwd.length).replace(/^\/+/, '') : absPath;
    out.push({
      name: path.posix.basename(absPath),
      path: absPath,
      rel,
      folder: rel.split('/')[0] || '',
      ext,
      mime: mimeForPath(absPath),
      size,
      mtime,
    });
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

function listLocalDeliverables(cwd) {
  const out = [];
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < 3 && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name)) walk(abs, depth + 1);
        continue;
      }
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (!DELIVERABLE_EXT.has(ext)) continue;
      let stat;
      try { stat = fs.statSync(abs); } catch { continue; }
      const rel = abs.slice(cwd.length).replace(/^\/+/, '');
      out.push({
        name: e.name,
        path: abs,
        rel,
        folder: rel.split('/')[0] || '',
        ext,
        mime: mimeForPath(abs),
        size: stat.size,
        mtime: Math.floor(stat.mtimeMs),
      });
    }
  };
  for (const sub of DELIVERABLE_DIRS) walk(path.join(cwd, sub), 0);
  return out.sort((a, b) => b.mtime - a.mtime);
}

async function listSshDeliverables(machine, user, cwd) {
  const targets = sshTargetsForMachine(machine, user);
  const dirs = DELIVERABLE_DIRS.map((d) => `${cwd}/${d}`).join(' ');
  const prune = [...SKIP_DIRS].flatMap((d) => ['-not', '-path', `*/${d}/*`]);
  const remote = [
    'find', dirs, '-maxdepth', '4', '-type', 'f',
    ...prune,
    '-printf', '%s\\t%T@\\t%p\\n',
  ];
  for (const target of targets) {
    try {
      const stdout = await sshExec(target, remote);
      return parseFindLines(stdout, cwd);
    } catch {
      /* find exits non-zero if a dir is missing — try next target */
    }
  }
  return [];
}

/**
 * List deliverable files (docs/, assets/, data/) for a conversation.
 * Local first, SSH fallback for remote machines.
 */
export async function listDeliverables(conversationId) {
  const cwd = await getConversationCwd(conversationId);
  if (!cwd) return { cwd: '', files: [] };
  const base = sanitizeAbsPath(cwd);
  if (!base || !isAllowedWorkspacePath(base)) return { cwd, files: [] };

  if (fs.existsSync(base)) {
    return { cwd: base, files: listLocalDeliverables(base) };
  }
  const parsed = parseConversationId(conversationId);
  const machine = parsed.node || '';
  const user = parsed.user || 'zaza';
  if (machine) {
    return { cwd: base, files: await listSshDeliverables(machine, user, base) };
  }
  return { cwd: base, files: [] };
}

export async function readWorkspaceFile(conversationId, rawPath) {
  const cwd = await getConversationCwd(conversationId);
  const absPath = resolveWorkspaceAbsPath(rawPath, cwd);
  if (!absPath) {
    const err = new Error('Invalid file path');
    err.status = 400;
    throw err;
  }

  let buffer = await readLocalFile(absPath);
  if (!buffer) {
    const parsed = parseConversationId(conversationId);
    const machine = parsed.node || '';
    const user = parsed.user || 'zaza';
    if (machine) {
      buffer = await readViaSsh(machine, user, absPath);
    }
  }

  if (!buffer) {
    const err = new Error('File not found');
    err.status = 404;
    throw err;
  }

  return {
    buffer,
    path: absPath,
    mime: mimeForPath(absPath),
  };
}
