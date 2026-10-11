import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Intent: software/universes/univ-minimal/INTENT.md#settings
//
// SOL-DECISIONS-4 §5 (wave 7, ENV-PARSER-ALLOWLIST). Until this lot every base
// script `source`d its settings file under `set -a`: a grammar guard stopped
// shell syntax first, but any key it did not know — a secret nobody had listed,
// a typo — was still exported into the script, podman, conmon and every child,
// and whatever the caller had inherited went along. The base now has one
// declarative reader, deploy/settings.sh. These tests hold it to the decision:
//
//  * a line is accepted only when its key is a parameter of the catalogue;
//  * unknown keys, executable syntax, a key given twice and raw secrets block
//    before any mutation, and the diagnostics name keys and lines, never values;
//  * the historical value forms an earlier file used are read as `source` read
//    them, without running anything;
//  * the inherited environment is held to the same catalogue, and parasitic
//    inheritance is refused or never passed on;
//  * every command the script runs receives an environment built explicitly.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UNIVERSES = path.resolve(HERE, '../../../universes');
const DEPLOY = path.join(UNIVERSES, 'univ-minimal/deploy');
const SETTINGS = path.join(DEPLOY, 'settings.sh');
const SECRET = 'c7'.repeat(24);
const canUnshare = spawnSync('unshare', ['-r', 'true']).status === 0;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'univ-minimal-settings-'));
const BASE_ENV = { PATH: '/usr/bin:/bin' };
// Without jq on the machine, the rehearsal's shim stands in for the subset the scripts use.
const hasJq = spawnSync('sh', ['-c', 'command -v jq']).status === 0;
const toolPath = (bin) => [bin, ...(hasJq ? [] : [path.join(UNIVERSES, 'univ-minimal/test/rehearsal/jq-shim')]), process.env.PATH].join(':');

/** Loads <lines> as the settings file (or none) with <env> inherited, then runs <after>. */
function load(lines, { env = {}, after = '' } = {}) {
  const dir = tmp();
  try {
    const file = path.join(dir, 'cfg.env');
    if (lines !== null) fs.writeFileSync(file, `${lines.join('\n')}\n`);
    const r = spawnSync('bash', ['-c', `set -uo pipefail; source '${SETTINGS}'; shaper_settings_load "[t]" || exit 1; ${after}`], {
      env: { ...BASE_ENV, ...(lines === null ? {} : { ENV_FILE: file }), ...env }, encoding: 'utf8', cwd: dir,
    });
    return { ...r, dir };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const valueOf = (r, name) => (new RegExp(`^declare -- ${name}="(.*)"$`, 'm').exec(r.stdout) || [])[1];

describe('the value forms an earlier file used are read as source read them, never run', () => {
  // Each value is read by the reader's value parser and by bash `source`, in a
  // scratch directory, and the two must agree: the reader preserves the
  // historical forms without executing the file.
  const accepted = [
    '', 'abc', 'http://localhost:8640', 'anthropic/claude-x', 'a=b', 'abc#not-a-comment', 'v1.2-rc_3',
    '"a b; c"', '"pa$"', '"$ x"', '"a\\"b"', '"back\\\\slash"', '"\\$HOME stays"', '"a\\nb"',
    "'a;b $(x) `y`'", "''", '""', 'abc   # a note after the value', '"x y"  # note', "'q' # c",
  ];
  for (const value of accepted) {
    test(`X=${value} — the same value as bash source gives`, () => {
      const dir = tmp();
      try {
        const file = path.join(dir, 'f');
        fs.writeFileSync(file, `X=${value}\n`);
        const bash = spawnSync('bash', ['-c', `set -a; source '${file}'; printf '%s' "$X"`], { encoding: 'utf8', cwd: dir, env: BASE_ENV });
        const mine = spawnSync('bash', ['-c', `source '${SETTINGS}'; _shaper_settings_value "$1" || { echo "REFUSED $_SHAPER_E"; exit 1; }; printf '%s' "$_SHAPER_V"`, 'p', value], { encoding: 'utf8', env: BASE_ENV });
        assert.equal(mine.status, 0, mine.stdout);
        assert.equal(mine.stdout, bash.stdout);
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
  }

  const refused = {
    '1; touch INJECTED': /a character a shell would interpret/,
    '$(touch INJECTED)': /a character a shell would interpret/,
    '`touch INJECTED`': /a character a shell would interpret/,
    '"$(touch INJECTED)"': /an expansion/,
    '"`touch INJECTED`"': /a command substitution/,
    '"${HOME}"': /an expansion/,
    '"$HOME"': /an expansion/,
    '$HOME': /a character a shell would interpret/,
    'a b': /a second word/,
    'a>INJECTED': /a character a shell would interpret/,
    'a|b': /a character a shell would interpret/,
    'a && touch INJECTED': /a second word/,
    '{"a":1}': /a character a shell would interpret/,
    '~/x': /a tilde expansion/,
    'a:~/x': /a tilde expansion/,
    "'a'b": /text joined to a quoted value/,
    '"a"b': /text joined to a quoted value/,
    'a\\ b': /a character a shell would interpret/,
    "'unterminated": /an unterminated single quote/,
    '"unterminated': /an unterminated double quote/,
    '"line\\': /a line continuation|an unterminated double quote/,
    '*': /a character a shell would interpret/,
  };
  for (const [value, reason] of Object.entries(refused)) {
    test(`X=${value} — refused (${reason.source}), nothing run`, () => {
      const dir = tmp();
      try {
        const r = spawnSync('bash', ['-c', `source '${SETTINGS}'; _shaper_settings_value "$1" && echo ACCEPTED; echo "$_SHAPER_E"`, 'p', value], { encoding: 'utf8', env: BASE_ENV, cwd: dir });
        assert.doesNotMatch(r.stdout, /ACCEPTED/);
        assert.match(r.stdout, reason);
        assert.ok(!fs.existsSync(path.join(dir, 'INJECTED')));
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
  }
});

describe('a line is accepted only when its key is in the catalogue', () => {
  test('the catalogue\'s settings are read, with export, comments, CRLF and quotes', () => {
    const r = load([
      '# the universe', '', '   ', 'SHAPER_UNIVERSE=univ-example\r', 'export SHAPER_APPS_ROOT="/srv/univ-example/.state/units"  # the base units',
      "SHAPER_SECRETS_ROOT='/srv/univ-example/.state/secrets'", 'SHAPER_REGISTRY=registry.local:5000/shaper', 'SHAPER_IMAGE_TAG=v1.14-rc_2',
      'SHAPER_UNIVERSE_ID=0f29b18b-05dd-4902-9156-1913ec863903', 'PROOF_STATE_DIR=/srv/univ-example/.state/proof',
      'RENEWAL_EXTRA_IDENTITIES="ipbx voice"', 'RENEWAL_ALERT_UNIT=univ-example-watch.service', 'PARENT_LOCK_WAIT_SECONDS=30',
      'VAULT_TOKEN=', 'VAULT_TOKEN_FILE=/run/secrets/VAULT_TOKEN',
    ], { after: 'declare -p SHAPER_UNIVERSE SHAPER_APPS_ROOT SHAPER_SECRETS_ROOT SHAPER_REGISTRY SHAPER_IMAGE_TAG SHAPER_UNIVERSE_ID PROOF_STATE_DIR RENEWAL_EXTRA_IDENTITIES RENEWAL_ALERT_UNIT PARENT_LOCK_WAIT_SECONDS' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(valueOf(r, 'SHAPER_UNIVERSE'), 'univ-example');
    assert.equal(valueOf(r, 'SHAPER_APPS_ROOT'), '/srv/univ-example/.state/units');
    assert.equal(valueOf(r, 'SHAPER_SECRETS_ROOT'), '/srv/univ-example/.state/secrets');
    assert.equal(valueOf(r, 'SHAPER_REGISTRY'), 'registry.local:5000/shaper');
    assert.equal(valueOf(r, 'RENEWAL_EXTRA_IDENTITIES'), 'ipbx voice');
    assert.equal(valueOf(r, 'PARENT_LOCK_WAIT_SECONDS'), '30');
  });

  test('every refusal is reported at once, by key and line, before anything is assigned — never a value, never the text', () => {
    const r = load([
      'SHAPER_UNIVERSE=univ-example',
      `SHAPER_UNIVERSE=univ-${SECRET.slice(0, 6)}`,
      `BACKOFFICE_ADMIN = someone@example.test / ${SECRET}`,
      `SHAPER_IMAGE_TAG=1; echo ${SECRET}`,
      `VAULT_TOKEN=${SECRET}`,
      `DEEPGRAM_API_KEY="${SECRET}"`,
      `UNLISTED=${SECRET}`,
      'PODMAN_UP_RECREATE=all',
      'PROOF_STATE_DIR=relative/path',
      'SHAPER_SECRETS_ROOT=/srv/../etc',
      'VAULT_TOKEN_FILE=/elsewhere',
      'just a reminder for tomorrow',
    ], { after: 'echo ASSIGNED "${SHAPER_UNIVERSE:-none}"' });
    assert.equal(r.status, 1);
    assert.doesNotMatch(r.stdout, /ASSIGNED/);
    const lines = [
      [2, /line 2: SHAPER_UNIVERSE is given twice \(first on line 1\)/],
      [3, /line 3: not KEY=value — a shell would run it as a command/],
      [4, /line 4: SHAPER_IMAGE_TAG — its value holds a character a shell would interpret/],
      [5, /line 5: VAULT_TOKEN gives a secret a value/],
      [6, /line 6: DEEPGRAM_API_KEY gives a secret a value/],
      [7, /line 7: UNLISTED is not a parameter of the base/],
      [8, /line 8: PODMAN_UP_RECREATE is a knob of one run, not a setting of the universe/],
      [9, /line 9: PROOF_STATE_DIR must be an absolute path/],
      [10, /line 10: SHAPER_SECRETS_ROOT must be an absolute path/],
      [11, /line 11: VAULT_TOKEN_FILE names another file than the one the base delivers/],
      [12, /line 12: not KEY=value/],
    ];
    for (const [, pattern] of lines) assert.match(r.stderr, pattern);
    assert.ok(!r.stderr.includes(SECRET.slice(0, 6)) && !r.stdout.includes(SECRET.slice(0, 6)), 'no value, not even part of one');
    assert.doesNotMatch(r.stderr, /someone@example|reminder/, 'no line text');
    assert.match(r.stderr, /Halt\.$/m);
  });

  test('a value not of its parameter\'s form is refused, named', () => {
    for (const [line, form] of [
      ['SHAPER_UNIVERSE=minimal', /an instance slug/], ['SHAPER_UNIVERSE_ID=NOT-A-UUID', /a lowercase UUID/],
      ['SHAPER_REGISTRY=http://registry', /a registry/], ['PARENT_LOCK_WAIT_SECONDS=1m', /a whole number/],
      ['RENEWAL_ALERT_UNIT=watch.timer', /systemd service/], ['RENEWAL_EXTRA_IDENTITIES=Voice', /unit slugs/],
    ]) {
      const r = load([line]);
      assert.equal(r.status, 1, line);
      assert.match(r.stderr, form, line);
    }
  });
});

describe('which settings file: the one named, or the universe\'s own, never another in its place', () => {
  test('a named ENV_FILE that does not exist halts; /dev/null names none', () => {
    const missing = load(null, { env: { ENV_FILE: '/nonexistent/cfg.env' } });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /ENV_FILE names \/nonexistent\/cfg\.env, which is not a file: no other settings file is read in its place/);
    const none = load(null, { env: { ENV_FILE: '/dev/null', SHAPER_UNIVERSE: 'univ-example' }, after: 'declare -p SHAPER_UNIVERSE' });
    assert.equal(none.status, 0, none.stderr);
    assert.equal(valueOf(none, 'SHAPER_UNIVERSE'), 'univ-example');
  });

  test('without ENV_FILE, <universe>/cfg-univ-minimal.env when it exists', () => {
    const dir = tmp();
    try {
      fs.writeFileSync(path.join(dir, 'cfg-univ-minimal.env'), 'SHAPER_UNIVERSE=univ-own\n');
      const r = spawnSync('bash', ['-c', `UNIV='${dir}'; source '${SETTINGS}'; shaper_settings_load "[t]" && echo "$SHAPER_UNIVERSE $SHAPER_SETTINGS_FILE"`], { env: BASE_ENV, encoding: 'utf8' });
      assert.equal(r.stdout.trim(), `univ-own ${path.join(dir, 'cfg-univ-minimal.env')}`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('the inherited environment is held to the same catalogue', () => {
  test('an inherited parameter must have its form, and may not contradict the file', () => {
    const bad = load(['SHAPER_UNIVERSE=univ-example'], { env: { SHAPER_APPS_ROOT: 'apps', PODMAN_UP_RECREATE: 'all;reboot' } });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /inherited SHAPER_APPS_ROOT must be an absolute path/);
    assert.match(bad.stderr, /inherited PODMAN_UP_RECREATE must be unit slugs/);
    const contradicts = load(['SHAPER_UNIVERSE=univ-example', 'SHAPER_REGISTRY='], { env: { SHAPER_UNIVERSE: 'univ-other', SHAPER_REGISTRY: 'localhost' } });
    assert.equal(contradicts.status, 1);
    assert.match(contradicts.stderr, /inherited SHAPER_UNIVERSE contradicts line 1 of the settings file: set it in one place/);
    assert.match(contradicts.stderr, /inherited SHAPER_REGISTRY contradicts line 2/);
    assert.doesNotMatch(contradicts.stderr, /univ-other|localhost/, 'the values are not printed');
    const agrees = load(['SHAPER_UNIVERSE=univ-example'], { env: { SHAPER_UNIVERSE: 'univ-example', SHAPER_APPS_ROOT: '/srv/apps', RESTORE_DUMP_vault: '/apps/vault/sav/restore/vault.sql' }, after: 'declare -p SHAPER_APPS_ROOT RESTORE_DUMP_vault' });
    assert.equal(agrees.status, 0, agrees.stderr);
    assert.equal(valueOf(agrees, 'SHAPER_APPS_ROOT'), '/srv/apps', 'a parameter the file does not set is taken from the caller');
    assert.equal(valueOf(agrees, 'RESTORE_DUMP_vault'), '/apps/vault/sav/restore/vault.sql');
  });

  test('a secret of the base, or a secret-shaped name of its namespaces, inherited with a value is refused by name', () => {
    for (const name of ['VAULT_TOKEN', 'VAULT_MASTER_KEY', 'UNIT_BOOTSTRAP_TOKEN', 'SHAPER_API_KEY', 'MYSQL_PWD', 'MARIADB_PASSWORD']) {
      const r = load(['SHAPER_UNIVERSE=univ-example'], { env: { [name]: SECRET } });
      assert.equal(r.status, 1, name);
      assert.match(r.stderr, new RegExp(`the inherited environment gives the secret ${name} a value`));
      assert.ok(!r.stderr.includes(SECRET));
    }
  });

  test('an unknown SHAPER_* or RESTORE_DUMP_* name is refused: a typo would otherwise be ignored', () => {
    const r = load(['SHAPER_UNIVERSE=univ-example'], { env: { SHAPER_APP_ROOT: '/x', RESTORE_DUMP_Vault: '/apps/vault/sav/restore/v.sql' } });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /inherited SHAPER_APP_ROOT is not a parameter of the base/);
    assert.match(r.stderr, /inherited RESTORE_DUMP_Vault is not a parameter of the base/);
  });

  test('parasitic inheritance is refused: a shell or loader variable, an exported function, a name no shell can hold', () => {
    const r = load(['SHAPER_UNIVERSE=univ-example'], {
      env: { BASH_ENV: '/dev/null', LD_PRELOAD: '/nonexistent.so', 'BASH_FUNC_podman%%': '() { echo hijacked; }', 'A-B.C': '1' },
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /sets BASH_ENV, which changes how a shell or a program loads/);
    assert.match(r.stderr, /sets LD_PRELOAD/);
    assert.match(r.stderr, /exports the shell function podman, which would replace a command/);
    assert.match(r.stderr, /an entry whose name is no variable \(A-B\.C\)/);
  });
});

describe('every command the script runs receives an environment built explicitly', () => {
  test('after loading, the exported environment is the pass list; parameters and the rest inherited stay unexported', () => {
    const r = load(['SHAPER_UNIVERSE=univ-example'], {
      env: { HOME: '/root', LANG: 'C.UTF-8', LC_ALL: 'C', ENV_FILE_UNUSED: 'x', OTHER_TOKEN: SECRET, SOME_TOOL_HOME: '/opt/x', SHAPER_APPS_ROOT: '/apps' },
      after: 'env -0 | tr "\\0" "\\n" | cut -d= -f1 | sort | tr "\\n" " "; echo; echo "readable:$SHAPER_APPS_ROOT"',
    });
    assert.equal(r.status, 0, r.stderr);
    const exported = r.stdout.split('\n')[0].trim().split(' ').filter((n) => n !== '_');
    assert.deepEqual(exported, ['HOME', 'LANG', 'LC_ALL', 'PATH']);
    assert.match(r.stdout, /readable:\/apps/, 'a parameter stays a variable of the script');
  });

  test('a base script run by another receives ENV_FILE, the settings and only the run knobs it is given', () => {
    const r = load(['SHAPER_UNIVERSE=univ-example', 'SHAPER_APPS_ROOT=/srv/apps'], {
      env: { PODMAN_UP_RECREATE: 'vault', NOISE: '1' },
      after: 'shaper_settings_child_env; printf "%s\\n" "${SHAPER_CHILD_ENV[@]}"; echo ---; shaper_settings_child_env --with-run; printf "%s\\n" "${SHAPER_CHILD_ENV[@]}"',
    });
    assert.equal(r.status, 0, r.stderr);
    const [plain, withRun] = r.stdout.split('---\n').map((block) => block.trim().split('\n').map((l) => l.split('=')[0]).sort());
    assert.deepEqual(plain, ['ENV_FILE', 'PATH', 'SHAPER_APPS_ROOT', 'SHAPER_UNIVERSE']);
    assert.deepEqual(withRun, ['ENV_FILE', 'PATH', 'PODMAN_UP_RECREATE', 'SHAPER_APPS_ROOT', 'SHAPER_UNIVERSE']);
  });

  test('podman receives no parameter and nothing parasitic the caller exported', { skip: !canUnshare && 'no user namespace here' }, () => {
    const dir = tmp();
    try {
      const bin = path.join(dir, 'bin');
      fs.mkdirSync(bin);
      // A podman that records its environment, knows no container and no image.
      fs.writeFileSync(path.join(bin, 'podman'), `#!/bin/sh\nenv > '${dir}/podman.env'\nexit 1\n`, { mode: 0o755 });
      fs.writeFileSync(path.join(bin, 'ss'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      const apps = path.join(dir, 'apps');
      const r = spawnSync('unshare', ['-r', 'bash', path.join(DEPLOY, 'podman-up.sh'), '--preflight'], {
        env: { PATH: toolPath(bin), ENV_FILE: '/dev/null', SHAPER_APPS_ROOT: apps, SHAPER_REGISTRY: 'localhost', SHAPER_IMAGE_TAG: 'x', OTHER_TOKEN: SECRET, NOISE: 'parasite' },
        encoding: 'utf8',
      });
      assert.match(r.stderr, /image .* is not present/, r.stderr);
      const seen = fs.readFileSync(path.join(dir, 'podman.env'), 'utf8');
      assert.ok(!seen.includes(SECRET), 'an inherited secret never reaches podman');
      assert.doesNotMatch(seen, /^(NOISE|SHAPER_[A-Z_]*|ENV_FILE)=/m);
      assert.match(seen, /^PATH=/m);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('every base script reads its settings with the one reader, before it changes anything', () => {
  const SCRIPTS = ['podman-up.sh', 'proof.sh', 'lifecycle-drill.sh', 'restore-drill.sh', 'renew-bootstraps.sh', 'install-renewal-timer.sh', 'extra-identity.sh'];
  for (const name of SCRIPTS) {
    test(`${name}: settings.sh and shaper_settings_load come first; no settings file is sourced`, () => {
      const text = fs.readFileSync(path.join(DEPLOY, name), 'utf8');
      assert.match(text, /^source "\$UNIV\/deploy\/settings\.sh"$/m);
      assert.match(text, /^shaper_settings_load "\[[a-z-]+\]" \|\| exit 1$/m);
      assert.doesNotMatch(text, /set -a|source "\$ENV_FILE"|cfg-univ-minimal\.env"; set|^\s*export\s+[A-Z]/m);
      const load = text.indexOf('shaper_settings_load');
      for (const first of ['\npodman ', 'install -d', 'mktemp', 'flock ', '> "$DIR', 'unit-probes.sh"']) {
        const at = text.indexOf(first);
        assert.ok(at === -1 || at > load, `${name}: ${first.trim()} before the settings are read`);
      }
    });
    test(`${name}: refused settings halt it before any write`, () => {
      const dir = tmp();
      try {
        const envFile = path.join(dir, 'cfg.env');
        fs.writeFileSync(envFile, `SHAPER_UNIVERSE=univ-minimal\nSHAPER_APPS_ROOT=${dir}/apps\nUNLISTED=1\n`);
        const r = spawnSync('bash', [path.join(DEPLOY, name)], { env: { ...BASE_ENV, ENV_FILE: envFile, SYSTEMD_DIR: dir, NO_SYSTEMCTL: '1', PROOF_STATE_DIR: `${dir}/proof` }, encoding: 'utf8' });
        assert.equal(r.status, 1, r.stdout + r.stderr);
        assert.match(r.stderr, /line 3: UNLISTED is not a parameter of the base/);
        assert.deepEqual(fs.readdirSync(dir), ['cfg.env'], 'nothing written');
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
  }

  test('install-renewal-timer.sh refuses a setting its run took from the environment: the service would never read it', () => {
    const dir = tmp();
    try {
      const envFile = path.join(dir, 'cfg.env');
      fs.writeFileSync(envFile, 'SHAPER_UNIVERSE=univ-minimal\n');
      const r = spawnSync('bash', [path.join(DEPLOY, 'install-renewal-timer.sh')], { env: { ...BASE_ENV, ENV_FILE: envFile, SYSTEMD_DIR: dir, NO_SYSTEMCTL: '1', SHAPER_APPS_ROOT: '/srv/apps' }, encoding: 'utf8' });
      assert.equal(r.status, 1);
      assert.match(r.stderr, /SHAPER_APPS_ROOT is set in this run's environment, not in the settings file the service will read/);
      assert.deepEqual(fs.readdirSync(dir), ['cfg.env']);
      const alert = spawnSync('bash', [path.join(DEPLOY, 'install-renewal-timer.sh')], { env: { ...BASE_ENV, ENV_FILE: envFile, SYSTEMD_DIR: dir, NO_SYSTEMCTL: '1', RENEWAL_ALERT_UNIT: 'univ-minimal-watch.service' }, encoding: 'utf8' });
      assert.equal(alert.status, 0, alert.stderr);
      assert.match(fs.readFileSync(path.join(dir, 'univ-minimal-bootstrap-renewal.service'), 'utf8'), /^OnFailure=univ-minimal-watch\.service$/m);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('the template reads the base\'s settings with the base\'s reader, from base/deploy/, and hands its scripts an explicit environment', () => {
    const lib = fs.readFileSync(path.join(UNIVERSES, '_template/deploy/lib.sh'), 'utf8');
    assert.match(lib, /source "\$BASE\/deploy\/settings\.sh"/);
    assert.match(lib, /shaper_settings_child_env --with-run/);
    assert.match(lib, /^base_script\(\) \{ env -i "\$\{SHAPER_CHILD_ENV\[@\]\}" bash "\$BASE\/deploy\/\$1" "\$\{@:2\}"; \}$/m);
    assert.doesNotMatch(lib, /set -a|source "\$1"|export ENV_FILE/);
    for (const name of ['podman-up.sh', 'proof.sh', 'base.sh']) {
      const text = fs.readFileSync(path.join(UNIVERSES, '_template/deploy', name), 'utf8');
      assert.doesNotMatch(text, /bash "\$BASE\/deploy/, `${name} runs a base script with the environment it inherited`);
    }
    const install = fs.readFileSync(path.join(UNIVERSES, '_template/deploy/install-base.sh'), 'utf8');
    assert.match(install, /deploy\/settings\.sh/, 'a base without the reader is refused at install');
  });
});

describe('the secrets store may be universe-wide, shared with the kit', () => {
  test('a store outside the apps root is used as named; one inside a unit\'s directory is refused before anything is written', { skip: !canUnshare && 'no user namespace here' }, () => {
    const dir = tmp();
    try {
      const bin = path.join(dir, 'bin');
      fs.mkdirSync(bin);
      fs.writeFileSync(path.join(bin, 'podman'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
      fs.writeFileSync(path.join(bin, 'ss'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      const run = (store) => spawnSync('unshare', ['-r', 'bash', path.join(DEPLOY, 'podman-up.sh'), '--preflight'], {
        env: { PATH: toolPath(bin), ENV_FILE: '/dev/null', SHAPER_APPS_ROOT: `${dir}/univ/.state/units`, SHAPER_SECRETS_ROOT: store, SHAPER_REGISTRY: 'localhost', SHAPER_IMAGE_TAG: 'x' },
        encoding: 'utf8',
      });
      const shared = run(`${dir}/univ/.state/secrets`);
      assert.doesNotMatch(shared.stderr, /secrets store/, shared.stderr);
      assert.match(shared.stdout, new RegExp(`would generate the Vault API token \\(${dir}/univ/\\.state/secrets/vault/VAULT_TOKEN\\)`));
      const inside = run(`${dir}/univ/.state/units/vault/sav/secrets`);
      assert.equal(inside.status, 1);
      assert.match(inside.stderr, /the secrets store .* lies inside unit vault's directory/);
      assert.ok(!fs.existsSync(path.join(dir, 'univ')), 'a preflight writes nothing');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('a store named after birth takes the base\'s sources from the earlier default store: moved, value kept; divergent copies refused', { skip: !canUnshare && 'no user namespace here' }, () => {
    const dir = tmp();
    try {
      const bin = path.join(dir, 'bin');
      fs.mkdirSync(bin);
      fs.writeFileSync(path.join(bin, 'podman'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
      fs.writeFileSync(path.join(bin, 'ss'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      const apps = path.join(dir, 'univ/.state/units');
      const store = path.join(dir, 'univ/.state/secrets');
      const earlier = path.join(apps, '.state/secrets/vault');
      const seed = (value) => {
        fs.rmSync(earlier, { recursive: true, force: true });
        fs.mkdirSync(path.join(earlier, 'mount'), { recursive: true, mode: 0o700 });
        fs.writeFileSync(path.join(earlier, 'VAULT_TOKEN'), value, { mode: 0o600 });
        fs.writeFileSync(path.join(earlier, 'mount/VAULT_TOKEN'), value, { mode: 0o400 });
      };
      for (const d of [dir, path.join(dir, 'univ'), path.join(dir, 'univ/.state')]) fs.mkdirSync(d, { recursive: true, mode: 0o755 });
      const run = (...args) => spawnSync('unshare', ['-r', 'bash', path.join(DEPLOY, 'podman-up.sh'), ...args], {
        env: { PATH: toolPath(bin), ENV_FILE: '/dev/null', SHAPER_APPS_ROOT: apps, SHAPER_SECRETS_ROOT: store, SHAPER_REGISTRY: 'localhost', SHAPER_IMAGE_TAG: 'x' },
        encoding: 'utf8',
      });
      seed(SECRET);
      const preflight = run('--preflight');
      assert.match(preflight.stdout, /would move vault's VAULT_TOKEN into the store named .*, value kept/);
      assert.doesNotMatch(preflight.stdout, /would generate the Vault API token/, 'the token is moved, never regenerated');
      assert.ok(fs.existsSync(path.join(earlier, 'VAULT_TOKEN')) && !fs.existsSync(path.join(store, 'vault/VAULT_TOKEN')), 'a preflight moves nothing');
      // A run moves it before anything else (it then stops at the images this test has none of).
      const moved = run();
      assert.match(moved.stdout, /vault's VAULT_TOKEN moved into the store .*, value kept/, moved.stderr);
      assert.equal(fs.readFileSync(path.join(store, 'vault/VAULT_TOKEN'), 'utf8'), SECRET);
      assert.equal(fs.statSync(path.join(store, 'vault/VAULT_TOKEN')).mode & 0o777, 0o600);
      assert.ok(!fs.existsSync(path.join(apps, '.state/secrets')), 'the earlier store is gone, its copy with it');
      assert.ok(!moved.stdout.includes(SECRET) && !moved.stderr.includes(SECRET));
      // Two different values: refused, both kept, nothing printed.
      seed('d1'.repeat(32));
      const divergent = run();
      assert.equal(divergent.status, 1);
      assert.match(divergent.stderr, /two values of vault's VAULT_TOKEN differ: .* Keep the one the running unit uses, remove the other/);
      assert.equal(fs.readFileSync(path.join(store, 'vault/VAULT_TOKEN'), 'utf8'), SECRET);
      assert.equal(fs.readFileSync(path.join(earlier, 'VAULT_TOKEN'), 'utf8'), 'd1'.repeat(32));
      assert.ok(!divergent.stderr.includes(SECRET) && !divergent.stderr.includes('d1'.repeat(32)));
      // The same value: the earlier copy goes.
      seed(SECRET);
      const same = run();
      assert.match(same.stdout, /earlier copy of vault's VAULT_TOKEN removed/);
      assert.ok(!fs.existsSync(path.join(apps, '.state/secrets')));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('a restore dump for a unit the manifest does not declare is refused', { skip: !canUnshare && 'no user namespace here' }, () => {
    const dir = tmp();
    try {
      const bin = path.join(dir, 'bin');
      fs.mkdirSync(bin);
      fs.writeFileSync(path.join(bin, 'podman'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
      const r = spawnSync('unshare', ['-r', 'bash', path.join(DEPLOY, 'podman-up.sh'), '--preflight'], {
        env: { PATH: toolPath(bin), ENV_FILE: '/dev/null', SHAPER_APPS_ROOT: `${dir}/apps`, RESTORE_DUMP_valt: '/apps/valt/sav/restore/v.sql' },
        encoding: 'utf8',
      });
      assert.equal(r.status, 1);
      assert.match(r.stderr, /RESTORE_DUMP_valt names no unit of this universe/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('the proof gathers the values of every consumer of a shared store, the kit\'s included, nothing short', () => {
    const dir = tmp();
    try {
      const store = path.join(dir, 'univ/.state/secrets');
      const put = (rel, value) => { fs.mkdirSync(path.dirname(path.join(store, rel)), { recursive: true }); fs.writeFileSync(path.join(store, rel), value); };
      put('vault/VAULT_TOKEN', 'a'.repeat(64)); put('vault/mount/VAULT_TOKEN', 'a'.repeat(64));
      put('voice/DEEPGRAM_API_KEY', 'b'.repeat(40)); put('voice/mount/DEEPGRAM_API_KEY', 'b'.repeat(40));
      put('watch/SMTP_USER', 'short');
      const out = path.join(dir, 'values');
      const r = spawnSync('bash', ['-c', `set -uo pipefail; UNIVERSE=univ-minimal; APPS_ROOT='${dir}/univ/.state/units'; MANIFEST=/nonexistent; SHAPER_SECRETS_ROOT='${store}'; source '${path.join(DEPLOY, 'unit-probes.sh')}'; secret_values_file '${out}' vault`], { env: BASE_ENV, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(fs.readFileSync(out, 'utf8').trim().split('\n'), ['a'.repeat(64), 'b'.repeat(40)]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
