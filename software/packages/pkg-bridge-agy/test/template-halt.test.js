import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Intent: software/RULES.md#rule-7
// Intent: software/packages/pkg-bridge-agy/INTENT.md#no-default-model
//
// Non-regression (Rule 29): the universe template used to hand the agy
// container `AGY_MODEL="${AGY_MODEL:-gemini-3.7-flash-low}"` while the package
// fell back to a different version — two caches for one bridge, neither
// measured. The no-model guard now refuses a versioned name in that file, but
// a guard on names says nothing about behaviour: a future `${AGY_MODEL:-}` in
// place of the halt would pass it and start a bridge that crash-loops in its
// container. This test runs the template's own bridge-agy block and checks
// that it refuses, and speaks, when the bridge is enabled and no model was
// measured. The template forces the real bridge on (BRIDGE_AGY_STUB=0), so
// there is no simulated path to let through here.

const TEMPLATE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../universes/_template/deploy/podman-up.sh',
);

const MEASURED = 'engine/measured-at-deploy';

/** The template's `if WITH_BRIDGE_AGY` block, verbatim, run with podman faked. */
function runBlock(env) {
  const script = fs.readFileSync(TEMPLATE, 'utf8');
  const block = script.match(/^if \[\[ "\$WITH_BRIDGE_AGY" == "1" \]\]; then\n[\s\S]*?\nfi\n/m);
  assert.ok(block, 'the template must carry a bridge-agy block guarded by WITH_BRIDGE_AGY');
  const probe = `
set -euo pipefail
podman() { echo "podman $*"; }
shaper_image_ref() { echo "img:$1"; }
SLUG=probe; NET=probe-net; WORK_ROOT=/tmp/probe-work; AGY_BRIDGE_PORT=4330
${block[0]}
`;
  const r = spawnSync('bash', ['-c', probe], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, WITH_BRIDGE_AGY: '1', ...env },
  });
  return { status: r.status, output: `${r.stdout}${r.stderr}` };
}

test('bridge-agy - the template refuses to start the bridge without a model, and names the variable', () => {
  const r = runBlock({});
  assert.notEqual(r.status, 0, `the block ran to completion on a default:\n${r.output}`);
  assert.match(r.output, /AGY_MODEL/, `the halt does not name the variable to provide:\n${r.output}`);
  assert.match(r.output, /Rule 7/, `the halt does not say why:\n${r.output}`);
  assert.doesNotMatch(r.output, /podman run/, 'podman must not be reached when the halt fires');
});

test('bridge-agy - the template passes the measured model through untouched, with the real bridge forced on', () => {
  const r = runBlock({ AGY_MODEL: MEASURED });
  assert.equal(r.status, 0, r.output);
  assert.match(r.output, new RegExp(`podman run .*AGY_MODEL=${MEASURED} `), r.output);
  assert.match(r.output, /BRIDGE_AGY_STUB=0/, 'the template must force the real bridge on');
});
