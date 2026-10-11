import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Intent: software/universes/README.md#explicit-startup-posture
//
// The earlier template carried the dormant-factory switches
// (SHAPER_IMAGE_LOCK_FILE, QUEUE_AUTO_DISPATCH, MAESTRO_AUTO_START,
// OPENCODE_BRIDGE_BIND, *_HOST) and this file recorded their arguments
// (docs/proof/proof-dormant-factory-source-2026-09-10.md). Since the base
// release (wave 3) the template starts its units through univ-minimal's own
// podman-up.sh, where the same posture is no longer a switch but the only
// behaviour. The guard follows the code: an image comes from the lock or an
// explicit published tag and nothing else; Queue never dispatches; Maestro
// submits only the declared schedule; every unit binds loopback.
//
// Argument-level checks only: no container is run.

const SOFTWARE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MINIMAL = path.join(SOFTWARE, 'universes/univ-minimal');
const SCRIPT = fs.readFileSync(path.join(MINIMAL, 'deploy/podman-up.sh'), 'utf8');
const JQ_SHIM = path.join(MINIMAL, 'test/rehearsal/jq-shim');
const hasJq = spawnSync('sh', ['-c', 'command -v jq']).status === 0;

/** univ-minimal's resolve_image, verbatim, against a lock and an environment. */
function resolve(t, lock, env = {}) {
  const fn = SCRIPT.match(/^resolve_image\(\) \{[\s\S]*?^\}$/m);
  assert.ok(fn, 'univ-minimal resolves each image in one function');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'posture-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'cfg-image-lock.json');
  fs.writeFileSync(file, typeof lock === 'string' ? lock : JSON.stringify(lock));
  const r = spawnSync('bash', ['-c', `set -euo pipefail\nLOCK='${file}'\n${fn[0]}\nresolve_image img-vault`], {
    encoding: 'utf8',
    env: { PATH: hasJq ? process.env.PATH : `${JQ_SHIM}:${process.env.PATH}`, ...env },
  });
  return { status: r.status, out: r.stdout.trim(), err: r.stderr };
}

const DIGEST = `registry.example.invalid/shaper/brick-vault@sha256:${'1'.repeat(64)}`;

test('a pinned digest wins over a published tag', (t) => {
  const r = resolve(t, { images: { 'img-vault': DIGEST } }, { SHAPER_REGISTRY: 'r.example.invalid', SHAPER_IMAGE_TAG: 'dev' });
  assert.equal(r.status, 0, r.err);
  assert.equal(r.out, DIGEST);
});

test('an unpinned image takes an explicit published tag, and nothing else', (t) => {
  const tagged = resolve(t, { images: { 'img-vault': null } }, { SHAPER_REGISTRY: 'r.example.invalid', SHAPER_IMAGE_TAG: 'v1' });
  assert.equal(tagged.out, 'r.example.invalid/shaper/brick-vault:v1');
  for (const env of [{}, { SHAPER_REGISTRY: 'r.example.invalid' }, { SHAPER_IMAGE_TAG: 'v1' }]) {
    const r = resolve(t, { images: { 'img-vault': null } }, env);
    assert.notEqual(r.status, 0, `no guess for ${JSON.stringify(env)}: ${r.out}`);
    assert.match(r.err, /not pinned in cfg-image-lock\.json and no SHAPER_REGISTRY\/SHAPER_IMAGE_TAG is set/);
    assert.equal(r.out, '');
  }
});

test('every image is checked against the manifest\'s unit before any unit is started', () => {
  const check = SCRIPT.indexOf('|| halt "$image declares unit $label');
  assert.ok(check > 0, 'the unit labels are compared with the manifest');
  assert.ok(check < SCRIPT.indexOf('podman run -d'), 'before any unit starts');
});

test('Queue never dispatches, Maestro holds only the declared schedule, every unit binds loopback', () => {
  const fixed = SCRIPT.match(/^FIXED_ARGS=\(([\s\S]*?)\)$/m);
  assert.ok(fixed && /-e HOST=127\.0\.0\.1/.test(fixed[1]), 'every unit receives HOST=127.0.0.1');
  assert.match(SCRIPT, /^ {6}add -e "QUEUE_PORT=\$port" -e "LOGGER_URL=\$LOGGER_URL" -e QUEUE_AUTO_DISPATCH=0$/m);
  assert.match(SCRIPT, /-v "\$UNIV\/task-schedule\.json:\/apps\/maestro\/etc\/task-schedule\.json:ro,Z"/);
  assert.doesNotMatch(SCRIPT, /QUEUE_AUTO_DISPATCH=1|QUEUE_AUTO_DISPATCH:-|_HOST=0\.0\.0\.0|BRIDGE/);
  const template = fs.readFileSync(path.join(SOFTWARE, 'universes/_template/deploy/podman-up.sh'), 'utf8');
  assert.doesNotMatch(template, /QUEUE_AUTO_DISPATCH|MAESTRO_AUTO_START|_HOST=|SHAPER_IMAGE_LOCK_FILE/, 'the template adds no switch of its own');
});
