/**
 * Document catalog: original filename + folder linked to a content hash.
 * This is the GED "database". The blob store never sees the original name.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { blobPath, casDir, commitTempFile, putBuffer, removeBlobIfOrphan } from './cas.js';

const SKIP = new Set(['.cas', '.catalog.json', '.meta.json']);

export function catalogFile(root) {
  return path.join(root, '.catalog.json');
}

export function loadCatalog(root) {
  const p = catalogFile(root);
  try {
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (raw && Array.isArray(raw.documents)) return raw;
    }
  } catch { /* empty catalog */ }
  return { algo: 'sha256', documents: [] };
}

export function saveCatalog(root, catalog) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(catalogFile(root), `${JSON.stringify(catalog, null, 2)}\n`);
}

export function logicalRel(folder, originalName) {
  const name = String(originalName || '').trim();
  const dir = String(folder || '').replace(/^\/+|\/+$/g, '');
  if (!name) throw new Error('Original filename required');
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) {
    throw new Error('Original filename cannot contain a path separator');
  }
  return dir ? `${dir}/${name}` : name;
}

function uniqueOriginalName(catalog, folder, originalName) {
  const wanted = logicalRel(folder, originalName);
  if (!catalog.documents.some((d) => d.relPath === wanted)) return originalName;
  const ext = path.extname(originalName);
  const base = path.basename(originalName, ext);
  let n = 2;
  let candidate;
  do {
    candidate = `${base} (${n})${ext}`;
    n += 1;
  } while (catalog.documents.some((d) => d.relPath === logicalRel(folder, candidate)));
  return candidate;
}

export function findByRel(root, relPath) {
  const rel = String(relPath || '').replace(/^\/+/, '');
  return loadCatalog(root).documents.find((d) => d.relPath === rel) || null;
}

export function findById(root, id) {
  return loadCatalog(root).documents.find((d) => d.id === id) || null;
}

export function findByHash(root, hash) {
  const h = String(hash || '').toLowerCase();
  return loadCatalog(root).documents.filter((d) => d.hash === h);
}

export function resolveBlob(root, relOrHash) {
  const key = String(relOrHash || '').replace(/^\/+/, '');
  if (/^[0-9a-f]{64}$/i.test(key)) {
    const docs = findByHash(root, key.toLowerCase());
    const abs = blobPath(root, key.toLowerCase());
    if (!fs.existsSync(abs)) return null;
    const doc = docs[0] || {
      id: key.toLowerCase(),
      hash: key.toLowerCase(),
      originalName: key.toLowerCase(),
      relPath: key.toLowerCase(),
      folder: '',
      ext: '',
    };
    return { abs, doc };
  }
  const doc = findByRel(root, key);
  if (!doc) return null;
  const abs = blobPath(root, doc.hash);
  if (!fs.existsSync(abs)) return null;
  return { abs, doc };
}

function insertDoc(root, fields) {
  const catalog = loadCatalog(root);
  const same = catalog.documents.find(
    (d) => d.hash === fields.hash && d.relPath === logicalRel(fields.folder, fields.originalName),
  );
  if (same) return { doc: same, catalog, created: false };

  const originalName = uniqueOriginalName(catalog, fields.folder, fields.originalName);
  const doc = {
    id: crypto.randomUUID(),
    hash: fields.hash,
    originalName,
    folder: String(fields.folder || ''),
    relPath: logicalRel(fields.folder, originalName),
    ext: path.extname(originalName).toLowerCase(),
    size: fields.size,
    createdAt: Date.now(),
    ...(fields.extra || {}),
  };
  catalog.documents.push(doc);
  saveCatalog(root, catalog);
  return { doc, catalog, created: true };
}

export function storeBuffer(root, { originalName, folder = '', buffer, extra = {} }) {
  const { hash, path: abs, size, deduplicated } = putBuffer(root, buffer);
  const { doc, created } = insertDoc(root, { hash, originalName, folder, size, extra });
  return { doc, abs, hash, deduplicated, created };
}

export function storeTempFile(root, { originalName, folder = '', tempAbs, extra = {} }) {
  const { hash, path: abs, size, deduplicated } = commitTempFile(root, tempAbs);
  const { doc, created } = insertDoc(root, { hash, originalName, folder, size, extra });
  return { doc, abs, hash, deduplicated, created };
}

export function removeDocument(root, relPath) {
  const catalog = loadCatalog(root);
  const rel = String(relPath || '').replace(/^\/+/, '');
  const doc = catalog.documents.find((d) => d.relPath === rel);
  if (!doc) return null;
  catalog.documents = catalog.documents.filter((d) => d.id !== doc.id);
  saveCatalog(root, catalog);
  const still = catalog.documents.some((d) => d.hash === doc.hash);
  removeBlobIfOrphan(root, doc.hash, still);
  return doc;
}

export function renameDocument(root, relPath, newName) {
  const catalog = loadCatalog(root);
  const rel = String(relPath || '').replace(/^\/+/, '');
  const doc = catalog.documents.find((d) => d.relPath === rel);
  if (!doc) throw new Error('Document not found');
  const originalName = uniqueOriginalName(
    { documents: catalog.documents.filter((d) => d.id !== doc.id) },
    doc.folder,
    newName,
  );
  doc.originalName = originalName;
  doc.ext = path.extname(originalName).toLowerCase();
  doc.relPath = logicalRel(doc.folder, originalName);
  saveCatalog(root, catalog);
  return doc;
}

export function moveDocument(root, relPath, destFolder) {
  const catalog = loadCatalog(root);
  const rel = String(relPath || '').replace(/^\/+/, '');
  const doc = catalog.documents.find((d) => d.relPath === rel);
  if (!doc) throw new Error('Document not found');
  const folder = String(destFolder || '').replace(/^\/+|\/+$/g, '');
  const originalName = uniqueOriginalName(
    { documents: catalog.documents.filter((d) => d.id !== doc.id) },
    folder,
    doc.originalName,
  );
  const from = doc.relPath;
  doc.folder = folder;
  doc.originalName = originalName;
  doc.relPath = logicalRel(folder, originalName);
  saveCatalog(root, catalog);
  return { from, to: doc.relPath, doc };
}

export function copyDocument(root, relPath, destFolder) {
  const src = findByRel(root, relPath);
  if (!src) throw new Error('Document not found');
  const folder = String(destFolder || '').replace(/^\/+|\/+$/g, '');
  const { doc } = insertDoc(root, {
    hash: src.hash,
    originalName: src.originalName,
    folder,
    size: src.size,
    extra: { copiedFrom: src.relPath },
  });
  return doc;
}

export function retargetFolder(root, fromFolder, toFolder) {
  const catalog = loadCatalog(root);
  const from = String(fromFolder || '').replace(/^\/+|\/+$/g, '');
  const to = String(toFolder || '').replace(/^\/+|\/+$/g, '');
  const prefix = from ? `${from}/` : '';
  for (const doc of catalog.documents) {
    if (doc.folder === from || doc.folder.startsWith(prefix) || (!from && !doc.folder)) {
      if (!from) continue;
      const rest = doc.folder === from ? '' : doc.folder.slice(prefix.length);
      doc.folder = rest ? `${to}/${rest}` : to;
      doc.relPath = logicalRel(doc.folder, doc.originalName);
    }
  }
  saveCatalog(root, catalog);
}

export function documentsUnder(root, folderPrefix) {
  const prefix = String(folderPrefix || '').replace(/^\/+|\/+$/g, '');
  const catalog = loadCatalog(root);
  if (!prefix) return catalog.documents.slice();
  return catalog.documents.filter(
    (d) => d.folder === prefix || d.folder.startsWith(`${prefix}/`) || d.relPath === prefix,
  );
}

/** Move any leftover named files into the CAS and register them. */
export function migrateLooseFiles(root) {
  if (!fs.existsSync(root)) return [];
  const ingested = [];
  const walk = (dir, rel) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
      const abs = path.join(dir, entry.name);
      const curRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(abs, curRel);
      } else if (entry.isFile()) {
        if (findByRel(root, curRel)) {
          fs.unlinkSync(abs);
          ingested.push(curRel);
          continue;
        }
        const tmp = path.join(casDir(root), 'tmp', crypto.randomUUID());
        fs.mkdirSync(path.dirname(tmp), { recursive: true });
        fs.copyFileSync(abs, tmp);
        storeTempFile(root, {
          originalName: entry.name,
          folder: rel || '',
          tempAbs: tmp,
        });
        fs.unlinkSync(abs);
        ingested.push(curRel);
      }
    }
  };
  walk(root, '');
  return ingested;
}

export { blobPath };
