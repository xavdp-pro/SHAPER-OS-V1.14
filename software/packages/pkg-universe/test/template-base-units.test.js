import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Intent: software/universes/_template/INTENT.md#base-units
//
// Non-regression (Rule 29), wave-3 lot BASE-TEMPLATES (CONTRACT-3, gap 4): the
// blueprint every universe is derived from still started file stores and an
// AI bridge, and called Queue without a credential or an attempt. It now
// stands on univ-minimal's four one-container units, installed from one
// recorded revision into the universe's base/ and started by the base's own
// script — never a copy of it. These tests hold the template to that:
//
//  * install-base.sh lays out base/ from a revision that contains the
//    qualified base release, links the universe's schedule, lock and settings,
//    keeps a previous base/, and refuses everything else;
//  * podman-up.sh and proof.sh check what only the universe knows, then hand
//    the base its own arguments and the universe's settings file;
//  * the manifest declares the base units exactly as univ-minimal does.
//
// The base's own script is replaced by a recorder here: what it does with a
// real podman is univ-minimal's proof, not this test's.
//
// Two lessons of the earlier template live on here, in their current form
// (their files, env-precedence.test.js and podman-up-halt-speaks.test.js,
// tested a script that no longer exists):
//
//  * V1.13.5: `source software/.env` clobbered what the operator had
//    exported (the measured engine). The template now reads no shared
//    default file at all — the universe's own settings file is the only one,
//    and the base reads that same file; an export the file does not set
//    (RESTORE_DUMP_<slug>, PODMAN_UP_RECREATE) still reaches the base.
//  * v1.13.14: a halt crashed on its own message ("ENV_FILE: unbound
//    variable") instead of naming what was missing. Every refusal below
//    names the file, the variable or the step to take, and none crashes.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOFTWARE = path.resolve(HERE, '../../..');
const REPO = path.resolve(SOFTWARE, '..');
const TEMPLATE = path.join(SOFTWARE, 'universes/_template');
const MINIMAL = path.join(SOFTWARE, 'universes/univ-minimal');
const QUALIFIED = 'e83f73188a804b3144cfe987ccb5e57133be9fab';

const CFG = ['# the universe settings', 'SHAPER_UNIVERSE=univ-example', 'SHAPER_APPS_ROOT=/apps', 'SHAPER_REGISTRY=', 'SHAPER_IMAGE_TAG=', ''].join('\n');

// A recorder standing in for base/deploy/<script>: its arguments, the
// settings file it was handed, and what that file named.
const RECORDER = `#!/usr/bin/env bash
set -euo pipefail
UNIV="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -n "\${ENV_FILE:-}" && -f "$ENV_FILE" ]]; then set -a; source "$ENV_FILE"; set +a
elif [[ -f "$UNIV/cfg-univ-minimal.env" ]]; then set -a; source "$UNIV/cfg-univ-minimal.env"; set +a
fi
printf '%s\\n' "$(basename "$0") args=[$*] env_file=\${ENV_FILE:-} universe=\${SHAPER_UNIVERSE:-} leak=\${LEAK:-}" >> "$RECORD"
exit "\${BASE_EXIT:-0}"
`;

function universe(t, { cfg = CFG, base = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'template-base-units-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const univ = path.join(root, 'univ-example');
  fs.cpSync(TEMPLATE, univ, { recursive: true });
  if (cfg !== null) fs.writeFileSync(path.join(univ, 'cfg-universe.env'), cfg);
  if (base) {
    const b = path.join(univ, 'base');
    fs.mkdirSync(path.join(b, 'deploy'), { recursive: true });
    fs.copyFileSync(path.join(MINIMAL, 'manifest.json'), path.join(b, 'manifest.json'));
    for (const s of ['podman-up.sh', 'proof.sh', 'lifecycle-drill.sh', 'restore-drill.sh', 'install-renewal-timer.sh', 'renew-bootstraps.sh']) fs.writeFileSync(path.join(b, 'deploy', s), RECORDER, { mode: 0o755 });
    fs.writeFileSync(path.join(b, '.shaper-revision'), `${QUALIFIED}\n`);
    fs.symlinkSync('../tasks/task-schedule.json', path.join(b, 'task-schedule.json'));
    fs.symlinkSync('../cfg-image-lock.json', path.join(b, 'cfg-image-lock.json'));
    fs.symlinkSync('../cfg-universe.env', path.join(b, 'cfg-univ-minimal.env'));
  }
  const record = path.join(root, 'record.log');
  // No container runs here: a podman that knows of none (CONTAINERS lists the ones it does).
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'podman'), '#!/bin/sh\n[ "$1 $2" = "container exists" ] && case " $CONTAINERS " in *" $3 "*) exit 0 ;; esac\nexit 1\n', { mode: 0o755 });
  const run = (script, args = [], env = {}) => {
    const r = spawnSync('bash', [path.join(univ, 'deploy', script), ...args], {
      encoding: 'utf8',
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: root, RECORD: record, ...env },
    });
    return { status: r.status, output: `${r.stdout}${r.stderr}`, record: fs.existsSync(record) ? fs.readFileSync(record, 'utf8').trim().split('\n') : [] };
  };
  return { root, univ, run };
}

// ── the manifest ───────────────────────────────────────────────────────────

test('the template declares univ-minimal\'s four units exactly — image, port, database — in its boot order', () => {
  const mine = JSON.parse(fs.readFileSync(path.join(TEMPLATE, 'manifest.json'), 'utf8'));
  const base = JSON.parse(fs.readFileSync(path.join(MINIMAL, 'manifest.json'), 'utf8'));
  assert.deepEqual(Object.keys(mine.bricks).sort(), Object.keys(base.bricks).sort());
  for (const [name, unit] of Object.entries(base.bricks)) {
    for (const key of ['source', 'package', 'image', 'port', 'database']) assert.deepEqual(mine.bricks[name][key], unit[key], `${name}.${key}`);
  }
  assert.deepEqual(mine.bootOrder, base.bootOrder);
  const lock = JSON.parse(fs.readFileSync(path.join(TEMPLATE, 'cfg-image-lock.json'), 'utf8'));
  assert.deepEqual(Object.keys(lock.images).sort(), ['img-logger', 'img-maestro', 'img-queue', 'img-vault']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(TEMPLATE, 'tasks/task-schedule.json'), 'utf8')), { tasks: [] }, 'Maestro is present and idle');
});

test('the template carries no store of the earlier shape and no engine', () => {
  const text = ['manifest.json', 'cfg-universe.env.example', 'deploy/podman-up.sh', 'deploy/proof.sh', 'deploy/install-base.sh', 'deploy/base.sh'] // lib.sh names the earlier stores to refuse them
    .map((f) => fs.readFileSync(path.join(TEMPLATE, f), 'utf8')).join('\n');
  assert.doesNotMatch(text, /VAULT_STORAGE_FILE|QUEUE_STORAGE_FILE|LOG_DIR=|vault\.enc|jobs\.jsonl|brick-bridge-|OPENCODE_|QUEUE_AUTO_DISPATCH=1/);
  assert.ok(!fs.existsSync(path.join(TEMPLATE, 'deploy/env.example')), 'no second settings file');
});

// ── podman-up.sh and proof.sh ────────────────────────────────────────────

test('podman-up.sh hands the base its own arguments and the universe\'s settings file', (t) => {
  const u = universe(t);
  const r = u.run('podman-up.sh', ['--recreate', 'queue']);
  assert.equal(r.status, 0, r.output);
  assert.match(r.output, /univ-example — layers 0-3, vault, logger, queue, maestro: univ-minimal at e83f73188a80/);
  assert.deepEqual(r.record, [`podman-up.sh args=[--recreate queue] env_file=${path.join(u.univ, 'cfg-universe.env')} universe=univ-example leak=`]);
});

test('podman-up.sh reads no shared default file: the universe\'s own file is the only one', (t) => {
  const u = universe(t);
  fs.mkdirSync(path.join(u.root, 'software'), { recursive: true });
  for (const shared of ['software/.env', '.env']) fs.writeFileSync(path.join(u.root, shared), 'SHAPER_UNIVERSE=univ-other\nLEAK=shared-default\n');
  const r = u.run('podman-up.sh');
  assert.equal(r.status, 0, r.output);
  assert.match(r.record[0], /universe=univ-example leak=$/);
});

test('an operator export the settings file does not set still reaches the base', (t) => {
  const u = universe(t);
  const r = u.run('podman-up.sh', [], { LEAK: 'exported-by-the-operator' });
  assert.equal(r.status, 0, r.output);
  assert.match(r.record[0], /leak=exported-by-the-operator$/);
});

test('an explicit ENV_FILE is the file both the template and the base read', (t) => {
  const u = universe(t, { cfg: null });
  const other = path.join(u.root, 'elsewhere.env');
  fs.writeFileSync(other, CFG);
  const r = u.run('podman-up.sh', ['--preflight'], { ENV_FILE: other });
  assert.equal(r.status, 0, r.output);
  assert.deepEqual(r.record, [`podman-up.sh args=[--preflight] env_file=${other} universe=univ-example leak=`]);
});

test('proof.sh runs the base\'s proof and keeps its verdict', (t) => {
  const u = universe(t);
  const ok = u.run('proof.sh');
  assert.equal(ok.status, 0, ok.output);
  assert.match(ok.record[0], /^proof\.sh args=\[\] env_file=.*universe=univ-example/);
  const failed = u.run('proof.sh', [], { BASE_EXIT: '3' });
  assert.equal(failed.status, 3, 'a failed base proof is the universe\'s verdict');
});

const refused = (r, pattern) => {
  assert.notEqual(r.status, 0, r.output);
  assert.match(r.output, pattern);
  assert.match(r.output, /Halt\./);
  assert.deepEqual(r.record, [], 'the base never runs');
  assert.doesNotMatch(r.output, /unbound variable|sans liaison/, 'a halt speaks; it does not crash on its own message');
};

test('no settings file: the halt names the file to create from the example', (t) => {
  const u = universe(t, { cfg: null });
  refused(u.run('podman-up.sh'), /no settings file .*cfg-universe\.env: copy .*cfg-universe\.env\.example/);
});

test('a settings file with a line source would execute is refused before anything sources it', (t) => {
  const u = universe(t, { cfg: `${CFG}SHAPER_IMAGE_TAG=1; touch INJECTED\n` });
  const r = u.run('podman-up.sh');
  assert.notEqual(r.status, 0);
  assert.match(r.output, /would be EXECUTED by source/);
  assert.ok(!fs.existsSync(path.join(u.univ, 'deploy/INJECTED')) && !fs.existsSync(path.join(u.root, 'INJECTED')));
  assert.deepEqual(r.record, []);
});

test('SHAPER_UNIVERSE must be the manifest\'s universe', (t) => {
  refused(universe(t, { cfg: CFG.replace('univ-example', 'univ-other') }).run('podman-up.sh'), /SHAPER_UNIVERSE is univ-other .* the manifest declares univ-example: one universe, one name/);
  refused(universe(t, { cfg: CFG.replace('SHAPER_UNIVERSE=univ-example', '') }).run('podman-up.sh'), /SHAPER_UNIVERSE is not set/);
});

test('a universe of the earlier template\'s shape is refused, nothing changed', (t) => {
  for (const marker of ['sav/vault/vault.enc', 'sav/queue/jobs.jsonl', 'sav/opencode-bridge/token', '.state/vol-univ-example-vault/vault.enc']) {
    const u = universe(t);
    fs.mkdirSync(path.dirname(path.join(u.univ, marker)), { recursive: true });
    fs.writeFileSync(path.join(u.univ, marker), 'earlier');
    refused(u.run('podman-up.sh'), /earlier template's shape/);
  }
  // Its containers, named <universe>-vault without -ctr-, are the same finding.
  const u = universe(t);
  const r = u.run('podman-up.sh', [], { CONTAINERS: 'univ-example-vault univ-example-bridge-opencode' });
  refused(r, /container univ-example-vault/);
  assert.match(r.output, /moving it to the one-container units is a migration, a separate decision/);
});

test('no base/, or a base/ that is not linked to the universe\'s own schedule and lock, is refused', (t) => {
  refused(universe(t, { base: false }).run('podman-up.sh'), /no base units in .*: run deploy\/install-base\.sh/);
  const u = universe(t);
  fs.unlinkSync(path.join(u.univ, 'base/task-schedule.json'));
  fs.writeFileSync(path.join(u.univ, 'base/task-schedule.json'), '{"tasks":[{"slug":"task-elsewhere"}]}');
  refused(u.run('podman-up.sh'), /base\/task-schedule\.json is not the universe's own .*: one schedule, one lock/);
});

test('a manifest that disagrees with the installed base is refused, naming the difference', (t) => {
  const u = universe(t);
  const file = path.join(u.univ, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  m.bricks['brick-queue'].database.schemaVersion = 3;
  fs.writeFileSync(file, JSON.stringify(m));
  refused(u.run('podman-up.sh'), /brick-queue\.database: the manifest declares .*"schemaVersion": 3.*the base at e83f73188a80 births/);
});

test('a unit beyond the base units is refused: the template would never start nor prove it', (t) => {
  // Fresh-context review (wave 3): such a unit was accepted by the checks,
  // then silently never started and never proved.
  const u = universe(t);
  const file = path.join(u.univ, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  m.bricks['brick-example'] = { source: 'catalogue', perimeter: 'P3', package: '@example/x', image: 'img-example', intent: './INTENT.md', role: 'r', port: 7000,
    database: { engine: 'mariadb', placement: 'in-unit', slug: 'example', uid: 10700, engineUid: 10701, schema: '/x', schemaVersion: 1 } };
  m.bootOrder.push(['brick-example']);
  fs.writeFileSync(file, JSON.stringify(m));
  for (const script of ['podman-up.sh', 'proof.sh']) {
    refused(u.run(script), /brick-example: the template does not yet start or prove a unit the universe adds; declare only the base units/);
  }
  delete m.bricks['brick-example'];
  m.bootOrder = [m.bootOrder[1], m.bootOrder[0], ...m.bootOrder.slice(2, -1)];
  fs.writeFileSync(file, JSON.stringify(m));
  refused(u.run('podman-up.sh'), /bootOrder: the manifest declares .*, the base at e83f73188a80 births/);
});

test('deploy/base.sh runs the base\'s drills and renewal after the same checks, with the universe\'s settings file', (t) => {
  const u = universe(t);
  for (const [script, args] of [['lifecycle-drill.sh', []], ['restore-drill.sh', ['--unit', 'vault']], ['install-renewal-timer.sh', []], ['renew-bootstraps.sh', []]]) {
    const r = u.run('base.sh', [script, ...args]);
    assert.equal(r.status, 0, r.output);
    assert.equal(r.record.at(-1), `${script} args=[${args.join(' ')}] env_file=${path.join(u.univ, 'cfg-universe.env')} universe=univ-example leak=`);
  }
  const unknown = u.run('base.sh', ['podman-up.sh']);
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.output, /deploy\/base\.sh <lifecycle-drill\.sh\|restore-drill\.sh\|install-renewal-timer\.sh\|renew-bootstraps\.sh>/);
  const v = universe(t, { cfg: `${CFG}KEY=1; touch INJECTED\n` });
  const bad = v.run('base.sh', ['restore-drill.sh']);
  assert.notEqual(bad.status, 0);
  assert.match(bad.output, /would be EXECUTED by source/);
  assert.deepEqual(bad.record, [], 'the base never sources a file that failed the guard');
});

test('base/cfg-univ-minimal.env must link to the universe\'s own settings file', (t) => {
  const u = universe(t);
  fs.unlinkSync(path.join(u.univ, 'base/cfg-univ-minimal.env'));
  fs.writeFileSync(path.join(u.univ, 'base/cfg-univ-minimal.env'), 'SHAPER_UNIVERSE=univ-minimal\n');
  refused(u.run('podman-up.sh'), /base\/cfg-univ-minimal\.env is not a link to the universe's own cfg-universe\.env/);
});

test('the template itself is a mold: it is never run in place', () => {
  const r = spawnSync('bash', [path.join(TEMPLATE, 'deploy/podman-up.sh')], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /is the template itself: copy it/);
});

// ── install-base.sh ──────────────────────────────────────────────────────

const hasQualified = spawnSync('git', ['-C', REPO, 'merge-base', '--is-ancestor', QUALIFIED, 'HEAD']).status === 0;

test('install-base.sh lays out univ-minimal at the revision, linked to the universe\'s own files, and keeps a previous base/', { skip: !hasQualified && 'this checkout does not contain the qualified base release' }, (t) => {
  const u = universe(t, { base: false });
  const head = spawnSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const first = u.run('install-base.sh', ['--shaper-repo', REPO, '--shaper-commit', 'HEAD']);
  assert.equal(first.status, 0, first.output);
  const base = path.join(u.univ, 'base');
  assert.equal(fs.readFileSync(path.join(base, '.shaper-revision'), 'utf8').trim(), head);
  assert.equal(fs.readlinkSync(path.join(base, 'task-schedule.json')), '../tasks/task-schedule.json');
  assert.equal(fs.readlinkSync(path.join(base, 'cfg-image-lock.json')), '../cfg-image-lock.json');
  assert.equal(fs.readlinkSync(path.join(base, 'cfg-univ-minimal.env')), '../cfg-universe.env');
  assert.ok(!fs.existsSync(path.join(base, 'test')), 'the base\'s rehearsal stays out');
  const committed = spawnSync('git', ['-C', REPO, 'show', 'HEAD:software/universes/univ-minimal/deploy/podman-up.sh'], { encoding: 'utf8' }).stdout;
  assert.equal(fs.readFileSync(path.join(base, 'deploy/podman-up.sh'), 'utf8'), committed, 'the base is the revision\'s own script');
  assert.deepEqual(fs.readdirSync(u.univ).filter((n) => n.startsWith('.base-install')), [], 'no staging left behind');

  // Two more installs, at once: each previous base/ is kept under a name of its
  // own, never moved inside another (fresh-context review: same-second nesting).
  for (let i = 0; i < 2; i++) {
    const again = u.run('install-base.sh', ['--shaper-repo', REPO, '--shaper-commit', head]);
    assert.equal(again.status, 0, again.output);
  }
  const kept = fs.readdirSync(u.univ).filter((n) => n.startsWith('base.before-install-'));
  assert.equal(kept.length, 2, `the previous bases are kept: ${kept}`);
  for (const k of [...kept, 'base']) {
    assert.ok(fs.existsSync(path.join(u.univ, k, '.shaper-revision')), `${k} is a whole base`);
    assert.deepEqual(fs.readdirSync(path.join(u.univ, k)).filter((n) => n.startsWith('base')), [], `${k} holds no nested base`);
  }

  // The template's own checks pass over what install-base laid out.
  const preflightChecks = spawnSync('bash', ['-c', `set -euo pipefail; UNIV='${u.univ}'; source '${u.univ}/deploy/lib.sh'; load_universe_env; check_base_layout; check_base_units_agree; echo agreed`], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(preflightChecks.stdout.trim(), 'agreed', preflightChecks.stderr);
});

test('install-base.sh refuses a revision before the qualified base release, an unknown one, and missing arguments', { skip: !hasQualified && 'this checkout does not contain the qualified base release' }, (t) => {
  const u = universe(t, { base: false });
  const before = u.run('install-base.sh', ['--shaper-repo', REPO, '--shaper-commit', `${QUALIFIED}~1`]);
  assert.notEqual(before.status, 0);
  assert.match(before.output, /does not contain the qualified base release e83f73188a80/);
  const unknown = u.run('install-base.sh', ['--shaper-repo', REPO, '--shaper-commit', 'no-such-revision']);
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.output, /no commit 'no-such-revision'/);
  const bare = u.run('install-base.sh');
  assert.notEqual(bare.status, 0);
  assert.match(bare.output, /--shaper-repo .* and --shaper-commit/);
  const noValue = u.run('install-base.sh', ['--shaper-repo', REPO, '--shaper-commit']);
  assert.notEqual(noValue.status, 0);
  assert.match(noValue.output, /--shaper-commit takes a value/, 'a missing value is a halt that speaks');
  assert.ok(!fs.existsSync(path.join(u.univ, 'base')), 'nothing was laid out');
});

test('install-base.sh refuses a universe of the earlier template\'s shape', (t) => {
  const u = universe(t, { base: false });
  fs.mkdirSync(path.join(u.univ, 'sav/vault'), { recursive: true });
  fs.writeFileSync(path.join(u.univ, 'sav/vault/vault.enc'), 'earlier');
  const r = u.run('install-base.sh', ['--shaper-repo', REPO, '--shaper-commit', 'HEAD']);
  assert.notEqual(r.status, 0);
  assert.match(r.output, /earlier template's shape/);
  assert.ok(!fs.existsSync(path.join(u.univ, 'base')));
});

test('the earlier shape is also found under the directory\'s own name and univ-base\'s volumes', (t) => {
  // The earlier template named its containers after UNIV_SLUG or the directory.
  const u = universe(t);
  refused(u.run('podman-up.sh', [], { CONTAINERS: `${path.basename(u.univ)}-queue` }), /container univ-example-queue/);
  const renamed = universe(t);
  const dir = path.join(renamed.root, 'univ-earlier');
  fs.renameSync(renamed.univ, dir);
  const r = spawnSync('bash', [path.join(dir, 'deploy/podman-up.sh')], { encoding: 'utf8', env: { PATH: `${path.join(renamed.root, 'bin')}:${process.env.PATH}`, RECORD: path.join(renamed.root, 'record.log'), CONTAINERS: 'univ-earlier-vault' } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /container univ-earlier-vault/);
  const v = universe(t);
  fs.mkdirSync(path.join(v.univ, '.state/vol-univ-base-vault'), { recursive: true });
  refused(v.run('podman-up.sh'), /\.state\/vol-univ-base-vault/);
});
