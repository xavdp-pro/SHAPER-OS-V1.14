import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const SOFTWARE = path.join(REPO, 'software');
const dirs = (relative) => fs.readdirSync(path.join(SOFTWARE, relative), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

test('V1.10 names every base artefact by its layer', () => {
  assert.ok(dirs('packages').every((name) => name.startsWith('pkg-')));
  assert.ok(dirs('bricks').every((name) => name.startsWith('brick-')));

  for (const directory of dirs('packages')) {
    const manifest = JSON.parse(fs.readFileSync(path.join(SOFTWARE, 'packages', directory, 'package.json'), 'utf8'));
    assert.equal(manifest.name, `@shaper/${directory}`);
  }

  const universe = JSON.parse(fs.readFileSync(path.join(SOFTWARE, 'universes/univ-base/manifest.json'), 'utf8'));
  assert.equal(universe.universe, 'univ-base');
  assert.equal(universe.profile, 'agent');
  assert.deepEqual(Object.keys(universe.bricks).sort(), [
    'agent-runtime', 'bridge-opencode', 'logger', 'maestro', 'queue', 'vault',
  ]);
  for (const brick of Object.values(universe.bricks)) {
    assert.ok(brick.brick.startsWith('brick-'));
    assert.ok(brick.package.startsWith('@shaper/pkg-'));
    assert.ok(brick.image.startsWith('img-'));
  }
});

test('the generic agent runtime contains no mail-product behaviour', () => {
  const source = [
    fs.readFileSync(path.join(SOFTWARE, 'packages/pkg-agent-runtime/index.js'), 'utf8'),
    fs.readFileSync(path.join(SOFTWARE, 'packages/pkg-maestro/index.js'), 'utf8'),
  ].join('\n');
  for (const forbidden of ['imap', 'smtp', 'mailbox', 'mailHandler']) {
    assert.doesNotMatch(source, new RegExp(forbidden, 'i'));
  }
});
