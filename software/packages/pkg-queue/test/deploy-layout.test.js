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

const SCRIPTS = [
  '../../../universes/_template/deploy/podman-up.sh',
];

/** Mount sources under $UNIV, in the order podman is asked for them. */
function mountedPaths(script) {
  return [...script.matchAll(/-v "\$UNIV\/([A-Za-z0-9_./-]+?):/g)].map((m) => ({
    path: m[1],
    at: m.index,
  }));
}

for (const rel of SCRIPTS) {
  test(`${rel.split('/').slice(-3).join('/')} creates every directory it mounts`, async () => {
    let script;
    try {
      script = await readFile(new URL(rel, import.meta.url), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return; // script optional in this layout
      throw error;
    }

    const mounts = mountedPaths(script);
    assert.ok(mounts.length > 0, 'expected at least one $UNIV mount to check');

    for (const { path, at } of mounts) {
      const created = script.indexOf(`"$UNIV/${path}"`);
      assert.notEqual(
        created,
        -1,
        `${path} is mounted but never created: podman would make it root-owned`,
      );
      assert.ok(
        created < at,
        `${path} is created after it is mounted; the deployment fails on a clean sheet`,
      );
    }
  });
}

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
