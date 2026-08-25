/**
 * Content-addressed blob store for the GED.
 *
 * On disk a file is its SHA-256 hex (same model as an MD5 archive: the bytes
 * decide the name, not the original filename). Original names live in the
 * catalog, not on the filesystem — accents, spaces, age and Windows-illegal
 * characters never touch the blob path.
 *
 * SHA-256 is used instead of MD5: same pattern, no practical collision.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const HASH_ALGO = 'sha256';

export function casDir(root) {
  return path.join(root, '.cas');
}

export function blobPath(root, hash) {
  const h = String(hash || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(h)) {
    throw new Error('Invalid content hash');
  }
  return path.join(casDir(root), h.slice(0, 2), h.slice(2, 4), h);
}

export function hashBuffer(buf) {
  return crypto.createHash(HASH_ALGO).update(buf).digest('hex');
}

export function hashFile(absPath) {
  const hash = crypto.createHash(HASH_ALGO);
  const fd = fs.openSync(absPath, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

export function putBuffer(root, buf) {
  const hash = hashBuffer(buf);
  const dest = blobPath(root, hash);
  const existed = fs.existsSync(dest);
  if (!existed) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
  }
  return { hash, path: dest, size: buf.length, deduplicated: existed };
}

/** Hash a temp file and move it into the CAS. Deletes the temp on success. */
export function commitTempFile(root, tempAbs) {
  const hash = hashFile(tempAbs);
  const dest = blobPath(root, hash);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) {
    fs.unlinkSync(tempAbs);
    const size = fs.statSync(dest).size;
    return { hash, path: dest, size, deduplicated: true };
  }
  fs.renameSync(tempAbs, dest);
  return { hash, path: dest, size: fs.statSync(dest).size, deduplicated: false };
}

export function blobExists(root, hash) {
  try {
    return fs.existsSync(blobPath(root, hash));
  } catch {
    return false;
  }
}

export function removeBlobIfOrphan(root, hash, stillReferenced) {
  if (stillReferenced) return false;
  try {
    const dest = blobPath(root, hash);
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    return true;
  } catch {
    return false;
  }
}
