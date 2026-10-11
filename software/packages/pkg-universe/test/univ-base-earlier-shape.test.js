import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Intent: software/universes/univ-base/INTENT.md#earlier-shape
//
// Non-regression (Rule 29), wave-3 lot BASE-TEMPLATES. From 96a1319 on, the
// base bricks stopped being the file-store images univ-base runs: first the
// interim MariaDB-store images (no unit label, but *_STORE=mariadb,
// SHAPER_UNIT_SLUG, an application USER, the db package), then the
// one-container units (org.shaper.unit.* labels). Two of univ-base's scripts
// could not tell the difference:
//
//  * deploy/podman-up.sh removed every running container of the universe,
//    then started whatever image the lock or the tag named — with a later
//    image, the running universe was gone and its replacements refused to
//    start. It now requires the earlier shape positively, before it touches
//    anything; a fresh-context review showed that refusing the unit labels
//    alone let the interim images through.
//  * deploy/gbs-test-bootstrap-v114.sh rebuilt the bricks from the checkout
//    it ran in, replaced the registry container (whose images live in it),
//    pushed over the tag every universe on that host had pinned, and read
//    any curl failure as "not published". It now builds only from an earlier
//    checkout, keeps the registry, publishes only on a 404, and deploys with
//    this tree's podman-up.sh over the checkout's universe directory.
//
// Argument recorders only: no container is run, nothing here proves a
// deployment. The fakes answer what each script asks and record the calls.

const SOFTWARE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const REPO = path.resolve(SOFTWARE, '..');
const UNIV_BASE = path.join(SOFTWARE, 'universes/univ-base');

// podman: `image inspect <ref>` answers an image of the shape its reference names.
const FAKE_PODMAN = `#!/usr/bin/env python3
import json, os, re, sys
a = sys.argv[1:]
open(os.environ["CALLS"], "a").write(" ".join(a) + "\\n")
if a[:2] == ["image", "exists"]:
    sys.exit(0 if a[2] in os.environ.get("PRESENT", "").split() else 1)
if a[:2] == ["image", "inspect"]:
    ref = a[-1]
    brick = re.search(r"brick-([a-z-]+?)(-unit|-interim|-other)?@", ref).group(1)
    labels = {"org.shaper.brick": brick, "org.shaper.build-packages": "logger " + brick}
    env = ["NODE_ENV=production"] + (["VAULT_STORAGE_FILE=/data/vault/vault.enc"] if brick == "vault" else [])
    user = ""
    if "-unit@" in ref:
        labels.update({"org.shaper.unit.slug": brick, "org.shaper.unit.database": "mariadb-in-unit"})
    if "-interim@" in ref:
        labels["org.shaper.build-packages"] = "db logger " + brick
        env += [brick.upper() + "_STORE=mariadb", "SHAPER_UNIT_SLUG=" + brick]
        user = brick
    if "-other@" in ref:
        labels = {}
    print(json.dumps([{"Labels": labels, "Config": {"Env": env, "User": user, "Labels": labels}}]))
    sys.exit(0)
if a[:2] == ["container", "exists"]:
    sys.exit(0 if os.environ.get("REGISTRY_EXISTS") else 1)
if a[:1] == ["pull"]:
    sys.exit(125 if os.environ.get("PULL_FAILS") else 0)
if a[:1] == ["inspect"]:
    print("true")
sys.exit(0)
`;

// curl: every health answers; with -w '%{http_code}' it prints V2_CODE for
// /v2/ and MANIFEST_CODE for a manifest; CURL_EXIT makes it fail as curl does.
const FAKE_CURL = `#!/bin/sh
url=""; code=0
for a in "$@"; do case "$a" in http*) url="$a" ;; esac; done
case "$*" in *http_code*) code=1 ;; esac
if [ -n "$CURL_EXIT" ]; then [ $code = 1 ] && printf 000; exit "$CURL_EXIT"; fi
if [ $code = 1 ]; then
  case "$url" in */v2/) printf '%s' "\${V2_CODE:-200}" ;; *) printf '%s' "\${MANIFEST_CODE:-404}" ;; esac
fi
exit 0
`;

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'univ-base-earlier-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'podman'), FAKE_PODMAN, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'curl'), FAKE_CURL, { mode: 0o755 });
  for (const quiet of ['sleep', 'apt-get']) fs.writeFileSync(path.join(bin, quiet), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
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
  const run = (extra = {}, script = path.join(univ, 'deploy/podman-up.sh')) => {
    const r = spawnSync('bash', [script], {
      encoding: 'utf8',
      env: { PATH: `${box.bin}:${process.env.PATH}`, HOME: box.root, CALLS: box.calls, VAULT_MASTER_KEY: 'fixture-only', ...extra },
    });
    return { status: r.status, output: `${r.stdout}${r.stderr}`, calls: box.read() };
  };
  return { ...box, univ, run };
}

const ref = (brick, i, variant = '') => `registry.example.invalid/shaper/brick-${brick}${variant}@sha256:${String(i + 1).repeat(64)}`;
const BRICKS = ['vault', 'logger', 'queue', 'maestro', 'bridge-opencode'];
const EARLIER = Object.fromEntries(BRICKS.map((b, i) => [`img-${b}`, ref(b, i)]));
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

for (const [variant, brick, pattern] of [
  ['-unit', 'queue', /img-queue: .* is a unit image of the one-container shape/],
  ['-interim', 'vault', /img-vault: .* is an interim MariaDB-store image \(VAULT_STORE, SHAPER_UNIT_SLUG, the db package, USER vault\)/],
  ['-interim', 'logger', /img-logger: .* is an interim MariaDB-store image/],
  ['-other', 'maestro', /img-maestro: .* is not the earlier maestro brick/],
]) {
  test(`the ${variant.slice(1)} image of ${brick} is refused before any container is removed or started`, (t) => {
    const i = BRICKS.indexOf(brick);
    const images = { ...EARLIER, [`img-${brick}`]: ref(brick, i, variant) };
    const u = universe(t, images);
    const r = u.run({ PRESENT: present(images) });
    assert.notEqual(r.status, 0, r.output);
    assert.match(r.output, pattern);
    assert.match(r.output, /earlier-shape/);
    assert.match(r.output, /Nothing was stopped/);
    assert.deepEqual(destructive(r.calls), [], r.calls.join('\n'));
  });
}

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
  assert.equal(r.calls.filter((c) => c.startsWith('pull -q')).length, 5, r.calls.join('\n'));
  assert.ok(r.calls.findIndex((c) => c.startsWith('pull -q')) < r.calls.findIndex((c) => c.startsWith('rm ')));
});

test('SHAPER_UNIVERSE_DIR runs this script over another checkout\'s univ-base directory and its lock', (t) => {
  const u = universe(t, EARLIER);
  // This tree's script, the checkout's directory: the lock read is the checkout's.
  const r = u.run({ PRESENT: present(EARLIER), SHAPER_UNIVERSE_DIR: u.univ }, path.join(UNIV_BASE, 'deploy/podman-up.sh'));
  assert.equal(r.status, 0, r.output);
  assert.ok(r.calls.some((c) => c.startsWith('run -d') && c.endsWith(EARLIER['img-vault'])), r.calls.join('\n'));
  assert.ok(fs.existsSync(path.join(u.univ, '.state/vol-univ-base-bridge/token')), 'the volumes are the checkout universe\'s');
});

// ── gbs-test-bootstrap-v114.sh ─────────────────────────────────────────────

const SCRIPT = path.join(UNIV_BASE, 'deploy/gbs-test-bootstrap-v114.sh');
const EARLIER_CF = (b) => `LABEL org.shaper.brick="${b}"\nENV NODE_ENV=production\n`;

/** A checkout without git history: its bricks decide. */
function checkout(t, containerfile = EARLIER_CF) {
  const box = sandbox(t);
  const root = path.join(box.root, 'checkout');
  for (const b of ['vault', 'logger', 'queue', 'maestro']) {
    fs.mkdirSync(path.join(root, 'software/bricks', `brick-${b}`), { recursive: true });
    fs.writeFileSync(path.join(root, 'software/bricks', `brick-${b}`, 'Containerfile'), containerfile(b));
  }
  fs.mkdirSync(path.join(root, 'software/universes/univ-base/deploy'), { recursive: true });
  const run = (extra = {}, script = SCRIPT) => {
    const r = spawnSync('bash', [script], {
      encoding: 'utf8',
      env: { PATH: `${box.bin}:${process.env.PATH}`, HOME: box.root, CALLS: box.calls, SHAPER_CHECKOUT: root, REGISTRY_WAIT_SECONDS: '2', ...extra },
    });
    return { status: r.status, output: `${r.stdout}${r.stderr}`, calls: box.read() };
  };
  return { root, box, run };
}
const published = (calls) => calls.filter((c) => /^(build|push|tag|rm|run)/.test(c));

for (const [shape, cf] of [
  ['one-container unit', (b) => `${EARLIER_CF(b)}LABEL org.shaper.unit.slug="${b}"\n`],
  ['interim MariaDB-store', (b) => `${EARLIER_CF(b)}ENV ${b.toUpperCase()}_STORE=mariadb\nUSER ${b}\n`],
]) {
  test(`the bootstrap refuses a checkout of ${shape} bricks, before apt, registry, build or push`, (t) => {
    const r = checkout(t, cf).run();
    assert.notEqual(r.status, 0, r.output);
    assert.match(r.output, /is not an earlier checkout \(at or before 958e0b7\)/);
    assert.match(r.output, /Run this script — .*\/univ-base\/deploy\/gbs-test-bootstrap-v114\.sh, not the copy inside the checkout — with SHAPER_CHECKOUT=/);
    assert.deepEqual(r.calls, [], 'podman is never reached');
  });
}

test('with git history, the checkout must be at or before 958e0b7', (t) => {
  const box = sandbox(t);
  const r = spawnSync('bash', [SCRIPT], { encoding: 'utf8', env: { PATH: `${box.bin}:${process.env.PATH}`, CALLS: box.calls, SHAPER_CHECKOUT: REPO } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /is not an earlier checkout/);
  // A clone whose HEAD is 958e0b7 passes the check (and stops later, at the registry, here).
  const clone = path.join(box.root, 'clone');
  spawnSync('git', ['clone', '--quiet', '--shared', '--no-checkout', REPO, clone]);
  spawnSync('git', ['-C', clone, 'reset', '--quiet', '--soft', '958e0b7']);
  fs.mkdirSync(path.join(clone, 'software'), { recursive: true });
  const ok = spawnSync('bash', [SCRIPT], { encoding: 'utf8', env: { PATH: `${box.bin}:${process.env.PATH}`, CALLS: box.calls, SHAPER_CHECKOUT: clone, MANIFEST_CODE: '200', REGISTRY_EXISTS: '1' } });
  assert.doesNotMatch(ok.stderr, /is not an earlier checkout/, ok.stderr);
  assert.match(ok.stderr, /already published/);
});

test('the checkout\'s own copy of the script is refused', (t) => {
  const c = checkout(t);
  const own = path.join(c.root, 'software/universes/univ-base/deploy/gbs-test-bootstrap-v114.sh');
  fs.copyFileSync(SCRIPT, own);
  const r = c.run({}, own);
  assert.notEqual(r.status, 0);
  assert.match(r.output, /this is the checkout's own copy of the script/);
  assert.deepEqual(r.calls, []);
});

test('the bootstrap never moves a published tag, and keeps the registry container that holds it', (t) => {
  const r = checkout(t).run({ MANIFEST_CODE: '200', REGISTRY_EXISTS: '1' });
  assert.notEqual(r.status, 0, r.output);
  assert.match(r.output, /localhost:5000\/shaper\/base:v114-gbs is already published: a published tag is never moved/);
  assert.deepEqual(published(r.calls), [], `nothing is built, tagged, pushed, removed or replaced:\n${r.calls.join('\n')}`);
});

test('a registry that cannot be reached is a halt, never "not published"', (t) => {
  const r = checkout(t).run({ CURL_EXIT: '7', REGISTRY_EXISTS: '1' });
  assert.notEqual(r.status, 0, r.output);
  assert.match(r.output, /does not answer \/v2\/ with 200: whether a tag is published cannot be told/);
  assert.deepEqual(published(r.calls), [], r.calls.join('\n'));
});

test('an answer other than 200 or 404 for a tag is a halt', (t) => {
  for (const code of ['500', '401', '000']) {
    const r = checkout(t).run({ MANIFEST_CODE: code, REGISTRY_EXISTS: '1' });
    assert.notEqual(r.status, 0, r.output);
    assert.match(r.output, new RegExp(`answered HTTP ${code} for shaper/base:v114-gbs: whether it is published cannot be told`));
    assert.deepEqual(published(r.calls), [], r.calls.join('\n'));
  }
});

test('the bootstrap creates a registry only where none exists, never with --replace, and deploys with this tree\'s podman-up', () => {
  const script = fs.readFileSync(SCRIPT, 'utf8');
  assert.doesNotMatch(script, /podman rm -f shaper-registry/);
  assert.doesNotMatch(script, /--replace --name shaper-registry|--name shaper-registry[^\n]*--replace/);
  assert.match(script, /export SHAPER_UNIVERSE_DIR="\$UNIV"\nbash "\$HERE\/podman-up\.sh"/);
  assert.doesNotMatch(script, /^cd "\$UNIV"$/m);
});
