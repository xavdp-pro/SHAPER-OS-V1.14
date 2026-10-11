import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Intent: software/universes/univ-base/INTENT.md#earlier-shape
//
// Non-regression (Rule 29), wave-3 lot BASE-TEMPLATES. From the base release
// on, Vault, Logger, Queue and Maestro are unit images of the one-container
// shape (MariaDB inside, /apps/<slug>, Vault-signed identities). univ-base was
// kept on its earlier file-store images, and two of its scripts could not
// tell the difference:
//
//  * deploy/podman-up.sh removed every running container of the universe,
//    then started whatever image the lock or the tag named — with a unit
//    image, the running universe was gone and its replacements refused to
//    start.
//  * deploy/gbs-test-bootstrap-v114.sh rebuilt the bricks from the checkout
//    it ran in, replaced the registry container (whose images live in it) and
//    pushed over the tag every universe on that host had pinned.
//
// Argument recorders only: no container is run, nothing here proves a
// deployment. The fakes answer what each script asks and record the calls.

const SOFTWARE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const UNIV_BASE = path.join(SOFTWARE, 'universes/univ-base');

const FAKE_PODMAN = `#!/bin/sh
printf '%s\\n' "$*" >> "$CALLS"
case "$1 $2" in
  "image exists") case " $PRESENT " in *" $3 "*) exit 0 ;; *) exit 1 ;; esac ;;
  "image inspect")
    case "$5" in
      *unit*) echo '{"org.shaper.brick":"queue","org.shaper.unit.slug":"queue","org.shaper.unit.database":"mariadb-in-unit"}' ;;
      *) echo '{"org.shaper.brick":"earlier"}' ;;
    esac ;;
  "container exists") [ -n "$REGISTRY_EXISTS" ] && exit 0; exit 1 ;;
esac
case "$1" in
  pull) [ -n "$PULL_FAILS" ] && exit 125; exit 0 ;;
  inspect) echo true ;;
esac
exit 0
`;

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'univ-base-earlier-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'podman'), FAKE_PODMAN, { mode: 0o755 });
  for (const quiet of ['sleep', 'apt-get']) fs.writeFileSync(path.join(bin, quiet), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  // curl: every health answers; a registry manifest answers only when PUBLISHED is set.
  fs.writeFileSync(path.join(bin, 'curl'), '#!/bin/sh\ncase "$*" in *"/v2/"*) [ -n "$PUBLISHED" ] && exit 0; exit 22 ;; esac\nexit 0\n', { mode: 0o755 });
  const calls = path.join(root, 'calls.log');
  return { root, bin, calls, read: () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean) : []) };
}

function universe(t, images) {
  const box = sandbox(t);
  const univ = path.join(box.root, 'software/universes/univ-base');
  fs.mkdirSync(path.join(univ, 'deploy'), { recursive: true });
  fs.copyFileSync(path.join(UNIV_BASE, 'deploy/podman-up.sh'), path.join(univ, 'deploy/podman-up.sh'));
  fs.writeFileSync(path.join(univ, 'cfg-image-lock.json'), `${JSON.stringify({ status: 'released', images }, null, 2)}\n`);
  // An existing vault file: the bootstrap is outside this test.
  fs.mkdirSync(path.join(univ, '.state/vol-univ-base-vault'), { recursive: true });
  fs.writeFileSync(path.join(univ, '.state/vol-univ-base-vault/vault.enc'), 'fixture-not-a-vault');
  const run = (extra = {}) => {
    const r = spawnSync('bash', [path.join(univ, 'deploy/podman-up.sh')], {
      encoding: 'utf8',
      env: { PATH: `${box.bin}:${process.env.PATH}`, HOME: box.root, CALLS: box.calls, VAULT_MASTER_KEY: 'fixture-only', ...extra },
    });
    return { status: r.status, output: `${r.stdout}${r.stderr}`, calls: box.read() };
  };
  return { ...box, univ, run };
}

const EARLIER = Object.fromEntries(['vault', 'logger', 'queue', 'maestro', 'bridge-opencode']
  .map((b, i) => [`img-${b}`, `registry.example.invalid/shaper/brick-${b}@sha256:${String(i + 1).repeat(64)}`]));
const present = (images) => Object.values(images).join(' ');
const destructive = (calls) => calls.filter((c) => /^(rm |run )/.test(c));

test('univ-base starts its five bricks from earlier images, reading each one before it stops anything', (t) => {
  const u = universe(t, EARLIER);
  const r = u.run({ PRESENT: present(EARLIER) });
  assert.equal(r.status, 0, r.output);
  assert.equal(r.calls.filter((c) => c.startsWith('run -d')).length, 5, r.calls.join('\n'));
  const lastInspect = r.calls.map((c) => c.startsWith('image inspect')).lastIndexOf(true);
  const firstRm = r.calls.findIndex((c) => c.startsWith('rm '));
  assert.equal(r.calls.filter((c) => c.startsWith('image inspect')).length, 5);
  assert.ok(lastInspect >= 0 && lastInspect < firstRm, `every image is read before the first removal:\n${r.calls.join('\n')}`);
});

test('a unit image of the one-container shape is refused before any container is removed or started', (t) => {
  const images = { ...EARLIER, 'img-queue': 'registry.example.invalid/shaper/brick-queue-unit@sha256:' + 'a'.repeat(64) };
  const u = universe(t, images);
  const r = u.run({ PRESENT: present(images) });
  assert.notEqual(r.status, 0, r.output);
  assert.match(r.output, /img-queue: .* is a unit image of the one-container shape/);
  assert.match(r.output, /earlier-shape/);
  assert.match(r.output, /Nothing was stopped/);
  assert.deepEqual(destructive(r.calls), [], r.calls.join('\n'));
});

test('an image that is neither present nor pullable stops the run before any container is touched', (t) => {
  const u = universe(t, EARLIER);
  const r = u.run({ PRESENT: '', PULL_FAILS: '1' });
  assert.notEqual(r.status, 0, r.output);
  assert.match(r.output, /neither present nor pullable — nothing was stopped/);
  assert.deepEqual(destructive(r.calls), [], r.calls.join('\n'));
});

test('an absent earlier image is pulled first, then read, then run', (t) => {
  const u = universe(t, EARLIER);
  const r = u.run({ PRESENT: '' });
  assert.equal(r.status, 0, r.output);
  const pulls = r.calls.filter((c) => c.startsWith('pull -q'));
  assert.equal(pulls.length, 5, r.calls.join('\n'));
  assert.ok(r.calls.findIndex((c) => c.startsWith('pull -q')) < r.calls.findIndex((c) => c.startsWith('rm ')));
});

// ── gbs-test-bootstrap-v114.sh ─────────────────────────────────────────────

function checkout(t, { unitBricks }) {
  const box = sandbox(t);
  const software = path.join(box.root, 'checkout/software');
  fs.mkdirSync(path.join(software, 'bricks/brick-vault'), { recursive: true });
  fs.mkdirSync(path.join(software, 'universes/univ-base/deploy'), { recursive: true });
  fs.copyFileSync(path.join(UNIV_BASE, 'deploy/gbs-test-bootstrap-v114.sh'), path.join(software, 'universes/univ-base/deploy/gbs-test-bootstrap-v114.sh'));
  fs.writeFileSync(path.join(software, 'bricks/brick-vault/Containerfile'),
    unitBricks ? 'LABEL org.shaper.brick="vault"\nLABEL org.shaper.unit.slug="vault"\n' : 'LABEL org.shaper.brick="vault"\n');
  const run = (extra = {}) => {
    const r = spawnSync('bash', [path.join(software, 'universes/univ-base/deploy/gbs-test-bootstrap-v114.sh')], {
      encoding: 'utf8',
      env: { PATH: `${box.bin}:${process.env.PATH}`, HOME: box.root, CALLS: box.calls, SHAPER_CHECKOUT: path.join(box.root, 'checkout'), ...extra },
    });
    return { status: r.status, output: `${r.stdout}${r.stderr}`, calls: box.read() };
  };
  return { run };
}

test('the gbs-test bootstrap refuses a checkout whose bricks are one-container units, before it builds or pushes', (t) => {
  const r = checkout(t, { unitBricks: true }).run();
  assert.notEqual(r.status, 0, r.output);
  assert.match(r.output, /holds the one-container unit bricks/);
  assert.match(r.output, /958e0b7/);
  assert.deepEqual(r.calls.filter((c) => /^(build|push|tag|rm|run)/.test(c)), [], r.calls.join('\n'));
});

test('the gbs-test bootstrap never moves a published tag, and keeps the registry container that holds it', (t) => {
  const r = checkout(t, { unitBricks: false }).run({ PUBLISHED: '1', REGISTRY_EXISTS: '1' });
  assert.notEqual(r.status, 0, r.output);
  assert.match(r.output, /localhost:5000\/shaper\/base:v114-gbs is already published: a published tag is never moved/);
  assert.deepEqual(r.calls.filter((c) => /^(build|push|tag|rm|run)/.test(c)), [],
    `nothing is built, tagged, pushed, removed or replaced:\n${r.calls.join('\n')}`);
});

test('the gbs-test bootstrap creates a registry only where none exists, never with --replace', () => {
  const script = fs.readFileSync(path.join(UNIV_BASE, 'deploy/gbs-test-bootstrap-v114.sh'), 'utf8');
  assert.doesNotMatch(script, /podman rm -f shaper-registry/);
  assert.doesNotMatch(script, /--replace --name shaper-registry|--name shaper-registry[^\n]*--replace/);
});
