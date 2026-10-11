// Intent: software/universes/_template/INTENT.md#base-units
// Rehearsal of a universe derived from the template, where podman cannot run:
// the template copied to a fresh directory, its base/ installed from this
// repository by deploy/install-base.sh, then the template's own
// deploy/podman-up.sh — which hands the birth to base/deploy/podman-up.sh —
// with univ-minimal's rehearsal podman (each unit's real server.js as a
// process, its database on one throwaway MariaDB). Then the template's live
// smoke test against the running units, and a re-run that keeps them.
//
// It proves the template's delegation: the universe's own name, settings
// file, schedule and lock reach the base's birth order and identities. It
// proves NOTHING about the container shape (univ-minimal's rehearsal says
// why) and never qualifies a universe: base/deploy/proof.sh on a real podman
// does.
//
//   (cd software/packages/pkg-db && npm ci --omit=dev)   # mysql2, once
//   MARIADB_BASEDIR=<extracted MariaDB, holding usr/sbin/mariadbd and usr/bin/mariadb> \
//     node software/packages/pkg-db/test/live/run-live.mjs \
//     software/universes/_template/test/rehearsal.live.mjs
//
// Needs `unshare -r`, git, curl, and ports 8610, 8620, 8630 and 8640 free on
// 127.0.0.1; this checkout must contain the qualified base release.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.resolve(HERE, '..');
const SOFTWARE = path.resolve(TEMPLATE, '../..');
const REPO = path.resolve(SOFTWARE, '..');
const HARNESS = path.join(SOFTWARE, 'universes/univ-minimal/test/rehearsal');
const socket = process.env.SHAPER_LIVE_SOCKET;
const appsRoot = process.env.SHAPER_LIVE_APPS_ROOT;
const workDir = process.env.SHAPER_LIVE_WORKDIR;
const UNIV = path.join(workDir, 'univ-example');
const fakeState = path.join(workDir, 'fake');
const proofDir = path.join(workDir, 'proof');
const mariadb = path.join(process.env.MARIADB_BASEDIR || '', 'usr/bin/mariadb');
const hasJq = spawnSync('sh', ['-c', 'command -v jq'], { encoding: 'utf8' }).status === 0;

const env = {
  ...process.env,
  PATH: [path.join(HARNESS, 'bin'), ...(hasJq ? [] : [path.join(HARNESS, 'jq-shim')]), process.env.PATH].join(':'),
  FAKE_STATE: fakeState, FAKE_SOCKET: socket, FAKE_SOFTWARE: SOFTWARE, FAKE_MARIADB: mariadb, REHEARSAL_SOFTWARE: SOFTWARE,
};
for (const k of ['VAULT_TOKEN', 'ENV_FILE', 'SHAPER_UNIVERSE', 'SHAPER_APPS_ROOT', 'SHAPER_REGISTRY', 'SHAPER_IMAGE_TAG', 'PROOF_STATE_DIR']) delete env[k];
const sql = (db, q) => execFileSync(mariadb, ['--no-defaults', '-S', socket, '-uroot', '-N', '-B', ...(db ? [db] : []), '-e', q], { encoding: 'utf8' }).trim();
const up = (...args) => spawnSync('unshare', ['-r', 'bash', path.join(UNIV, 'deploy/podman-up.sh'), ...args], { env, encoding: 'utf8', timeout: 600000 });
const state = (slug) => JSON.parse(fs.readFileSync(path.join(fakeState, `univ-example-ctr-${slug}.json`), 'utf8'));
const UNITS = ['vault', 'logger', 'queue', 'maestro'];

let install, preflight, preflightWrote, first;
before(() => {
  fs.cpSync(TEMPLATE, UNIV, { recursive: true });
  fs.writeFileSync(path.join(UNIV, 'cfg-universe.env'), [
    'SHAPER_UNIVERSE=univ-example', `SHAPER_APPS_ROOT=${appsRoot}`,
    'SHAPER_REGISTRY=localhost', 'SHAPER_IMAGE_TAG=rehearsal', `PROOF_STATE_DIR=${proofDir}`, '',
  ].join('\n'));
  install = spawnSync('bash', [path.join(UNIV, 'deploy/install-base.sh'), '--shaper-repo', REPO, '--shaper-commit', 'HEAD'], { env, encoding: 'utf8' });
  preflight = up('--preflight');
  preflightWrote = fs.existsSync(path.join(appsRoot, 'vault/etc/vault/universe-id'));
  first = up();
});
after(() => {
  for (const f of fs.existsSync(fakeState) ? fs.readdirSync(fakeState).filter((x) => x.endsWith('.json')) : []) {
    spawnSync(path.join(HARNESS, 'bin/podman'), ['stop', f.slice(0, -5)], { env });
  }
});

test('install-base lays univ-minimal at HEAD into the universe\'s base/', () => {
  assert.equal(install.status, 0, `${install.stdout}${install.stderr}`);
  const head = execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(fs.readFileSync(path.join(UNIV, 'base/.shaper-revision'), 'utf8').trim(), head);
});

test('--preflight through the template says what a birth of univ-example would do, and changes nothing', () => {
  assert.equal(preflight.status, 0, `${preflight.stdout}${preflight.stderr}`);
  assert.match(preflight.stdout, /univ-example — layers 0-3, vault, logger, queue, maestro: univ-minimal at /);
  for (const s of UNITS) assert.match(preflight.stdout, new RegExp(`${s}\\s+recreate\\s+no container`));
  assert.equal(preflightWrote, false, 'nothing written');
});

test('the template\'s podman-up births univ-example in the base\'s order, under the universe\'s own name', () => {
  assert.equal(first.status, 0, `podman-up failed:\n${first.stdout}\n${first.stderr}`);
  const out = first.stdout;
  const order = ['univ-example — layers 0-3', 'layer 0 — brick-vault', 'OK   vault', 'OK   identities — 4 incarnations', 'layer 1 — brick-logger', 'OK   logger', 'layer 2 — brick-queue', 'OK   queue', 'layer 3 — brick-maestro', 'OK   maestro', 'univ-example ('];
  let at = -1;
  for (const marker of order) { const i = out.indexOf(marker, at + 1); assert.ok(i > at, `"${marker}" after position ${at}:\n${out}`); at = i; }
  const id = fs.readFileSync(path.join(appsRoot, 'vault/etc/vault/universe-id'), 'utf8').trim();
  for (const s of UNITS) {
    const st = state(s);
    assert.equal(st.name, `univ-example-ctr-${s}`);
    assert.equal(st.env.SHAPER_UNIVERSE_ID, id);
  }
  assert.equal(sql('vault', `SELECT COUNT(*) FROM unit_identities WHERE universe_id = '${id}' AND NOT revoked`), '4', 'vault, queue, maestro and the proof hold identities');
  process.stdout.write(`# podman-up output:\n${out.split('\n').map((l) => `#   ${l}`).join('\n')}\n`);
});

test('Maestro holds the universe\'s own (empty) schedule, Queue dispatches nothing', () => {
  const maestro = state('maestro');
  const mount = maestro.spec.mounts.find(([dst]) => dst === '/apps/maestro/etc/task-schedule.json');
  assert.ok(mount, 'the schedule is mounted');
  assert.equal(fs.realpathSync(mount[1]), fs.realpathSync(path.join(UNIV, 'tasks/task-schedule.json')));
  assert.equal(state('queue').env.QUEUE_AUTO_DISPATCH, '0');
});

test('the template\'s live smoke test passes against the running units, and leaves nothing behind', () => {
  const jobs = () => sql('queue', 'SELECT COUNT(*) FROM jobs');
  const before = jobs();
  const r = spawnSync(process.execPath, ['--test', path.join(UNIV, 'test/socle-live.test.js')], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /# pass 5/);
  assert.equal(jobs(), before, 'no job was created');
});

test('a re-run through the template keeps every unit and its incarnation', () => {
  const incarnations = Object.fromEntries(['vault', 'queue', 'maestro'].map((s) => [s, state(s).env.SHAPER_UNIT_INCARNATION]));
  const again = up();
  assert.equal(again.status, 0, `${again.stdout}${again.stderr}`);
  for (const s of UNITS) assert.match(again.stdout, new RegExp(`KEEP ${s} — runs as declared`));
  assert.match(again.stdout, /nothing to register/);
  for (const [s, inc] of Object.entries(incarnations)) assert.equal(state(s).env.SHAPER_UNIT_INCARNATION, inc);
});
