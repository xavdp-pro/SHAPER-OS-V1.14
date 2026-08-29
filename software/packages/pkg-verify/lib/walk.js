import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'sav', 'data', '.claude']);

/** Walk a repository tree, yielding absolute file paths. Skips runtime state. */
export function* walk(root) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const abs = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(abs);
    } else if (entry.isFile()) {
      yield abs;
    }
  }
}

export function files(root, ext) {
  return [...walk(root)].filter((f) => f.endsWith(ext));
}

export function rel(root, abs) {
  return path.relative(root, abs);
}
