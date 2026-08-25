/**
 * @file safe-path.js
 * Path sandboxing for the GED. Every filesystem operation resolves through here.
 * A relative path from the client can never escape the GED root, whatever it contains.
 */
import path from 'node:path';

/**
 * Resolve a client-supplied relative path inside `root`.
 * @param {string} root Absolute GED root.
 * @param {string} rel  Client-supplied relative path (may be empty for the root itself).
 * @returns {string} Absolute path guaranteed to sit inside `root`.
 * @throws {Error} When the path escapes the root.
 */
export function resolveSafe(root, rel = '') {
  const cleaned = String(rel || '').replace(/^[/\\]+/, '');
  const abs = path.resolve(root, cleaned);
  const rootWithSep = path.resolve(root) + path.sep;
  if (abs !== path.resolve(root) && !abs.startsWith(rootWithSep)) {
    const err = new Error('Path escapes the GED root');
    err.code = 'EOUTSIDE';
    throw err;
  }
  return abs;
}

/** Relative POSIX-style path of `abs` inside `root` ('' for the root itself). */
export function relFrom(root, abs) {
  const rel = path.relative(path.resolve(root), abs);
  return rel.split(path.sep).join('/');
}

/** Reject names that would break the tree or hide entries. */
export function assertValidName(name) {
  const n = String(name || '').trim();
  if (!n) throw new Error('Name required');
  if (n === '.' || n === '..') throw new Error('Invalid name');
  if (n.includes('/') || n.includes('\\')) throw new Error('Name cannot contain a path separator');
  if (n.startsWith('.')) throw new Error('Name cannot start with a dot');
  return n;
}
