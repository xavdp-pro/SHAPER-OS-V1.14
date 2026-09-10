import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Argument-recorder unit tests: no container/service/runtime capability is simulated as proof.
const SOFTWARE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shaper-factory-contract-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const software = path.join(root, 'software'), universe = path.join(root, 'univ-example-dev'), bin = path.join(root, 'bin');
  for (const dir of [path.join(software, 'packages'), path.join(software, 'scripts'), path.join(universe, 'deploy'), path.join(universe, 'sav/vault'), bin]) fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(SOFTWARE, 'universes/_template/deploy/podman-up.sh'), path.join(universe, 'deploy/podman-up.sh'));
  fs.copyFileSync(path.join(SOFTWARE, 'scripts/deploy-image-resolve.sh'), path.join(software, 'scripts/deploy-image-resolve.sh'));
  fs.writeFileSync(path.join(universe, 'manifest.json'), '{"environment":"dev"}');
  // Bootstrap is outside this argument propagation test: an existing file bypasses it.
  fs.writeFileSync(path.join(universe, 'sav/vault/vault.enc'), 'unit-fixture-not-a-vault');
  const capture = path.join(root, 'argv.jsonl');
  fs.writeFileSync(path.join(bin, 'podman'), '#!/bin/sh\npython3 -c \'import json,os,sys;open(os.environ["ARGV_CAPTURE"],"a").write(json.dumps(sys.argv[1:])+"\\n")\' "$@"\n', { mode: 0o755 });
  for (const command of ['curl', 'sleep']) fs.writeFileSync(path.join(bin, command), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const images = Object.fromEntries(['vault', 'logger', 'queue', 'maestro', 'bridge-opencode'].map((name, i) => [`img-${name}`, `registry.example.invalid/shaper/${name}@sha256:${String(i + 1).repeat(64)}`]));
  const lock = path.join(root, 'image-lock.json'); fs.writeFileSync(lock, JSON.stringify({ images }));
  const env = { PATH: `${bin}:${process.env.PATH}`, HOME: root, ARGV_CAPTURE: capture, SHAPER_ROOT: software, VAULT_MASTER_KEY: 'unit-fixture-only', VAULT_TOKEN: 'unit-fixture-token', OPENCODE_MODEL: 'fixture-model', OPENCODE_BRIDGE_TOKEN: 'unit-fixture-bridge', SHAPER_REGISTRY: 'legacy.example.invalid', SHAPER_IMAGE_TAG: 'legacy' };
  return { root, universe, software, lock, images, env, run(extra = {}) { const result = spawnSync('bash', [path.join(universe, 'deploy/podman-up.sh')], { env: { ...env, ...extra }, encoding: 'utf8' }); return { ...result, calls: fs.existsSync(capture) ? fs.readFileSync(capture, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [] }; } };
}
const runs = result => result.calls.filter(call => call[0] === 'run' && call.includes('-d'));
const named = (result, name) => runs(result).find(call => call.includes(`univ-example-dev-${name}`));

test('explicit digest lock and dormant exports survive source defaults into actual startup arguments', t => {
  const f = setup(t);
  fs.writeFileSync(path.join(f.software, '.env'), 'QUEUE_AUTO_DISPATCH=1\nMAESTRO_AUTO_START=1\nOPENCODE_BRIDGE_BIND=0.0.0.0\nSHAPER_IMAGE_LOCK_FILE=missing-default-lock\n');
  const result = f.run({ SHAPER_IMAGE_LOCK_FILE: f.lock, QUEUE_AUTO_DISPATCH: '0', MAESTRO_AUTO_START: '0', OPENCODE_BRIDGE_BIND: '127.0.0.1' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(runs(result).length, 5);
  for (const [name, image] of Object.entries(f.images)) assert.equal(named(result, name.replace('img-', '')).at(-1), image);
  assert.ok(named(result, 'queue').includes('QUEUE_AUTO_DISPATCH=0'));
  assert.ok(named(result, 'maestro').includes('MAESTRO_AUTO_START=0'));
  assert.ok(named(result, 'bridge-opencode').includes('OPENCODE_BRIDGE_BIND=127.0.0.1'));
});

test('legacy invocation retains tags and active/network defaults', t => {
  const f = setup(t), result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(named(result, 'vault').at(-1), 'legacy.example.invalid/shaper/brick-vault:legacy');
  assert.ok(named(result, 'queue').includes('QUEUE_AUTO_DISPATCH=1'));
  assert.ok(named(result, 'maestro').includes('MAESTRO_AUTO_START=1'));
  assert.ok(named(result, 'bridge-opencode').includes('OPENCODE_BRIDGE_BIND=0.0.0.0'));
});

test('invalid explicit lock never falls back to a tag or reaches destructive container commands', t => {
  const f = setup(t);
  for (const contents of ['{', JSON.stringify({ images: {} }), JSON.stringify({ images: { ...f.images, 'img-maestro': 'registry.example.invalid/maestro:latest' } })]) {
    fs.writeFileSync(f.lock, contents);
    const result = f.run({ SHAPER_IMAGE_LOCK_FILE: f.lock });
    assert.notEqual(result.status, 0);
    assert.equal(result.calls.length, 0, JSON.stringify(result.calls));
  }
});

test('invalid flags and invalid bind fail before any container operation', t => {
  const f = setup(t);
  for (const extra of [{ QUEUE_AUTO_DISPATCH: 'false' }, { MAESTRO_AUTO_START: '2' }, { OPENCODE_BRIDGE_BIND: '127.0.0.1;bad' }]) {
    const result = f.run(extra);
    assert.notEqual(result.status, 0);
    assert.equal(result.calls.length, 0, JSON.stringify(result.calls));
  }
});


test('flat image locks work and an explicit missing file is never ignored', t => {
  const f = setup(t);
  fs.writeFileSync(f.lock, JSON.stringify(f.images));
  const result = f.run({ SHAPER_IMAGE_LOCK_FILE: f.lock });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(named(result, 'vault').at(-1), f.images['img-vault']);
  const g = setup(t);
  const missing = g.run({ SHAPER_IMAGE_LOCK_FILE: path.join(g.root, 'absent') });
  assert.notEqual(missing.status, 0);
  assert.equal(missing.calls.length, 0);
});


test('empty explicit startup values refuse rather than inherit active defaults from a file', t => {
  const f = setup(t);
  fs.writeFileSync(path.join(f.software, '.env'), `QUEUE_AUTO_DISPATCH=1\nMAESTRO_AUTO_START=1\nOPENCODE_BRIDGE_BIND=0.0.0.0\nSHAPER_IMAGE_LOCK_FILE=${f.lock}\n`);
  for (const key of ['QUEUE_AUTO_DISPATCH', 'MAESTRO_AUTO_START', 'OPENCODE_BRIDGE_BIND', 'SHAPER_IMAGE_LOCK_FILE']) {
    const result = f.run({ [key]: '' });
    assert.notEqual(result.status, 0);
    assert.equal(result.calls.length, 0);
  }
});
