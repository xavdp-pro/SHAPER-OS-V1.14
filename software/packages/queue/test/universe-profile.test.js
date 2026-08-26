import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * A declared profile must match the bricks that are actually there.
 *
 * Two agents were asked for "the base universe" in the same words and built
 * different things, because the phrase had no definition. Profiles give the
 * starting points names — and a name nobody verifies is decoration. A manifest
 * that claims `passive` while running a bridge and a maestro is lying about what
 * it is, and the next agent will believe it.
 *
 * The check is one-directional on purpose: the floor must be present, and adding
 * bricks beyond it is expected. That is the work.
 *
 * docs/architecture/UNIVERSE-PROFILES.md
 */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** Floors, as brick keys. A bridge is any `bridge-*`: the engine is swappable. */
const FLOORS = {
  passive: ['logger'],
  agent: ['vault', 'logger', 'bridge-*', 'queue', 'maestro'],
};

const OPTIONS = {
  documents: ['ged'],          // qdrant and rag travel with it, not always as containers
  data: ['mariadb'],
  web: ['helm'],
  public: ['tunnel'],
  clock: ['maestro'],
  parent: [],                  // supervisor is in-process, nothing to assert here
  intake: [],                  // mail-agent is in-process
};

function manifests() {
  const out = execFileSync('git', ['-C', REPO, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return out.split('\0').filter(Boolean)
    .filter((rel) => /(^|\/)manifest[^/]*\.json$/.test(rel) && !rel.includes('node_modules'))
    .map((rel) => [rel, path.join(REPO, rel)])
    .filter(([, abs]) => fs.existsSync(abs));
}

function has(bricks, key) {
  return key.endsWith('*')
    ? bricks.some((b) => b.startsWith(key.slice(0, -1)))
    : bricks.includes(key);
}

test('every declared profile is backed by the bricks it names', () => {
  const problems = [];
  let checked = 0;

  for (const [rel, abs] of manifests()) {
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { continue; }
    const profile = manifest.profile;
    if (!profile) continue;                       // declaring one is not mandatory yet
    checked += 1;

    const bricks = Object.keys(manifest.bricks || {});
    const [floor, ...options] = String(profile).split('+').map((s) => s.trim()).filter(Boolean);

    if (!FLOORS[floor]) {
      problems.push(`${rel}: unknown floor "${floor}" — expected passive or agent`);
      continue;
    }

    for (const required of FLOORS[floor]) {
      if (!has(bricks, required)) {
        problems.push(`${rel}: profile "${profile}" requires ${required}, which is not in bricks`);
      }
    }
    for (const option of options) {
      if (!(option in OPTIONS)) {
        problems.push(`${rel}: unknown option "+${option}"`);
        continue;
      }
      for (const required of OPTIONS[option]) {
        if (!has(bricks, required)) {
          problems.push(`${rel}: option "+${option}" requires ${required}, which is not in bricks`);
        }
      }
    }
  }

  assert.ok(checked > 0, 'expected at least one manifest to declare a profile');
  assert.deepEqual(
    problems,
    [],
    `A manifest declares a profile it does not carry:\n  ${problems.join('\n  ')}\n`,
  );
});
