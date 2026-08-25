import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolveSafe, relFrom } from './lib/safe-path.js';
import {
  buildTree, createFolder, renameEntry, deleteEntry, copyEntry, moveEntry, statEntry,
} from './lib/fs-ops.js';
import { analyzeFile, toAnalyzeResponse } from './lib/analyze.js';
import { DEV, CLIENT_SNIPPET, handleLiveReload, watchPublic } from './lib/livereload.js';
import { blobPath, casDir } from './lib/cas.js';
import {
  loadCatalog,
  findByRel,
  resolveBlob,
  storeTempFile,
  removeDocument,
  renameDocument,
  moveDocument,
  copyDocument,
  retargetFolder,
  documentsUnder,
  migrateLooseFiles,
} from './lib/catalog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PORT = Number(process.env.GED_PORT || process.env.PORT || 8660);
export const DATA_DIR = process.env.GED_DATA_DIR || path.join(__dirname, '../../data/ged');
export const PUBLIC_DIR = path.join(__dirname, 'public');

fs.mkdirSync(DATA_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.zip': 'application/zip',
};

export function classifyCategory(ext) {
  const e = String(ext || '').toLowerCase();
  if (['.pdf'].includes(e)) return 'pdf';
  if (['.xlsx', '.xls', '.csv', '.tsv', '.parquet'].includes(e)) return 'spreadsheet';
  if (['.docx', '.doc', '.odt', '.txt', '.md', '.rtf'].includes(e)) return 'document';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(e)) return 'image';
  if (['.zip', '.tar.gz', '.tgz', '.7z', '.rar'].includes(e)) return 'archive';
  return 'other';
}

export const META_FILE = path.join(DATA_DIR, '.meta.json');

function metaFile(dir = DATA_DIR) {
  return path.join(dir, '.meta.json');
}

export function getMetadata(dir = DATA_DIR) {
  const file = dir === DATA_DIR ? META_FILE : metaFile(dir);
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { /* skip */ }
  return {};
}

export function saveMetadata(meta, dir = DATA_DIR) {
  const file = dir === DATA_DIR ? META_FILE : metaFile(dir);
  try {
    fs.writeFileSync(file, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  } catch (err) {
    console.error('[ged-meta] Error saving .meta.json:', err.message);
  }
}

function relocateMeta(fromRel, toRel, dir = DATA_DIR) {
  if (!fromRel || fromRel === toRel) return;
  const meta = getMetadata(dir);
  if (!meta[fromRel]) return;
  meta[toRel] = meta[fromRel];
  delete meta[fromRel];
  saveMetadata(meta, dir);
}

function contentDisposition(originalName, download) {
  const ascii = String(originalName || 'file').replace(/[^\x20-\x7E]/g, '_');
  const encoded = encodeURIComponent(originalName || 'file');
  const kind = download ? 'attachment' : 'inline';
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function setFileMeta(relPath, fileMeta) {
  const meta = getMetadata();
  meta[relPath] = {
    ...(meta[relPath] || {}),
    ...fileMeta,
    updatedAt: Date.now(),
  };
  saveMetadata(meta);
}

export function deleteFileMeta(relPath) {
  const meta = getMetadata();
  if (meta[relPath]) {
    delete meta[relPath];
    saveMetadata(meta);
  }
}

export function deleteFilesByConversation(conversationId) {
  if (!conversationId) return [];
  migrateLooseFiles(DATA_DIR);
  const meta = getMetadata();
  const deleted = [];
  for (const [relPath, info] of Object.entries(meta)) {
    if (info.conversationId === conversationId) {
      try {
        removeDocument(DATA_DIR, relPath);
        deleted.push(relPath);
        delete meta[relPath];
      } catch (err) {
        console.error(`[ged-meta] Error deleting ${relPath}:`, err.message);
      }
    }
  }
  if (deleted.length > 0) saveMetadata(meta);
  return deleted;
}

export function listGedFolders(dir = DATA_DIR) {
  if (!fs.existsSync(dir)) return [];
  migrateLooseFiles(dir);
  const folders = new Set();
  const walk = (d, rel = '') => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        const curRel = rel ? `${rel}/${entry.name}` : entry.name;
        folders.add(curRel);
        walk(path.join(d, entry.name), curRel);
      }
    }
  };
  walk(dir);
  for (const doc of loadCatalog(dir).documents) {
    if (!doc.folder) continue;
    const parts = doc.folder.split('/');
    let acc = '';
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      folders.add(acc);
    }
  }
  return [...folders].sort();
}

export function listGedFiles(dir = DATA_DIR) {
  if (!fs.existsSync(dir)) return [];
  migrateLooseFiles(dir);
  const meta = getMetadata(dir);
  const out = [];
  for (const doc of loadCatalog(dir).documents) {
    const fileMeta = meta[doc.relPath] || {};
    let mtime = doc.createdAt || Date.now();
    let size = doc.size || 0;
    try {
      const st = fs.statSync(blobPath(dir, doc.hash));
      mtime = Math.floor(st.mtimeMs);
      size = st.size;
    } catch { /* blob missing */ }
    out.push({
      id: Buffer.from(doc.relPath).toString('base64url'),
      name: doc.originalName,
      relPath: doc.relPath,
      folder: doc.folder || '',
      size,
      mtime,
      ext: doc.ext,
      mime: MIME[doc.ext] || 'application/octet-stream',
      category: classifyCategory(doc.ext),
      hash: doc.hash,
      conversationId: fileMeta.conversationId || '',
      conversationName: fileMeta.conversationName || '',
      analyzed: Boolean(fileMeta.analysis),
      analysisMode: fileMeta.analysis?.mode || null,
      syncStatus: fileMeta.syncStatus || 'synced',
      restrictedRole: fileMeta.restrictedRole || '',
      tag: fileMeta.tag || '',
      color: fileMeta.color || '',
      emblem: fileMeta.emblem || '',
      importedAt: fileMeta.importedAt || mtime,
    });
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

function originalFileName(raw) {
  const base = path.basename(String(raw || '').replace(/\\/g, '/'));
  const cleaned = base.replace(/[\u0000-\u001f]/g, '').trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') return `file_${Date.now()}`;
  return cleaned;
}

function statLogical(rel) {
  migrateLooseFiles(DATA_DIR);
  const resolved = resolveBlob(DATA_DIR, rel);
  if (resolved) {
    const st = fs.statSync(resolved.abs);
    return {
      path: resolved.doc.relPath,
      name: resolved.doc.originalName,
      isDirectory: false,
      size: st.size,
      modifiedAt: st.mtimeMs,
      createdAt: st.ctimeMs,
      ext: resolved.doc.ext,
      hash: resolved.doc.hash,
    };
  }
  return statEntry(DATA_DIR, rel);
}

export function handleRequest(req, res) {
  const parsed = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const pathname = parsed.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (handleLiveReload(req, res, pathname)) return;

  if (pathname === '/health' || pathname === '/api/health') {
    const files = listGedFiles();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'ged-v1',
      filesCount: files.length,
      storageBytes: files.reduce((a, f) => a + f.size, 0),
      dataDir: DATA_DIR,
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  if (pathname === '/api/stats' || pathname === '/stats') {
    const files = listGedFiles();
    const folders = listGedFolders();
    const byCategory = {
      pdf: files.filter(f => f.category === 'pdf').length,
      spreadsheet: files.filter(f => f.category === 'spreadsheet').length,
      document: files.filter(f => f.category === 'document').length,
      image: files.filter(f => f.category === 'image').length,
      archive: files.filter(f => f.category === 'archive').length,
      other: files.filter(f => !['pdf', 'spreadsheet', 'document', 'image', 'archive'].includes(f.category)).length,
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      totalFiles: files.length,
      totalFolders: folders.length,
      storageBytes: files.reduce((a, f) => a + f.size, 0),
      byCategory,
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  if (req.method === 'GET' && (pathname === '/api/files' || pathname === '/files')) {
    const category = parsed.searchParams.get('category');
    const folder = parsed.searchParams.get('folder');
    const tag = parsed.searchParams.get('tag');
    const q = (parsed.searchParams.get('q') || '').toLowerCase().trim();
    let files = listGedFiles();
    if (category && category !== 'all') files = files.filter(f => f.category === category);
    if (folder !== null && folder !== undefined && folder !== 'all') {
      files = files.filter(f => f.folder === folder);
    }
    if (tag && tag !== 'all') files = files.filter(f => f.tag === tag || f.color === tag);
    if (q) files = files.filter(f => f.name.toLowerCase().includes(q) || f.relPath.toLowerCase().includes(q));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, files, count: files.length }));
    return;
  }

  if (req.method === 'GET' && (pathname === '/api/search' || pathname === '/search')) {
    const q = (parsed.searchParams.get('q') || '').toLowerCase().trim();
    const facet = (parsed.searchParams.get('facet') || 'all').toLowerCase().trim();
    const category = parsed.searchParams.get('category') || 'all';

    migrateLooseFiles(DATA_DIR);
    let files = listGedFiles();
    const meta = getMetadata();

    if (category && category !== 'all') {
      files = files.filter(f => f.category === category);
    }

    // Calcul du nuage de mots-clés disponibles dans la bibliothèque
    const allKeywordsMap = new Map();
    for (const f of files) {
      const a = meta[f.relPath]?.analysis;
      if (a?.keywords) {
        for (const kw of a.keywords) {
          const w = (kw.word || '').toLowerCase().trim();
          if (w.length >= 2) {
            allKeywordsMap.set(w, (allKeywordsMap.get(w) || 0) + 1);
          }
        }
      }
    }
    const topKeywords = Array.from(allKeywordsMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([word, count]) => ({ word, count }));

    if (!q) {
      const results = files.map(f => ({
        file: f,
        analysis: meta[f.relPath]?.analysis || null,
        matches: [],
        score: 0,
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, query: '', facet, total: results.length, topKeywords, results }));
      return;
    }

    const terms = q.split(/\s+/).filter(Boolean);
    const results = [];

    for (const f of files) {
      const a = meta[f.relPath]?.analysis;
      const matches = [];
      let score = 0;

      const nameLower = f.name.toLowerCase();
      const relLower = f.relPath.toLowerCase();
      const summaryLower = (a?.summary || '').toLowerCase();
      const textPreviewLower = (a?.textPreview || '').toLowerCase();
      const keywords = (a?.keywords || []).map(k => (k.word || '').toLowerCase());

      for (const term of terms) {
        // 1. Mots-clés IA (score max 100)
        if (facet === 'all' || facet === 'keywords') {
          const matchedKw = keywords.filter(kw => kw.includes(term));
          if (matchedKw.length > 0) {
            score += 100 * matchedKw.length;
            matches.push({ type: 'keyword', label: `Mot-clé : ${matchedKw.join(', ')}` });
          }
        }

        // 2. Nom de fichier & Chemin
        if (facet === 'all' || facet === 'names') {
          if (nameLower.includes(term)) {
            score += 80;
            matches.push({ type: 'name', label: `Fichier : ${f.name}` });
          } else if (relLower.includes(term)) {
            score += 40;
            matches.push({ type: 'path', label: `Dossier : ${f.relPath}` });
          }
        }

        // 3. Synthèse Métier & Vision
        if (facet === 'all' || facet === 'text') {
          if (summaryLower.includes(term)) {
            score += 60;
            const idx = summaryLower.indexOf(term);
            const start = Math.max(0, idx - 40);
            const end = Math.min(a.summary.length, idx + term.length + 60);
            const snippet = (start > 0 ? '…' : '') + a.summary.slice(start, end).trim() + (end < a.summary.length ? '…' : '');
            matches.push({ type: 'summary', snippet, label: 'Synthèse IA' });
          }
        }

        // 4. Texte Intégral Extrait
        if (facet === 'all' || facet === 'text') {
          if (textPreviewLower.includes(term)) {
            score += 30;
            const idx = textPreviewLower.indexOf(term);
            const start = Math.max(0, idx - 40);
            const end = Math.min(a.textPreview.length, idx + term.length + 60);
            const snippet = (start > 0 ? '…' : '') + a.textPreview.slice(start, end).trim() + (end < a.textPreview.length ? '…' : '');
            matches.push({ type: 'text', snippet, label: 'Texte extrait' });
          }
        }
      }

      if (matches.length > 0) {
        results.push({
          file: f,
          analysis: a || null,
          matches,
          score,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      query: q,
      facet,
      total: results.length,
      topKeywords,
      results,
    }));
    return;
  }

  if (pathname === '/api/folders' || pathname === '/folders') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, folders: listGedFolders() }));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          const folderName = String(data.folder || data.name || '').trim().replace(/\.\./g, '');
          if (!folderName) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Folder name required' }));
            return;
          }
          createFolder(DATA_DIR, path.dirname(folderName) === '.' ? '' : path.dirname(folderName), path.basename(folderName));
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, folder: folderName, folders: listGedFolders() }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }
  }

  if (req.method === 'POST' && (pathname === '/api/tag' || pathname === '/tag')) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const relPath = String(data.relPath || '').trim().replace(/\.\./g, '');
        if (!relPath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'relPath required' }));
          return;
        }
        setFileMeta(relPath, {
          tag: data.tag || '',
          color: data.color || '',
          emblem: data.emblem || '',
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, relPath, tag: data.tag, color: data.color, emblem: data.emblem }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  const matchDelConv = pathname.match(/^(?:\/api)?\/by-conversation\/(.+)$/);
  if ((req.method === 'DELETE' || req.method === 'POST') && (matchDelConv || pathname.endsWith('/delete-by-conversation'))) {
    const convId = matchDelConv ? decodeURIComponent(matchDelConv[1]) : (parsed.searchParams.get('conversationId') || '');
    const deleted = deleteFilesByConversation(convId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, conversationId: convId, deletedCount: deleted.length, deleted }));
    return;
  }

  if (req.method === 'POST' && (pathname === '/api/upload' || pathname === '/upload')) {
    const filename = originalFileName(decodeURIComponent(parsed.searchParams.get('filename') || req.headers['x-filename'] || `file_${Date.now()}`));
    const folder = String(parsed.searchParams.get('folder') || '').replace(/\.\./g, '');
    const conversationId = parsed.searchParams.get('conversationId') || req.headers['x-conversation-id'] || '';
    const conversationName = decodeURIComponent(parsed.searchParams.get('conversationName') || req.headers['x-conversation-name'] || '');
    const tmp = path.join(casDir(DATA_DIR), 'tmp', crypto.randomUUID());
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    if (folder) fs.mkdirSync(resolveSafe(DATA_DIR, folder), { recursive: true });
    const writeStream = fs.createWriteStream(tmp);
    req.pipe(writeStream);
    writeStream.on('finish', () => {
      try {
        const { doc, hash, deduplicated } = storeTempFile(DATA_DIR, {
          originalName: filename,
          folder,
          tempAbs: tmp,
        });
        setFileMeta(doc.relPath, {
          conversationId,
          conversationName: conversationName || conversationId,
          importedAt: Date.now(),
        });
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          file: {
            name: doc.originalName,
            relPath: doc.relPath,
            size: doc.size,
            category: classifyCategory(doc.ext),
            hash,
            deduplicated,
            conversationId,
            conversationName,
          },
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    writeStream.on('error', (err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    });
    return;
  }

  const matchFile = pathname.match(/^(?:\/api)?\/files\/([^/]+)\/(download|preview)$/);
  if (req.method === 'GET' && matchFile) {
    let relPath;
    try {
      relPath = Buffer.from(matchFile[1], 'base64url').toString('utf8');
    } catch {
      relPath = decodeURIComponent(matchFile[1]);
    }
    migrateLooseFiles(DATA_DIR);
    const resolved = resolveBlob(DATA_DIR, relPath);
    if (!resolved) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'File not found' }));
      return;
    }
    const ext = resolved.doc.ext;
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Disposition': contentDisposition(resolved.doc.originalName, matchFile[2] === 'download'),
      'Content-Length': fs.statSync(resolved.abs).size,
    });
    fs.createReadStream(resolved.abs).pipe(res);
    return;
  }

  const matchDelete = pathname.match(/^(?:\/api)?\/files\/([^/]+)$/);
  if (req.method === 'DELETE' && matchDelete) {
    let relPath;
    try {
      relPath = Buffer.from(matchDelete[1], 'base64url').toString('utf8');
    } catch {
      relPath = decodeURIComponent(matchDelete[1]);
    }
    const removed = removeDocument(DATA_DIR, relPath);
    if (removed) {
      deleteFileMeta(relPath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, deleted: relPath }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'File not found' }));
    }
    return;
  }

  if (req.method === 'GET' && (pathname === '/api/tree' || pathname === '/api/arborescence')) {
    migrateLooseFiles(DATA_DIR);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, tree: buildTree(DATA_DIR), root: DATA_DIR }));
    return;
  }

  if (req.method === 'GET' && (pathname === '/api/stat' || pathname === '/api/proprietes')) {
    try {
      const rel = parsed.searchParams.get('path') || '';
      const meta = getMetadata();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, entry: statLogical(rel), meta: meta[rel] || null }));
    } catch (err) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/raw') {
    try {
      const rel = parsed.searchParams.get('path') || '';
      migrateLooseFiles(DATA_DIR);
      const resolved = resolveBlob(DATA_DIR, rel);
      if (!resolved) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'File not found' }));
        return;
      }
      const download = parsed.searchParams.get('download') === '1';
      res.writeHead(200, {
        'Content-Type': MIME[resolved.doc.ext] || 'application/octet-stream',
        'Content-Length': fs.statSync(resolved.abs).size,
        'Content-Disposition': contentDisposition(resolved.doc.originalName, download),
      });
      fs.createReadStream(resolved.abs).pipe(res);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  if (req.method === 'POST' && (pathname === '/api/fs' || pathname === '/api/fs')) {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const d = JSON.parse(body || '{}');
        const op = String(d.op || '');
        migrateLooseFiles(DATA_DIR);
        let result;

        if (op === 'mkdir') {
          result = { path: createFolder(DATA_DIR, d.parent || '', d.name) };
        } else if (op === 'rename') {
          const from = String(d.path || '');
          if (findByRel(DATA_DIR, from)) {
            const doc = renameDocument(DATA_DIR, from, d.name);
            relocateMeta(from, doc.relPath);
            result = { path: doc.relPath };
          } else {
            const to = renameEntry(DATA_DIR, from, d.name);
            retargetFolder(DATA_DIR, from, to);
            relocateMeta(from, to);
            result = { path: to };
          }
        } else if (op === 'delete') {
          const target = String(d.path || '');
          if (findByRel(DATA_DIR, target)) {
            removeDocument(DATA_DIR, target);
            deleteFileMeta(target);
            result = { path: target };
          } else {
            for (const doc of documentsUnder(DATA_DIR, target)) {
              removeDocument(DATA_DIR, doc.relPath);
              deleteFileMeta(doc.relPath);
            }
            result = { path: deleteEntry(DATA_DIR, target) };
          }
        } else if (op === 'copy') {
          const from = String(d.path || '');
          const dest = String(d.dest ?? '');
          if (findByRel(DATA_DIR, from)) {
            const doc = copyDocument(DATA_DIR, from, dest);
            result = { path: doc.relPath };
          } else {
            result = { path: copyEntry(DATA_DIR, from, dest) };
          }
        } else if (op === 'move') {
          const from = String(d.path || '');
          const dest = String(d.dest ?? '');
          if (findByRel(DATA_DIR, from)) {
            const moved = moveDocument(DATA_DIR, from, dest);
            relocateMeta(moved.from, moved.to);
            result = { path: moved.to };
          } else {
            const moved = moveEntry(DATA_DIR, from, dest);
            retargetFolder(DATA_DIR, moved.from, moved.to);
            relocateMeta(moved.from, moved.to);
            result = { path: moved.to };
          }
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `Unknown operation: ${op}` }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, op, ...result }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  if (req.method === 'GET' && (pathname === '/api/analysis' || pathname === '/api/analyse')) {
    const rel = parsed.searchParams.get('path') || '';
    const meta = getMetadata();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, path: rel, analysis: meta[rel]?.analysis || null }));
    return;
  }

  if (req.method === 'POST' && (pathname === '/api/analyze' || pathname === '/api/analyser')) {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const d = JSON.parse(body || '{}');
        const rel = String(d.path || '');
        migrateLooseFiles(DATA_DIR);
        const resolved = resolveBlob(DATA_DIR, rel);
        if (!resolved) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'File not found' }));
          return;
        }
        const analysis = await analyzeFile(resolved.abs, { displayName: resolved.doc.originalName });
        const meta = getMetadata();
        meta[rel] = { ...(meta[rel] || {}), analysis, updatedAt: Date.now() };
        saveMetadata(meta);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(toAnalyzeResponse(resolved.doc, analysis)));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  let staticPath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!fs.existsSync(staticPath) || !fs.statSync(staticPath).isFile()) {
    staticPath = path.join(PUBLIC_DIR, 'index.html');
  }

  if (fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
    const ext = path.extname(staticPath).toLowerCase();
    if (DEV && ext === '.html') {
      const html = fs.readFileSync(staticPath, 'utf8').replace('</body>', `${CLIENT_SNIPPET}\n</body>`);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }
    const st = fs.statSync(staticPath);
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' });
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
      ETag: etag,
    });
    fs.createReadStream(staticPath).pipe(res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

export function createGedServer(port = PORT) {
  watchPublic(PUBLIC_DIR);
  const server = http.createServer(handleRequest);
  server.listen(port, '0.0.0.0', () => {
    console.log(`[ged-v1] Mini-GED active on http://0.0.0.0:${port} (data: ${DATA_DIR})`);
  });
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createGedServer(PORT);
}
