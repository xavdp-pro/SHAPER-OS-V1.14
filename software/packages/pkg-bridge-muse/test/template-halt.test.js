import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TEMPLATE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../universes/_template/deploy/podman-up.sh',
);

const MEASURED = 'engine/measured-at-deploy';

function runBlock(env) {
  const script = fs.readFileSync(TEMPLATE, 'utf8');
  const block = script.match(/^if \[\[ "\$WITH_BRIDGE_MUSE" == "1" \]\]; then\n[\s\S]*?\nfi\n/m);
  assert.ok(block, 'the template must carry a bridge-muse block guarded by WITH_BRIDGE_MUSE');
  const probe = `
set -euo pipefail
podman() { echo "podman $*"; }
shaper_image_ref() { echo "img:$1"; }
SLUG=probe; NET=probe-net; WORK_ROOT=/tmp/probe-work; UNIV=/tmp/probe-univ; MUSE_BRIDGE_PORT=4320
${block[0]}
`;
  const r = spawnSync('bash', ['-c', probe], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, WITH_BRIDGE_MUSE: '1', ...env },
  });
  return { status: r.status, output: `${r.stdout}${r.stderr}` };
}

test('bridge-muse - the template refuses to start the bridge without a model, and names the variable', () => {
  const r = runBlock({});
  assert.notEqual(r.status, 0, `the block ran to completion on a default:\n${r.output}`);
  assert.match(r.output, /MUSE_MODEL/);
});

test('bridge-muse - the template starts when a model is measured', () => {
  const r = runBlock({ MUSE_MODEL: MEASURED, MUSE_HOST_BIN: '/bin/true' });
  assert.equal(r.status, 0, r.output);
  assert.match(r.output, /bridge-muse/);
});
