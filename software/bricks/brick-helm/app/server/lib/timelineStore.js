import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { query } from './db.js';

/**
 * Timeline persistence — MariaDB backend (mysql2), table `timelines`.
 * Legacy JSON files (data/timelines/*.json) are imported lazily on first read
 * so existing conversations survive the migration.
 *
 * updated_at stays an ISO string (JS-generated) to preserve the exact
 * optimistic-lock string comparison the UI relies on.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEGACY_DIR = process.env.HELM_TIMELINE_DIR
  || (fs.existsSync('/apps/helm-v2/data')
    ? '/apps/helm-v2/data/timelines'
    : path.join(__dirname, '../../data/timelines'));

function convHash(conversationPath) {
  const key = String(conversationPath || '').trim();
  if (!key) throw new Error('conversation path requis');
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 24);
}

let schemaReady = null;
export function ensureTimelineSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS timelines (
          conv_hash CHAR(24) NOT NULL,
          conv_path VARCHAR(512) NOT NULL,
          items LONGTEXT NOT NULL,
          updated_at VARCHAR(32) NOT NULL,
          folder VARCHAR(128) DEFAULT 'Général',
          archived_at VARCHAR(32) DEFAULT NULL,
          pinned TINYINT(1) DEFAULT 0,
          model VARCHAR(128) DEFAULT NULL,
          PRIMARY KEY (conv_hash),
          KEY idx_path (conv_path(191))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      try { await query("ALTER TABLE timelines ADD COLUMN folder VARCHAR(128) DEFAULT 'Général'"); } catch {}
      try { await query("ALTER TABLE timelines ADD COLUMN archived_at VARCHAR(32) DEFAULT NULL"); } catch {}
      try { await query("ALTER TABLE timelines ADD COLUMN pinned TINYINT(1) DEFAULT 0"); } catch {}
      try { await query("ALTER TABLE timelines ADD COLUMN model VARCHAR(128) DEFAULT NULL"); } catch {}
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

const convMetaMem = new Map();

export async function getConversationsMetadata() {
  const map = {};
  try {
    await ensureTimelineSchema();
    const rows = await query('SELECT conv_path, folder, archived_at, pinned, model FROM timelines');
    for (const r of rows) {
      map[r.conv_path] = {
        folder: r.folder || 'Général',
        archived_at: r.archived_at || null,
        pinned: Boolean(r.pinned),
        model: r.model || null,
      };
    }
  } catch {
    for (const [k, v] of convMetaMem.entries()) {
      map[k] = v;
    }
  }
  return map;
}

export async function getConversationModel(conversationPath) {
  if (!conversationPath) return null;
  const mem = convMetaMem.get(conversationPath);
  if (mem && mem.model !== undefined) return mem.model;
  try {
    await ensureTimelineSchema();
    const hash = convHash(conversationPath);
    const rows = await query('SELECT model FROM timelines WHERE conv_hash = ?', [hash]);
    if (rows.length && rows[0].model) return rows[0].model;
  } catch {}
  return null;
}

export async function setConversationModel(conversationPath, model) {
  const hash = convHash(conversationPath);
  const targetModel = String(model || '').trim() || null;
  convMetaMem.set(conversationPath, { ...(convMetaMem.get(conversationPath) || {}), model: targetModel });
  try {
    await ensureTimelineSchema();
    await query(
      `INSERT INTO timelines (conv_hash, conv_path, items, updated_at, model) VALUES (?, ?, '[]', ?, ?)
       ON DUPLICATE KEY UPDATE model = VALUES(model)`,
      [hash, conversationPath, new Date().toISOString(), targetModel]
    );
  } catch {}
  return { ok: true, path: conversationPath, model: targetModel };
}

export async function setConversationFolder(conversationPath, folder) {
  const hash = convHash(conversationPath);
  const targetFolder = String(folder || 'Général').trim() || 'Général';
  convMetaMem.set(conversationPath, { ...(convMetaMem.get(conversationPath) || {}), folder: targetFolder });
  try {
    await ensureTimelineSchema();
    await query(
      `INSERT INTO timelines (conv_hash, conv_path, items, updated_at, folder) VALUES (?, ?, '[]', ?, ?)
       ON DUPLICATE KEY UPDATE folder = VALUES(folder)`,
      [hash, conversationPath, new Date().toISOString(), targetFolder]
    );
  } catch {}
  return { ok: true, path: conversationPath, folder: targetFolder };
}

export async function archiveConversation(conversationPath, isArchived = true) {
  const hash = convHash(conversationPath);
  const archivedAt = isArchived ? new Date().toISOString() : null;
  convMetaMem.set(conversationPath, { ...(convMetaMem.get(conversationPath) || {}), archived_at: archivedAt });
  try {
    await ensureTimelineSchema();
    await query(
      `INSERT INTO timelines (conv_hash, conv_path, items, updated_at, archived_at) VALUES (?, ?, '[]', ?, ?)
       ON DUPLICATE KEY UPDATE archived_at = VALUES(archived_at)`,
      [hash, conversationPath, new Date().toISOString(), archivedAt]
    );
  } catch {}
  return { ok: true, path: conversationPath, archived: isArchived, archived_at: archivedAt };
}

export async function pinConversation(conversationPath, isPinned = true) {
  const hash = convHash(conversationPath);
  const pinnedVal = isPinned ? 1 : 0;
  convMetaMem.set(conversationPath, { ...(convMetaMem.get(conversationPath) || {}), pinned: isPinned });
  try {
    await ensureTimelineSchema();
    await query(
      `INSERT INTO timelines (conv_hash, conv_path, items, updated_at, pinned) VALUES (?, ?, '[]', ?, ?)
       ON DUPLICATE KEY UPDATE pinned = VALUES(pinned)`,
      [hash, conversationPath, new Date().toISOString(), pinnedVal]
    );
  } catch {}
  return { ok: true, path: conversationPath, pinned: isPinned };
}

function parseItems(raw) {
  if (Array.isArray(raw)) return raw;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** One-shot import of a legacy JSON file into the DB (if it exists). */
async function importLegacy(conversationPath, hash) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(LEGACY_DIR, `${hash}.json`), 'utf8'));
  } catch {
    return null;
  }
  const items = Array.isArray(raw.items) ? raw.items : [];
  const updatedAt = raw.updated_at || new Date().toISOString();
  await query(
    `INSERT INTO timelines (conv_hash, conv_path, items, updated_at) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE conv_path = VALUES(conv_path)`,
    [hash, conversationPath, JSON.stringify(items), updatedAt],
  );
  return { path: conversationPath, items, updated_at: updatedAt };
}

const memStore = new Map();

export async function loadTimeline(conversationPath) {
  try {
    await ensureTimelineSchema();
    const hash = convHash(conversationPath);
    const rows = await query(
      'SELECT conv_path, items, updated_at FROM timelines WHERE conv_hash = ?',
      [hash],
    );
    if (rows.length) {
      return {
        path: rows[0].conv_path || conversationPath,
        items: parseItems(rows[0].items),
        updated_at: rows[0].updated_at || null,
      };
    }
  } catch {
    // DB offline, use memory/file fallback
  }

  const hash = convHash(conversationPath);
  if (memStore.has(hash)) {
    return memStore.get(hash);
  }
  const imported = await importLegacy(conversationPath, hash);
  if (imported) return imported;
  return { path: conversationPath, items: [], updated_at: null };
}

export async function saveTimeline(conversationPath, items, { ifUpdatedAt, force = false } = {}) {
  const current = await loadTimeline(conversationPath);
  const nextItems = Array.isArray(items) ? items : [];

  if (!force) {
    // Optimistic lock when client sends ifUpdatedAt.
    if (ifUpdatedAt != null && current.updated_at && ifUpdatedAt !== current.updated_at) {
      return { conflict: true, path: current.path, items: current.items, updated_at: current.updated_at };
    }
    if (ifUpdatedAt == null && current.updated_at && current.items.length > 0) {
      return { conflict: true, path: current.path, items: current.items, updated_at: current.updated_at };
    }
  }

  const hash = convHash(conversationPath);
  const updatedAt = new Date().toISOString();
  const record = { path: conversationPath, items: nextItems, updated_at: updatedAt };
  memStore.set(hash, record);

  try {
    await ensureTimelineSchema();
    await query(
      `INSERT INTO timelines (conv_hash, conv_path, items, updated_at) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE conv_path = VALUES(conv_path), items = VALUES(items), updated_at = VALUES(updated_at)`,
      [hash, conversationPath, JSON.stringify(nextItems), updatedAt],
    );
  } catch {
    // DB offline, saved in memory
  }

  try {
    fs.mkdirSync(LEGACY_DIR, { recursive: true });
    fs.writeFileSync(path.join(LEGACY_DIR, `${hash}.json`), JSON.stringify(record, null, 2));
  } catch { /* best effort */ }

  return record;
}

/** Clear timeline but keep a fresh updated_at so stale tabs cannot overwrite. */
export async function deleteTimeline(conversationPath) {
  return saveTimeline(conversationPath, [], { force: true });
}

/** Remove timeline row entirely (conversation deleted from list). */
export async function purgeTimeline(conversationPath) {
  const hash = convHash(conversationPath);
  memStore.delete(hash);
  try {
    await ensureTimelineSchema();
    await query('DELETE FROM timelines WHERE conv_hash = ?', [hash]);
  } catch { /* DB offline */ }
  try {
    fs.unlinkSync(path.join(LEGACY_DIR, `${hash}.json`));
  } catch { /* legacy file may not exist */ }
  return { ok: true, path: conversationPath };
}

/** Copy source timeline to target (replace or append). */
export async function copyTimeline(sourcePath, targetPath, { mode = 'replace' } = {}) {
  const src = await loadTimeline(sourcePath);
  if (!src.items.length && mode !== 'append') {
    return saveTimeline(targetPath, [], { force: true });
  }
  if (mode === 'append') {
    const dst = await loadTimeline(targetPath);
    return saveTimeline(targetPath, [...dst.items, ...src.items], { force: true });
  }
  return saveTimeline(targetPath, [...src.items], { force: true });
}

/** Rename source timeline to target by moving messages. */
export async function renameTimeline(sourcePath, targetPath) {
  const src = await loadTimeline(sourcePath);
  await saveTimeline(targetPath, src.items, { force: true });
  await purgeTimeline(sourcePath);
  return { ok: true, source: sourcePath, target: targetPath, itemsCount: src.items.length };
}
