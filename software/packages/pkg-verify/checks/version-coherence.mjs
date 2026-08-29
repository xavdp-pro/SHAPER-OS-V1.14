import fs from 'node:fs';
import path from 'node:path';
import { files, rel } from '../lib/walk.js';

export const rule = 'Rule 0D — Dual Intent & Topology Manifest Protocol';
export const title = 'Manifests and package versions name the release they live in';
export const readAt = 'software/RULES.md';

const REPO_VERSION = /-V(\d+\.\d+)$/;
const POINTER = /SHAPER-OS(?:-BRICKS)?-V(\d+\.\d+)/g;

/**
 * The repo's version is its folder name (SHAPER-OS-V1.12). Every cross-repo
 * pointer inside manifests and the root package version must agree with it.
 * Born from the incident where four manifests still named V1.11 in V1.12.
 */
export function run(root) {
  const findings = [];
  const m = path.basename(root).match(REPO_VERSION);
  if (!m) return findings; // an unversioned repo (a universe repo) has nothing to agree with
  const version = m[1];

  const pkgPath = path.join(root, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (pkg.version && !pkg.version.startsWith(version + '.')) {
      findings.push(`package.json declares ${pkg.version}, the repository is V${version}`);
    }
  }

  for (const file of files(root, '.json')) {
    if (!path.basename(file).startsWith('manifest')) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(POINTER)) {
      if (match[1] !== version) {
        findings.push(`${rel(root, file)} points at V${match[1]}, the repository is V${version}`);
      }
    }
  }
  return findings;
}
