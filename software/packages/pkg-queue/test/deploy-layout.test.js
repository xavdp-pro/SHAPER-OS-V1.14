import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Intent: software/universes/README.md#materialise-before-mount

/**
 * Every directory a deploy script mounts must exist before the mount.
 *
 * This started as one case: a clean-sheet deployment stopped because `sav/queue`
 * was mounted without being created. The specific case is worth a test; the
 * class is worth more. Podman creates a missing mount source as a root-owned
 * directory, so the failure is not always loud — it can surface later as a
 * permission error inside a container, far from its cause.
 *
 * It also caught something the doctrine did not: the identical defect had been
 * found and fixed during the v1.7 clean-sheet test, but the fix was written into
 * that universe's own deploy script. Universes are destroyed; the generic path is
 * what survives. A correction that stays in an instance is not a correction.
 */

const UNIVERSES = new URL('../../../universes/', import.meta.url);

/**
 * Since the base release (wave 3) the template mounts nothing itself: its
 * base units are started by univ-minimal's own podman-up.sh, installed in the
 * universe's base/. The class of defect is guarded where the mounts now are.
 */
const SCRIPTS = [
  '../../../universes/_template/deploy/podman-up.sh',
];

test('the template binds nothing itself: its units are mounted by the base', async () => {
  for (const name of ['podman-up.sh', 'proof.sh', 'install-base.sh', 'lib.sh']) {
    const script = await readFile(new URL(`_template/deploy/${name}`, UNIVERSES), 'utf8');
    assert.doesNotMatch(script, /podman (run|create)|--volume|--mount/, `_template/deploy/${name} starts or mounts something`);
  }
});

test('univ-minimal creates every volume a unit declares before any unit starts', async () => {
  const script = await readFile(new URL('univ-minimal/deploy/podman-up.sh', UNIVERSES), 'utf8');
  const manifest = JSON.parse(await readFile(new URL('univ-minimal/manifest.json', UNIVERSES), 'utf8'));
  const prepare = script.match(/^prepare_volumes\(\) \{[\s\S]*?^\}$/m);
  assert.ok(prepare, 'univ-minimal prepares each unit\'s volumes in one function');
  for (const unit of Object.values(manifest.bricks)) {
    for (const volume of unit.database.volumes) {
      assert.ok(prepare[0].includes(`$APPS_ROOT/$slug/${volume}"`), `${unit.database.slug}: ${volume} is mounted but never created`);
    }
  }
  assert.ok(prepare[0].includes('"$APPS_ROOT/$slug/etc/identity"'), 'etc/identity is created before it is mounted');
  // Every unit is prepared in the image pass, which ends before the first unit starts.
  const prepared = script.indexOf('prepare_volumes "$slug"');
  const started = script.indexOf('      start_unit "$slug"');
  assert.ok(prepared > 0 && started > prepared, 'volumes are prepared before any unit starts');
  assert.match(script, /add -v "\$APPS_ROOT\/\$slug\/\$v:\/apps\/\$slug\/\$v:Z"/, 'a unit mounts exactly its declared volumes');
});

/**
 * The universe declares its posture; the image must not decide it.
 *
 * brick-helm bakes NODE_ENV=production into its image, which is correct as a
 * build optimisation and says nothing about whether a deployment is a laptop or
 * a business. A DEV universe therefore inherited "production" and halted on an
 * operator password it had no reason to need — found on a clean-sheet deployment
 * by an external tester, not here.
 *
 * These fail on the unpatched scripts, which passed neither the posture nor the
 * password.
 */
for (const rel of SCRIPTS) {
  test(`${rel.split('/').slice(-3).join('/')} takes its posture from the universe`, async () => {
    let script;
    try {
      script = await readFile(new URL(rel, import.meta.url), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    if (!script.includes('shaper-helm')) return; // no cockpit in this tier

    assert.match(
      script,
      /"environment"/,
      'the runtime posture must be read from the universe manifest',
    );
    assert.match(
      script,
      /-e SHAPER_RUNTIME_MODE="\$SHAPER_RUNTIME_MODE"/,
      'the posture must reach the cockpit container',
    );
    assert.match(
      script,
      /APP_PASSWORD:\?/,
      'a production universe must be refused before start when it supplies no operator password',
    );
    // A default password in a shipped script is a published password.
    assert.doesNotMatch(
      script,
      /APP_PASSWORD="\$\{APP_PASSWORD:-[^}]+\}"/,
      'no fallback password may be committed',
    );
  });
}
