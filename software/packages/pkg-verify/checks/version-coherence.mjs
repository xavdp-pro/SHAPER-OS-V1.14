import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { walk, rel } from '../lib/walk.js';

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
 * The files this check reads: what the repository ships, not what happens
 * to sit on one operator's disk. A universe copied from the template into
 * `universes/univ-<slug>` — exactly what the clean-sheet guide prescribes —
 * is untracked and carries the template's package.json; judging it would
 * turn verify red on every operator's machine over a file the repository
 * does not deliver (beta finding F12, the same lesson one-port-family and
 * manifest-contract learned). So the list comes from `git ls-files`; when
 * git cannot answer (a `git archive` extract, a fixture without `.git`) the
 * disk walk is the honest fallback, and it never enters node_modules.
 */
function trackedFiles(root) {
  if (fs.existsSync(path.join(root, '.git'))) {
    try {
      return execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        .split('\0')
        .filter(Boolean)
        .map((relative) => path.join(root, relative))
        .filter((file) => fs.existsSync(file)); // tracked but deleted on disk: nothing to read
    } catch {
      // git absent or refusing this tree: fall through to the disk walk
    }
  }
  return [...walk(root)];
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

  const tracked = trackedFiles(root);

  for (const file of tracked) {
    if (path.basename(file) !== 'package.json' || file === rootPkg) continue;
    // A package.json that does not parse is a finding that names the file,
    // not a stack trace that ends verify (Rule 0J): the halt must speak.
    let declared;
    try { declared = versionOf(file); } catch (err) { findings.push(`${rel(root, file)} is not valid JSON: ${err.message}`); continue; }
    if (!declared) continue;
    if (!declared.startsWith(version + '.')) {
      findings.push(`${rel(root, file)} declares ${declared}, the repository is V${version}`);
    } else if (reference && declared !== reference) {
      findings.push(`${rel(root, file)} declares ${declared}, the root package.json declares ${reference}`);
    }
  }

  for (const file of tracked) {
    if (!file.endsWith('.json') || !path.basename(file).startsWith('manifest')) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(POINTER)) {
      if (match[1] !== version) {
        findings.push(`${rel(root, file)} points at V${match[1]}, the repository is V${version}`);
      }
    }
    // A manifest that carries a version carries the release's: the template
    // is copied into every universe, and a version there is a promise about
    // which base the copy was made from. An unparsable manifest is reported
    // under the same words as an unparsable package.json.
    let declared;
    try { declared = versionOf(file); } catch (err) { findings.push(`${rel(root, file)} is not valid JSON: ${err.message}`); continue; }
    if (declared && reference && declared !== reference) {
      findings.push(`${rel(root, file)} declares ${declared}, the root package.json declares ${reference}`);
    }
  }
  return findings;
}
