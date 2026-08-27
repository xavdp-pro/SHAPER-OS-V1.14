import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {

// Intent: software/packages/pkg-universe/INTENT.md
// Intent: software/universes/univ-base/INTENT.md#image-lock
  catalogueBricks, checkManifestInvariants, loadManifest, loadSchema, validateManifest,
} from '../index.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** Every universe manifest this repository ships, wherever it sits. */
function everyManifest(dir = REPO, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) everyManifest(absolute, found);
    else if (entry.name === 'manifest.json' || /^manifest\..+\.json$/.test(entry.name)) found.push(absolute);
  }
  return found;
}

// The defect this test exists to prevent, stated plainly: until V1.11 the schema
// required `ref` and `intent` on every brick, `univ-base` declared neither, and
// `univ-base` named that same schema in its own `$schema` field. Nothing read the
// schema, so nothing noticed. An agent told that `univ-base` was the reference
// produced manifests the contract rejected — and was never told.
test('every manifest in the repository satisfies the contract it claims', () => {
  const manifests = everyManifest();
  assert.ok(manifests.length >= 3, 'expected the template, the base cell and the tier-a install manifest');

  const failures = [];
  for (const absolute of manifests) {
    const { valid, errors } = loadManifest(absolute);
    if (!valid) failures.push(`${path.relative(REPO, absolute)}\n    ${errors.join('\n    ')}`);
  }
  assert.deepEqual(failures, [], `manifests that do not satisfy the contract:\n  ${failures.join('\n  ')}`);
});

test('the base ships no universe that needs a catalogue brick', () => {
  const borrowed = [];
  for (const absolute of everyManifest()) {
    const { manifest } = loadManifest(absolute);
    const fromCatalogue = catalogueBricks(manifest || {});
    if (fromCatalogue.length) borrowed.push(`${path.relative(REPO, absolute)} → ${fromCatalogue.join(', ')}`);
  }
  assert.deepEqual(borrowed, [], `the base repository must not ship a universe that cannot start without the catalogue:\n  ${borrowed.join('\n  ')}`);
});

test('the contract rejects a bare brick name, a mismatched image and a partial boot order', () => {
  const schema = loadSchema();
  const sound = loadManifest(path.join(REPO, 'software/universes/univ-base/manifest.json')).manifest;

  const bareKey = structuredClone(sound);
  bareKey.bricks.vault = bareKey.bricks['brick-vault'];
  delete bareKey.bricks['brick-vault'];
  bareKey.bootOrder[0][0] = 'vault';
  assert.equal(validateManifest(bareKey, schema).valid, false, 'a bare brick name must not pass');

  const wrongImage = structuredClone(sound);
  wrongImage.bricks['brick-vault'].image = 'img-logger';
  assert.match(
    checkManifestInvariants(wrongImage).join('\n'),
    /bricks\.brick-vault\.image/,
    'an image that belongs to another brick must be named in the error',
  );

  const forgotten = structuredClone(sound);
  forgotten.bootOrder = forgotten.bootOrder.slice(0, 1);
  assert.match(checkManifestInvariants(forgotten).join('\n'), /declared but never booted/);

  const twice = structuredClone(sound);
  twice.bootOrder.push(['brick-vault']);
  assert.match(checkManifestInvariants(twice).join('\n'), /booted twice/);

  const invented = structuredClone(sound);
  invented.somethingElse = true;
  assert.equal(validateManifest(invented, schema).valid, false, 'an undeclared top-level key must not pass');
});

test('an error names the path that is wrong, because an agent has no other clue', () => {
  const { errors } = validateManifest({
    universe: 'base',
    environment: 'staging',
    profile: 'agent',
    intent: './INTENT.md',
    bricks: { 'brick-vault': { source: 'base', package: '@shaper/pkg-vault', image: 'img-vault', intent: './x', role: 'r' } },
    bootOrder: [['brick-vault']],
  });
  assert.match(errors.join('\n'), /universe: "base" does not match/);
  assert.match(errors.join('\n'), /environment: "staging" is not one of/);
});

// A universe's image lock is the list of artefacts it will actually run. When a
// brick leaves the manifest, its entry must leave the lock with it — otherwise
// the lock can never be completed and the release status is stuck at
// "release-required" forever. `img-agent-runtime` survived V1.11's removal of
// brick-agent-runtime, and only a real release attempt on gbs-test found it.
test('an image lock names exactly the images its manifest declares', () => {
  const problems = [];

  for (const absolute of everyManifest()) {
    const { manifest } = loadManifest(absolute);
    if (!manifest?.imageLock) continue;

    const lockPath = path.resolve(path.dirname(absolute), manifest.imageLock);
    assert.ok(fs.existsSync(lockPath), `${path.relative(REPO, absolute)} declares an imageLock that does not exist`);

    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    const locked = Object.keys(lock.images || {}).sort();
    const declared = Object.values(manifest.bricks).map((brick) => brick.image).sort();

    if (JSON.stringify(locked) !== JSON.stringify(declared)) {
      problems.push(`${path.relative(REPO, lockPath)}: locks [${locked}] but the manifest declares [${declared}]`);
    }
  }

  assert.deepEqual(problems, [], `image locks out of step with their manifest:\n  ${problems.join('\n  ')}`);
});
