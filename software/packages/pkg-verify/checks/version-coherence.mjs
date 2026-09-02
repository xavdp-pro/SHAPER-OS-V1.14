import fs from 'node:fs';
import path from 'node:path';
import { files, rel } from '../lib/walk.js';

export const rule = 'Rule 0D — Dual Intent & Topology Manifest Protocol';
export const title = 'Manifests and package versions name the release they live in';
export const readAt = 'software/RULES.md';

const REPO_VERSION = /-V(\d+\.\d+)$/;
const POINTER = /SHAPER-OS(?:-BRICKS)?-V(\d+\.\d+)/g;

/** The `version` field of a JSON file, or null when the file carries none. */
function versionOf(file) {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  return doc && typeof doc.version === 'string' ? doc.version : null;
}

/**
 * The repo's version is its folder name (SHAPER-OS-V1.12). Every cross-repo
 * pointer inside manifests and every package version must agree with it.
 * Born from the incident where four manifests still named V1.11 in V1.12.
 *
 * Every package.json, not the root alone. The first version of this check
 * read the root and accepted any version under the folder's prefix, so one
 * package could say 1.13.23 beside sixteen saying 1.13.2 — and the universe
 * template's package.json could keep 1.7.0 in a V1.13 tree — while verify
 * reported that the release named itself once. The root package.json is the
 * reference; every other package.json, and every manifest that carries a
 * version, must say exactly the same thing.
 */
export function run(root) {
  const findings = [];
  const m = path.basename(root).match(REPO_VERSION);
  if (!m) return findings; // an unversioned repo (a universe repo) has nothing to agree with
  const version = m[1];

  const rootPkg = path.join(root, 'package.json');
  const reference = fs.existsSync(rootPkg) ? versionOf(rootPkg) : null;
  if (reference && !reference.startsWith(version + '.')) {
    findings.push(`package.json declares ${reference}, the repository is V${version}`);
  }

  // walk() never enters node_modules: a dependency's version is not the release's.
  for (const file of files(root, 'package.json')) {
    if (path.basename(file) !== 'package.json' || file === rootPkg) continue;
    const declared = versionOf(file);
    if (!declared) continue;
    if (!declared.startsWith(version + '.')) {
      findings.push(`${rel(root, file)} declares ${declared}, the repository is V${version}`);
    } else if (reference && declared !== reference) {
      findings.push(`${rel(root, file)} declares ${declared}, the root package.json declares ${reference}`);
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
    // A manifest that carries a version carries the release's: the template
    // is copied into every universe, and a version there is a promise about
    // which base the copy was made from.
    let declared;
    try { declared = versionOf(file); } catch { continue; } // an unparsable manifest is another check's finding
    if (declared && reference && declared !== reference) {
      findings.push(`${rel(root, file)} declares ${declared}, the root package.json declares ${reference}`);
    }
  }
  return findings;
}
