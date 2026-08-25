import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const universe = path.resolve(here, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(universe, 'manifest.json'), 'utf8'));
const deploy = fs.readFileSync(path.join(universe, 'deploy/podman-up.sh'), 'utf8');

test('manifest declares the exact TEST Tier-A graph', () => {
  assert.equal(manifest.environment, 'test');
  assert.deepEqual(Object.keys(manifest.bricks).sort(), [
    'bridge-opencode', 'logger', 'maestro', 'queue', 'vault',
  ]);
  assert.equal(manifest.resources.lxc.publicExposure, false);
  assert.equal(manifest.resources.lxc.nesting, true);
});

test('every manifest reference and intent resolves inside the repository', () => {
  for (const [name, brick] of Object.entries(manifest.bricks)) {
    assert.ok(fs.existsSync(path.resolve(universe, brick.ref)), `${name} ref missing`);
    assert.ok(fs.existsSync(path.resolve(universe, brick.intent)), `${name} intent missing`);
  }
});

test('deployment requires immutable SHAPER tags and creates every bind source', () => {
  assert.match(deploy, /SHAPER_IMAGE_TAG:\?/);
  assert.match(deploy, /sav\/queue/);
  assert.match(deploy, /BRIDGE_OPENCODE_STUB/);
  assert.doesNotMatch(deploy, /localhost\/shaper-[a-z-]+:latest/);
});
