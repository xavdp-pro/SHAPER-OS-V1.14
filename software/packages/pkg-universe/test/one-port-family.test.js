import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Intent: docs/architecture/BRICKS.md#one-port-family

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * One stack, one port family.
 *
 * The core bricks answer on 8610 (vault), 8620 (logger), 8630 (maestro),
 * 8640 (queue) and 4440 (bridge, 4441 for its internal serve). That is the
 * family the doctrine states, the template manifest declares, and the nine
 * beta-campaign seals curled. Until V1.13.2 a second family — 85x0 and 434x —
 * survived in univ-base, the brick Containerfiles and quadlets, every
 * package's default port, the topology intent and the delivery script, and
 * one bootstrap script mixed the two on a single line. Beta finding F5 was the
 * consequence: the manifest said one family, the deploy script another, and
 * `test:live` failed exactly as documented. V1.13.1 made the template read the
 * manifest; it did not touch the half of the tree that still carried the old
 * numbers, so the next clean sheet built from a brick met the wall again.
 *
 * This guard reads the tracked tree and refuses any old-family port. It is a
 * lexical scan, so it looks only at numbers standing on their own — not inside
 * a hash, an identifier or a longer number — and it skips the dated proof
 * readings, which record what a past run saw and must not be rewritten.
 *
 * Tracked, not "on disk": the first version walked the working tree, which
 * also reached an operator's own untracked files — a `.env` or a
 * `cfg-<universe>.env` inherited from an older release still saying
 * `LOGGER_PORT=` and the old number. That turned `npm test` red on one
 * machine only, over a file the repository does not ship, and echoed a line
 * of that operator's private configuration into the test output. So the file
 * list now comes from `git ls-files`; when git cannot answer (a `git archive`
 * extract has no `.git`) the walk falls back to the disk and leaves every
 * env-style file unread, because that is where secrets live.
 */

/** The retired family. Written as a pattern so this file does not trip itself. */
const OLD_FAMILY = /(?<![0-9A-Za-z_.])(?:85[1-4]0|434[01])(?![0-9A-Za-z])/g;

/** A line that carries this marker is an explicit fixture of the old family. */
const FIXTURE_MARKER = 'one-port-family: fixture';

/**
 * Never scanned: version control, dependencies, dated proof readings. The
 * proof skip is defensive — no reading under docs/proof carries an old-family
 * number today — but a future seal that records what an old-family stack
 * answered must stay a faithful record, not become a guard violation.
 */
const SKIPPED_DIRS = new Set(['.git', 'node_modules']);
const SKIPPED_PATHS = [/^docs\/proof\//];

/**
 * An operator's configuration, never the repository's: `.env`, `.env.<x>`,
 * `cfg-<universe>.env`, `deploy/env`. The tracked `*.example` twins are
 * documentation and stay in scope.
 */
function isOperatorEnvFile(relative) {
  const name = path.basename(relative);
  if (name.endsWith('.example')) return false;
  return name === '.env' || name.startsWith('.env.') || name.endsWith('.env') || name === 'env';
}

/** Paths git tracks, or null when git cannot answer for this tree. */
function trackedPaths() {
  if (!fs.existsSync(path.join(REPO, '.git'))) return null;
  try {
    return execFileSync('git', ['-C', REPO, 'ls-files', '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\0')
      .filter(Boolean);
  } catch {
    return null; // git absent or refusing this tree: the disk walk below is the honest fallback
  }
}

/** Disk walk for a tree without git; operator env files are left unread. */
function walkedPaths(dir = REPO, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED_DIRS.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    const relative = path.relative(REPO, absolute);
    if (entry.isDirectory()) { walkedPaths(absolute, found); continue; }
    if (!entry.isFile()) continue;
    if (isOperatorEnvFile(relative)) continue;
    found.push(relative);
  }
  return found;
}

/** [relative path, text] for every file the guard reads. */
export function textFiles() {
  const paths = trackedPaths() ?? walkedPaths();
  const found = [];
  for (const relative of paths) {
    if (SKIPPED_PATHS.some((re) => re.test(relative))) continue;
    if (relative.split('/').some((segment) => SKIPPED_DIRS.has(segment))) continue;
    const absolute = path.join(REPO, relative);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue; // tracked but deleted on disk
    const buffer = fs.readFileSync(absolute);
    if (buffer.subarray(0, 8192).includes(0)) continue; // binary, not prose or code
    found.push([relative, buffer.toString('utf8')]);
  }
  return found;
}

function survivorsIn(files) {
  const survivors = [];
  for (const [file, text] of files) {
    text.split('\n').forEach((line, index) => {
      if (line.includes(FIXTURE_MARKER)) return;
      const hits = line.match(OLD_FAMILY);
      if (hits) survivors.push(`${file}:${index + 1}: ${hits.join(', ')} — "${line.trim().slice(0, 80)}"`);
    });
  }
  return survivors;
}

test('one port family: no 85x0 or 434x port survives outside the dated proofs', () => {
  const survivors = survivorsIn(textFiles());
  assert.deepEqual(
    survivors,
    [],
    `the retired port family is still declared here (canonical: 8610/8620/8630/8640, 4440/4441):\n  ${survivors.join('\n  ')}`,
  );
});

test('one port family: an operator\'s untracked env file is neither scanned nor echoed', () => {
  // The probe sits where a real universe configuration sits, is ignored by
  // .gitignore (software/universes/*/cfg-*.env), and carries the old number
  // spelled the way a V1.13.1 operator would have kept it. The number is
  // assembled at runtime so this source line does not trip the guard itself.
  const probe = path.join(REPO, 'software/universes/univ-base/cfg-one-port-family-probe.env');
  const oldLoggerPort = String(8500 + 20);
  assert.ok(!fs.existsSync(probe), `${probe} already exists; a previous run was interrupted — remove it`);
  fs.writeFileSync(probe, `LOGGER_PORT=${oldLoggerPort}\n`);
  try {
    const files = textFiles();
    assert.ok(files.length > 0, 'the guard reads no file at all — the file list is wrong');
    assert.ok(!files.some(([f]) => f.includes('cfg-one-port-family-probe.env')), 'the operator env probe was read');
    assert.deepEqual(survivorsIn(files).filter((s) => s.includes(oldLoggerPort)), []);
  } finally {
    fs.rmSync(probe, { force: true });
  }
});

test('one port family: topology.intent.json and the univ-base manifest agree on every core port', () => {
  // A second answer can hide outside the retired family: vault was declared
  // 8443 in the topology intent while its manifest, Containerfile, quadlet and
  // server default said 8610. The lexical scan cannot see that; a cross-check
  // between the two declarations can.
  const topology = JSON.parse(fs.readFileSync(path.join(REPO, 'software/topology.intent.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'software/universes/univ-base/manifest.json'), 'utf8'));
  const disagreements = [];
  let compared = 0;
  for (const [name, node] of Object.entries(topology.nodes)) {
    const brick = node.brick && manifest.bricks[node.brick];
    if (!brick || node.port === undefined) continue;
    compared += 1;
    if (brick.port !== node.port) disagreements.push(`${name}: topology says ${node.port}, univ-base/manifest.json says ${brick.port}`);
  }
  assert.ok(compared >= 4, `only ${compared} core bricks were compared — the topology or manifest shape changed`);
  assert.deepEqual(disagreements, [], `two answers for one port:\n  ${disagreements.join('\n  ')}`);
});
