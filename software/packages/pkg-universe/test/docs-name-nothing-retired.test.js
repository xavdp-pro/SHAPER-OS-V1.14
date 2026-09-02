import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Intent: AGENTS.md#documentation-is-a-map

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * A document that names something the tree no longer ships is a door that
 * opens on nothing — and for a literal agent the document IS the code
 * (RUNBOOK-EXPLICIT: commands are facts, never derivations).
 *
 * Non-regression. When `brick-helm` left for the catalogue, the
 * `test:live:helm` script and the `WITH_HELM` switch left with it
 * (V1.13.2) — and sixteen mentions stayed behind in START-HERE, PROOF,
 * KEYS-AND-ACCOUNTS, the runbook's tier-b step, both example env files, the
 * template's env file and its AGENT-DEPLOY: an agent told to run
 * `npm run test:live:helm` met an npm error, and one told to set
 * `WITH_HELM=1` set a variable nothing read. The mention was retired file by
 * file, and this guard holds the retirement: a name that left the tree is
 * listed here with why, and no document or example may name it again.
 *
 * Only prose and examples are read — `.md`, `*.example`, `env.example`.
 * Code keeps its history comments; dated records (proofs, the testing
 * report, changelogs) keep what they saw.
 */
const RETIRED = [
  { name: 'test:live:helm', why: 'the script left software/package.json with brick-helm; the cockpit\'s live tests live in the catalogue beside the brick' },
  { name: 'WITH_HELM', why: 'nothing in the tree reads it since brick-helm left the template; tier-b is the catalogue\'s +web profile' },
  // The 2 September audit: univ-factory.mjs wrote a frame the base does not
  // have and was run by nothing, so it left; the tool scaffold wrote
  // packages/<slug>-engine, a layer NAMING.md does not declare, and now
  // writes packages/pkg-<slug> and bricks/brick-<slug>. Three inventories
  // kept describing both as they were.
  { name: 'univ-factory', why: 'removed on 2 September 2026 — a universe class is born by docs/agent/UNIVERSE-REPO-BIRTH.md, a procedure, not a generator' },
  { name: '<slug>-engine', why: 'no such layer in NAMING.md — shaper-tool-scaffold.mjs writes packages/pkg-<slug> and bricks/brick-<slug>' },
];

const DATED_RECORDS = [/^docs\/proof\//, /^docs\/TESTING-REPORT\.md$/, /CHANGELOG/i, /VERDICT/];

function trackedDocs() {
  let paths;
  try {
    paths = execFileSync('git', ['-C', REPO, 'ls-files', '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\0').filter(Boolean);
  } catch {
    paths = walk(REPO);
  }
  return paths.filter((rel) => {
    const base = path.basename(rel);
    const isDoc = rel.endsWith('.md') || base.endsWith('.example');
    if (!isDoc) return false;
    if (DATED_RECORDS.some((re) => re.test(rel))) return false;
    if (/(^|\/)test(s)?\//.test(rel)) return false;
    return fs.existsSync(path.join(REPO, rel));
  });
}

function walk(dir, found = [], base = dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(absolute, found, base);
    else found.push(path.relative(base, absolute));
  }
  return found;
}

test('no document or example names a script or switch that left the tree', () => {
  const doors = [];
  for (const rel of trackedDocs()) {
    const lines = fs.readFileSync(path.join(REPO, rel), 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const { name, why } of RETIRED) {
        if (line.includes(name)) doors.push(`${rel}:${i + 1}  names \`${name}\` — ${why}`);
      }
    });
  }
  assert.deepEqual(doors, [], `doors that open on nothing:\n  ${doors.join('\n  ')}`);
});

test('the retired names are really gone from what the tree ships', () => {
  // The list above is only honest while the thing it retires is absent: a
  // script that came back would make this guard forbid the truth.
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'software/package.json'), 'utf8'));
  assert.equal(pkg.scripts['test:live:helm'], undefined, 'test:live:helm is back in software/package.json — retire it from RETIRED, or the script');
  const template = fs.readFileSync(path.join(REPO, 'software/universes/_template/deploy/podman-up.sh'), 'utf8');
  assert.doesNotMatch(template, /\bWITH_HELM\b/, 'the template reads WITH_HELM again — retire it from RETIRED, or the read');
});
