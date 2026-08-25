import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ATTACHMENTS_FILE = 'attachments.json';
const KOVZU_DIR = '_kovzu';
const CONTEXT_FILE = 'CONTEXT.md';
const CONTEXT_SECTION = '## Attachments registry';

function kovzuDir(workspaceCwd) {
  return path.join(String(workspaceCwd || '').trim(), KOVZU_DIR);
}

function contextFilePath(workspaceCwd) {
  return path.join(kovzuDir(workspaceCwd), CONTEXT_FILE);
}

/** @typedef {'uploading' | 'ready' | 'error'} AttachmentStatus */

export function attachmentsManifestPath(workspaceCwd) {
  return path.join(kovzuDir(String(workspaceCwd || '').trim()), ATTACHMENTS_FILE);
}

export function readAttachmentsManifest(workspaceCwd) {
  const cwd = String(workspaceCwd || '').trim();
  if (!cwd) return { items: [], updatedAt: null };
  try {
    const p = attachmentsManifestPath(cwd);
    if (!fs.existsSync(p)) return { items: [], updatedAt: null };
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return {
      items: Array.isArray(raw.items) ? raw.items : [],
      updatedAt: raw.updatedAt || null,
    };
  } catch {
    return { items: [], updatedAt: null };
  }
}

export function writeAttachmentsManifest(workspaceCwd, manifest) {
  const cwd = String(workspaceCwd || '').trim();
  if (!cwd) return { items: [], updatedAt: null };
  const dir = kovzuDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  const data = {
    items: Array.isArray(manifest.items) ? manifest.items : [],
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(attachmentsManifestPath(cwd), `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  return data;
}

/**
 * @param {string} workspaceCwd
 * @param {object} entry
 */
export function upsertAttachment(workspaceCwd, entry) {
  const manifest = readAttachmentsManifest(workspaceCwd);
  const items = [...(manifest.items || [])];
  const id = String(entry.id || '').trim();
  const name = String(entry.name || '').trim();
  let idx = id ? items.findIndex((x) => x.id === id) : -1;
  if (idx < 0 && name) {
    idx = items.findIndex((x) => x.name === name && x.status === 'uploading');
  }
  const next = {
    id: id || crypto.randomUUID(),
    name,
    rel: entry.rel || '',
    abs: entry.abs || '',
    status: entry.status || 'uploading',
    kind: entry.kind || 'doc',
    error: entry.error || '',
    uploadedAt: entry.uploadedAt || new Date().toISOString(),
  };
  if (idx >= 0) items[idx] = { ...items[idx], ...next };
  else items.push(next);
  const saved = writeAttachmentsManifest(workspaceCwd, { items });
  syncAttachmentsContextSection(workspaceCwd);
  return saved;
}

export function resolveAttachmentAbs(workspaceCwd, relPath) {
  const rel = String(relPath || '').trim().replace(/\\/g, '/');
  const cwd = String(workspaceCwd || '').trim().replace(/\\/g, '/').replace(/\/$/, '');
  if (!rel || !cwd) return '';
  if (path.isAbsolute(rel)) return rel;
  return path.join(cwd, rel);
}

export function findReadyAttachment(workspaceCwd, relPath) {
  const rel = String(relPath || '').trim().replace(/\\/g, '/');
  const hit = (readAttachmentsManifest(workspaceCwd).items || []).find((x) => x.rel === rel);
  if (hit?.abs) return hit;
  if (!rel) return null;
  const abs = resolveAttachmentAbs(workspaceCwd, rel);
  return abs ? { rel, abs, status: 'ready', name: path.basename(rel) } : null;
}

export function buildAttachmentsContextBlock(workspaceCwd) {
  const items = readAttachmentsManifest(workspaceCwd).items || [];
  if (!items.length) {
    return 'Aucune pièce jointe enregistrée pour cette session.';
  }
  const lines = [
    'Registre live : `_kovzu/attachments.json`. N\'analyse que les entrées `status: "ready"`.',
    '',
  ];
  for (const item of items) {
    const flag = item.status === 'ready'
      ? 'ready'
      : item.status === 'uploading'
        ? 'uploading — fichier pas encore disponible'
        : item.status === 'error'
          ? 'error'
          : String(item.status || 'unknown');
    const pathHint = item.abs ? ` → \`${item.abs}\`` : '';
    lines.push(`- **${item.name || item.rel}** [\`${flag}\`]${pathHint}`);
  }
  return lines.join('\n');
}

export function syncAttachmentsContextSection(workspaceCwd) {
  const cwd = String(workspaceCwd || '').trim();
  if (!cwd) return;
  const ctxPath = contextFilePath(cwd);
  if (!fs.existsSync(ctxPath)) return;

  const block = buildAttachmentsContextBlock(cwd);
  const section = `${CONTEXT_SECTION}\n${block}\n`;
  let body = fs.readFileSync(ctxPath, 'utf8');

  if (body.includes(CONTEXT_SECTION)) {
    const start = body.indexOf(CONTEXT_SECTION);
    const rest = body.slice(start + CONTEXT_SECTION.length);
    const nextHeading = rest.search(/\n## /);
    const tail = nextHeading >= 0 ? rest.slice(nextHeading + 1) : '';
    body = `${body.slice(0, start)}${section}${tail}`;
  } else {
    const skillsIdx = body.indexOf('\n## Skills catalog');
    if (skillsIdx >= 0) {
      body = `${body.slice(0, skillsIdx)}\n${section}${body.slice(skillsIdx)}`;
    } else {
      body = `${body.trimEnd()}\n\n${section}`;
    }
  }
  fs.writeFileSync(ctxPath, body.endsWith('\n') ? body : `${body}\n`, 'utf8');
}

/**
 * Append absolute attachment paths to an inject message (agent must not guess paths).
 * @param {string} message
 * @param {string} workspaceCwd
 * @param {string[]} relPaths
 */
export function appendAttachmentPaths(message, workspaceCwd, relPaths = []) {
  const rels = relPaths.map((r) => String(r || '').trim()).filter(Boolean);
  if (!rels.length) return String(message || '').trim();

  const lines = rels.map((rel) => {
    const hit = findReadyAttachment(workspaceCwd, rel);
    if (hit?.status === 'ready' && hit.abs) {
      return `- ${hit.name || path.basename(rel)} : \`${hit.abs}\``;
    }
    return `- ${rel} : (chemin en attente — consulter _kovzu/attachments.json)`;
  });

  const base = String(message || '').trim();
  const block = `Pièces jointes à analyser (chemins absolus du workspace) :\n${lines.join('\n')}`;
  return base ? `${base}\n\n${block}` : block;
}
