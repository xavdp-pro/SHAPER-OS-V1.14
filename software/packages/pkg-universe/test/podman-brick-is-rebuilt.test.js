import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Intent: software/RULES.md#rule-11-a-brick-is-rebuilt-not-repaired
//
// Non-regression (Rule 29) for the vocabulary CORRECT/REPAIR/REBUILD/
// QUARANTINE named in doctrine/THE-KERNEL-IS-CONSULTED-NOT-CARRIED.md
// (2 September 2026): a podman brick is rebuilt on every start, never
// patched in place. The base shipped no worked example of the shape Rule 11
// already described in prose — this checks the one that was added, and the
// detector it is built from, against a broken shape that a class could
// plausibly write instead (start-if-stopped, or a live `podman exec` patch)
// before this rule existed to name why it is wrong.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');

const EXAMPLE_PATH = 'software/universes/_maker-template/recipes/podman-brick.service.example';

/**
 * A unit is rebuilt-not-repaired when every ExecStart is preceded (in the
 * same [Service] block) by an ExecStartPre that removes any container of
 * the same name, and no line execs into a running container to mutate it.
 * Returns a list of defects; empty means the unit satisfies the rule.
 */
export function rebuildDefects(unit) {
  const defects = [];
  const lines = unit.split('\n').map((l) => l.trim());

  const execStartLines = lines.filter((l) => /^ExecStart=/.test(l));
  if (execStartLines.length === 0) return ['no ExecStart line — nothing runs the brick'];

  const removesFirst = lines.some((l) => /^ExecStartPre=-?\/usr\/bin\/podman rm -f /.test(l));
  if (!removesFirst) {
    defects.push('no ExecStartPre removes the existing container — a stopped one could be `podman start`ed, patched in place, and outlive its own compromise');
  }

  for (const l of execStartLines) {
    if (!/podman run\b/.test(l)) {
      defects.push(`ExecStart does not run a fresh container from an image: "${l}"`);
    }
  }

  const mutatingExec = lines.find((l) => /^ExecStart(Pre|Post)?=.*podman exec\b/.test(l));
  if (mutatingExec) {
    defects.push(`a podman exec line reaches into a running container instead of rebuilding it: "${mutatingExec}"`);
  }

  // Scoped to actual directive lines, the same way mutatingExec is: a
  // comment explaining what NOT to do (this file has one) would otherwise
  // trip its own detector.
  const startsStoppedInstead = lines.some((l) => /^ExecStart(Pre|Post)?=.*podman start\b/.test(l));
  if (startsStoppedInstead) {
    defects.push('podman start resumes whatever container already exists instead of rebuilding — a compromised or half-upgraded container would outlive a restart');
  }

  return defects;
}

test('the reference brick unit satisfies rebuild-not-repair', () => {
  const unit = read(EXAMPLE_PATH);
  assert.deepEqual(rebuildDefects(unit), []);
});

test('the reference unit is the one Rule 11 names', () => {
  const rules = read('software/RULES.md');
  assert.ok(
    rules.includes('_maker-template/recipes/podman-brick.service.example'),
    'Rule 11 does not point at the example this test checks',
  );
});

test('the detector recognises the shape a class could plausibly get wrong', () => {
  // start-if-stopped: no rebuild, a resumed container can carry forward
  // whatever compromised it.
  const startIfStopped = [
    '[Service]',
    'ExecStartPre=-/usr/bin/podman start crm-app',
    'ExecStart=/usr/bin/podman run --rm --name crm-app --network host localhost/crm-app:1',
  ].join('\n');
  assert.notEqual(rebuildDefects(startIfStopped).length, 0);

  // live patch: a podman exec line mutates the running container instead
  // of rebuilding it from a corrected image.
  const livePatch = [
    '[Service]',
    'ExecStartPre=-/usr/bin/podman rm -f crm-app',
    'ExecStart=/usr/bin/podman run --rm --name crm-app --network host localhost/crm-app:1',
    'ExecStartPost=/usr/bin/podman exec crm-app npm install missing-dep',
  ].join('\n');
  assert.notEqual(rebuildDefects(livePatch).length, 0);

  // the actual reference shape: clean.
  const good = [
    '[Service]',
    'ExecStartPre=-/usr/bin/podman rm -f crm-app',
    'ExecStart=/usr/bin/podman run --rm --name crm-app --network host localhost/crm-app:1',
  ].join('\n');
  assert.deepEqual(rebuildDefects(good), []);
});
