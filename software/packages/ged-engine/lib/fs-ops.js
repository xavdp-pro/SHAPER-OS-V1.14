/**
 * @file fs-ops.js
 * Real filesystem operations for the GED, all sandboxed inside the GED root.
 * Pure functions of (root, args) — no module-level state, testable in isolation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveSafe, relFrom, assertValidName } from './safe-path.js';

/** Recursive folder tree, `.`-prefixed entries skipped. */
export function buildTree(root, rel = '') {
  const abs = resolveSafe(root, rel);
  let entries;
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    .map((e) => {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const children = buildTree(root, childRel);
      return {
        name: e.name,
        path: childRel,
        hasChildren: children.length > 0,
        children,
      };
    });
}

/** Create a folder inside `parentRel`. */
export function createFolder(root, parentRel, name) {
  const safeName = assertValidName(name);
  const parentAbs = resolveSafe(root, parentRel);
  const target = resolveSafe(root, path.join(relFrom(root, parentAbs), safeName));
  if (fs.existsSync(target)) throw new Error('An entry with this name already exists');
  fs.mkdirSync(target, { recursive: false });
  return relFrom(root, target);
}

/** Rename a file or folder in place. */
export function renameEntry(root, rel, newName) {
  const safeName = assertValidName(newName);
  const abs = resolveSafe(root, rel);
  if (!fs.existsSync(abs)) throw new Error('Entry not found');
  const target = path.join(path.dirname(abs), safeName);
  resolveSafe(root, relFrom(root, target));
  if (fs.existsSync(target)) throw new Error('An entry with this name already exists');
  fs.renameSync(abs, target);
  return relFrom(root, target);
}

/** Delete a file or folder (recursive for folders). */
export function deleteEntry(root, rel) {
  const abs = resolveSafe(root, rel);
  if (abs === path.resolve(root)) throw new Error('Cannot delete the GED root');
  if (!fs.existsSync(abs)) throw new Error('Entry not found');
  fs.rmSync(abs, { recursive: true, force: false });
  return relFrom(root, abs);
}

/** Next free name for a copy: `report.pdf` → `report (copie).pdf` → `report (copie 2).pdf`. */
function freeName(dirAbs, base, ext) {
  let candidate = `${base} (copie)${ext}`;
  let n = 2;
  while (fs.existsSync(path.join(dirAbs, candidate))) {
    candidate = `${base} (copie ${n})${ext}`;
    n += 1;
  }
  return candidate;
}

/**
 * Copy an entry into `destFolderRel`.
 * Copying onto itself produces a "(copie)" sibling rather than failing.
 */
export function copyEntry(root, rel, destFolderRel) {
  const srcAbs = resolveSafe(root, rel);
  if (!fs.existsSync(srcAbs)) throw new Error('Source not found');
  const destDirAbs = resolveSafe(root, destFolderRel);
  if (!fs.existsSync(destDirAbs) || !fs.statSync(destDirAbs).isDirectory()) {
    throw new Error('Destination folder not found');
  }
  const stat = fs.statSync(srcAbs);
  if (stat.isDirectory() && (destDirAbs + path.sep).startsWith(srcAbs + path.sep)) {
    throw new Error('Cannot copy a folder into itself');
  }

  const ext = stat.isDirectory() ? '' : path.extname(srcAbs);
  const base = path.basename(srcAbs, ext);
  let targetName = base + ext;
  if (fs.existsSync(path.join(destDirAbs, targetName))) {
    targetName = freeName(destDirAbs, base, ext);
  }
  const targetAbs = path.join(destDirAbs, targetName);
  fs.cpSync(srcAbs, targetAbs, { recursive: stat.isDirectory() });
  return relFrom(root, targetAbs);
}

/**
 * Move an entry into `destFolderRel`.
 * @returns {{from: string, to: string}} relative paths, so callers can migrate metadata.
 */
export function moveEntry(root, rel, destFolderRel) {
  const srcAbs = resolveSafe(root, rel);
  if (!fs.existsSync(srcAbs)) throw new Error('Source not found');
  const destDirAbs = resolveSafe(root, destFolderRel);
  if (!fs.existsSync(destDirAbs) || !fs.statSync(destDirAbs).isDirectory()) {
    throw new Error('Destination folder not found');
  }
  const stat = fs.statSync(srcAbs);
  if (stat.isDirectory() && (destDirAbs + path.sep).startsWith(srcAbs + path.sep)) {
    throw new Error('Cannot move a folder into itself');
  }
  const targetAbs = path.join(destDirAbs, path.basename(srcAbs));
  if (fs.existsSync(targetAbs)) throw new Error('An entry with this name already exists at the destination');
  fs.renameSync(srcAbs, targetAbs);
  return { from: relFrom(root, srcAbs), to: relFrom(root, targetAbs) };
}

/** Stat one entry, for the inspector panel. */
export function statEntry(root, rel) {
  const abs = resolveSafe(root, rel);
  if (!fs.existsSync(abs)) throw new Error('Entry not found');
  const s = fs.statSync(abs);
  return {
    path: relFrom(root, abs),
    name: path.basename(abs),
    isDirectory: s.isDirectory(),
    size: s.size,
    modifiedAt: s.mtimeMs,
    createdAt: s.birthtimeMs || s.ctimeMs,
    ext: s.isDirectory() ? '' : path.extname(abs).toLowerCase(),
  };
}
