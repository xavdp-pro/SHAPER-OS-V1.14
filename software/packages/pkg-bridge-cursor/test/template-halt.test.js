import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Intent: software/RULES.md#rule-7
// Intent: software/packages/pkg-bridge-cursor/INTENT.md#no-default-model
//
// Non-regression (Rule 29): the universe template used to hand the cursor
// container `CURSOR_MODEL="${CURSOR_MODEL:-composer-2.5}"` — a pinned version
// the bridge did not even read. The no-model guard now refuses a versioned
// name in that file, but a guard on names says nothing about behaviour: a
// future `${CURSOR_MODEL:-}` in place of the halt would pass it and start a
// bridge that crash-loops in its container. This test runs the template's
// own bridge-cursor block and checks that it refuses, and speaks, when the
// bridge is enabled and no model was measured — and that the simulated
// bridge, which spawns no CLI, is let through.

const TEMPLATE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../universes/_template/deploy/podman-up.sh',
);

const MEASURED = 'engine/measured-at-deploy';

/** The template's `if WITH_BRIDGE_CURSOR` block, verbatim, run with podman faked. */
function runBlock(env) {
  const script = fs.readFileSync(TEMPLATE, 'utf8');
  const block = script.match(/^if \[\[ "\$WITH_BRIDGE_CURSOR" == "1" \]\]; then\n[\s\S]*?\nfi\n/m);
  assert.ok(block, 'the template must carry a bridge-cursor block guarded by WITH_BRIDGE_CURSOR');
  const probe = `
set -euo pipefail
podman() { echo "podman $*"; }
shaper_image_ref() { echo "img:$1"; }
SLUG=probe; NET=probe-net; WORK_ROOT=/tmp/probe-work; CURSOR_BRIDGE_PORT=4510
${block[0]}
`;
  const r = spawnSync('bash', ['-c', probe], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, WITH_BRIDGE_CURSOR: '1', ...env },
  });
  return { status: r.status, output: `${r.stdout}${r.stderr}` };
}

test('bridge-cursor - the template refuses to start the bridge without a model, and names the variable', () => {
  const r = runBlock({ BRIDGE_CURSOR_STUB: '0' });
  assert.notEqual(r.status, 0, `the block ran to completion on a default:\n${r.output}`);
  assert.match(r.output, /CURSOR_MODEL/, `the halt does not name the variable to provide:\n${r.output}`);
  assert.match(r.output, /Rule 7/, `the halt does not say why:\n${r.output}`);
  assert.doesNotMatch(r.output, /podman run/, 'podman must not be reached when the halt fires');
});

test('bridge-cursor - the template lets the simulated bridge through without a model', () => {
  const r = runBlock({ BRIDGE_CURSOR_STUB: '1' });
  assert.equal(r.status, 0, r.output);
  assert.match(r.output, /podman run .*CURSOR_MODEL= /, `the container did not receive an empty model:\n${r.output}`);
});

test('bridge-cursor - the template passes the measured model through untouched', () => {
  const r = runBlock({ BRIDGE_CURSOR_STUB: '0', CURSOR_MODEL: MEASURED });
  assert.equal(r.status, 0, r.output);
  assert.match(r.output, new RegExp(`podman run .*CURSOR_MODEL=${MEASURED} `), r.output);
});
