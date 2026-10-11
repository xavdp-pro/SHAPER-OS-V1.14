import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Intent: software/universes/univ-minimal/INTENT.md#secret-files
//
// SOL-DECISIONS-2 §M (lot BASE-SECRETS): every secret a unit consumes reaches
// it as a private file mounted alone and read-only, named by <NAME>_FILE —
// never as a value in the container's environment, where it sat in `podman
// inspect`, in PID 1's initial environment and in every child. These tests
// hold the parent and the proof's probes to that, without podman: the probes
// run against a fake /proc and a recorder standing in for podman; the parent's
// refusals run before podman is ever called. What a real container shows is
// the proof's business on the universe container (deploy/proof.sh).

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEPLOY = path.resolve(HERE, '../../../universes/univ-minimal/deploy');
const PROBES = path.join(DEPLOY, 'unit-probes.sh');
const SECRET = 'd4'.repeat(32);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'univ-minimal-secrets-'));
const canUnshare = spawnSync('unshare', ['-r', 'true']).status === 0;

/** Runs <script> in bash with unit-probes.sh sourced, as proof.sh sources it. */
function probe(script, { appsRoot = '/nonexistent', env = {}, unshare = false } = {}) {
  const body = `set -uo pipefail; UNIVERSE=univ-minimal; APPS_ROOT='${appsRoot}'; MANIFEST=/nonexistent; source '${PROBES}'; ${script}`;
  const [cmd, args] = unshare ? ['unshare', ['-r', 'bash', '-c', body]] : ['bash', ['-c', body]];
  return spawnSync(cmd, args, { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });
}

describe('the parent refuses a secret value in the settings file, by name', () => {
  const run = (lines) => {
    const dir = tmp();
    try {
      const envFile = path.join(dir, 'cfg-univ-minimal.env');
      fs.writeFileSync(envFile, `${lines.join('\n')}\n`);
      // An empty PATH beyond bash's own: the refusal must come before any tool.
      return spawnSync('bash', [path.join(DEPLOY, 'podman-up.sh'), '--preflight'], {
        env: { PATH: '/usr/bin:/bin', ENV_FILE: envFile, SHAPER_UNIVERSE: 'univ-minimal' }, encoding: 'utf8',
      });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };

  for (const name of ['VAULT_TOKEN', 'VAULT_MASTER_KEY', 'BRIDGE_AUTH_TOKEN', 'MYSQL_PASSWORD', 'DEEPGRAM_API_KEY']) {
    test(`${name}=<value> halts before anything runs, without printing the value`, () => {
      const r = run(['SHAPER_UNIVERSE=univ-minimal', `${name}=${SECRET}`]);
      assert.equal(r.status, 1);
      assert.match(r.stderr, new RegExp(`line 2: ${name} gives a secret a value — a settings file carries parameters only`));
      assert.ok(!r.stderr.includes(SECRET) && !r.stdout.includes(SECRET));
    });
  }

  test('an emptied line of one of the base\'s secrets and Vault\'s own reference pass; any other secret-shaped or *_FILE line is unknown', () => {
    const ok = run(['SHAPER_UNIVERSE=univ-minimal', 'VAULT_TOKEN=', "VAULT_MASTER_KEY=''", 'VAULT_TOKEN_FILE=/run/secrets/VAULT_TOKEN']);
    assert.doesNotMatch(ok.stderr, /settings .* are refused/);
    const unknown = run(['SHAPER_UNIVERSE=univ-minimal', "BRIDGE_AUTH_TOKEN=''", 'X_TOKEN_FILE=/run/secrets/X_TOKEN', 'PWD=/apps']);
    assert.equal(unknown.status, 1);
    for (const [line, key] of [[2, 'BRIDGE_AUTH_TOKEN'], [3, 'X_TOKEN_FILE'], [4, 'PWD']]) {
      assert.match(unknown.stderr, new RegExp(`line ${line}: ${key} is not a parameter of the base`));
    }
  });
});

// Wave 5 (decisions L and M together) and wave 7 (SOL-DECISIONS-4 §5): the
// renewal's timer runs renew-bootstraps.sh directly with the universe's
// ENV_FILE, install-renewal-timer.sh renders that file's name into the
// service, and a template universe's deploy/lib.sh reads the same file. All
// read it with the base's one reader (deploy/settings.sh), which refuses a
// secret value before anything is read into the run.
describe('the renewal and the template refuse a secret value in the settings file before reading it', () => {
  const UNIVERSES = path.resolve(DEPLOY, '../..');
  const scripts = {
    'renew-bootstraps.sh': (envFile) => spawnSync('bash', [path.join(DEPLOY, 'renew-bootstraps.sh')], {
      env: { PATH: '/usr/bin:/bin', ENV_FILE: envFile }, encoding: 'utf8',
    }),
    'install-renewal-timer.sh': (envFile, dir) => spawnSync('bash', [path.join(DEPLOY, 'install-renewal-timer.sh')], {
      env: { PATH: '/usr/bin:/bin', ENV_FILE: envFile, SYSTEMD_DIR: dir, NO_SYSTEMCTL: '1' }, encoding: 'utf8',
    }),
    '_template deploy/lib.sh': (envFile, dir) => {
      // A template universe with its base/ holding this revision's reader.
      const univ = path.join(dir, 'univ-minimal');
      fs.mkdirSync(path.join(univ, 'base/deploy'), { recursive: true });
      fs.copyFileSync(path.join(DEPLOY, 'settings.sh'), path.join(univ, 'base/deploy/settings.sh'));
      fs.writeFileSync(path.join(univ, 'manifest.json'), '{"universe":"univ-minimal"}');
      return spawnSync('bash', ['-c', `set -euo pipefail; UNIV='${univ}'; TAG='[t]'; source '${path.join(UNIVERSES, '_template/deploy/lib.sh')}'; ENV_FILE="$1" load_universe_env; echo loaded`, 'probe', envFile], {
        env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8',
      });
    },
  };
  for (const [name, run] of Object.entries(scripts)) {
    test(`${name}: VAULT_TOKEN=<value> halts by name, nothing rendered, the value never printed`, () => {
      const dir = tmp();
      try {
        const envFile = path.join(dir, 'cfg.env');
        fs.writeFileSync(envFile, `SHAPER_UNIVERSE=univ-minimal\nSHAPER_APPS_ROOT=${dir}/apps\nVAULT_TOKEN=${SECRET}\n`);
        const r = run(envFile, dir);
        assert.equal(r.status, 1, r.stderr);
        assert.match(r.stderr, /line 3: VAULT_TOKEN gives a secret a value — a settings file carries parameters only/);
        assert.ok(!r.stderr.includes(SECRET) && !r.stdout.includes(SECRET));
        assert.doesNotMatch(r.stdout, /loaded/);
        assert.deepEqual(fs.readdirSync(dir).filter((f) => f !== 'univ-minimal').sort(), ['cfg.env'], 'nothing written: no unit, no renewal state');
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
    test(`${name}: an emptied secret line and Vault's own reference pass the reader`, () => {
      const dir = tmp();
      try {
        const envFile = path.join(dir, 'cfg.env');
        fs.writeFileSync(envFile, `SHAPER_UNIVERSE=univ-minimal\nSHAPER_APPS_ROOT=${dir}/apps\nVAULT_TOKEN=\nVAULT_TOKEN_FILE=/run/secrets/VAULT_TOKEN\n`);
        const r = run(envFile, dir);
        assert.doesNotMatch(r.stderr, /are refused/);
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
  }
});

describe('path_protected: a store no account but root can replace', () => {
  test('a directory of an ordinary account is refused, and says which', () => {
    const dir = tmp();
    try {
      const r = probe(`path_protected '${dir}/secrets'`);
      assert.equal(r.status, 1);
      assert.match(r.stdout, new RegExp(`${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} belongs to uid ${process.getuid()}, not root`));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('root-owned and closed passes; a group- or other-writable ancestor does not; a sticky one does', { skip: !canUnshare && 'no user namespace here' }, () => {
    const dir = tmp();
    try {
      fs.mkdirSync(path.join(dir, 'open'), { mode: 0o777 });
      fs.chmodSync(path.join(dir, 'open'), 0o777);
      fs.mkdirSync(path.join(dir, 'sticky'), { mode: 0o1777 });
      fs.chmodSync(path.join(dir, 'sticky'), 0o1777);
      // In `unshare -r` this account is root, and the unmapped owners above
      // (/, /tmp) read as the overflow uid — the rehearsal's situation.
      const ok = probe(`path_protected '${dir}/store'`, { unshare: true });
      assert.equal(ok.status, 0, ok.stdout + ok.stderr);
      const open = probe(`path_protected '${dir}/open/store'`, { unshare: true });
      assert.equal(open.status, 1);
      assert.match(open.stdout, /open is writable by group or others \(mode 777\)/);
      assert.equal(probe(`path_protected '${dir}/sticky/store'`, { unshare: true }).status, 0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('the proof finds a secret value without printing it', () => {
  // A fake podman: inspect -f {{.State.Pid}} answers PID 1's host pid; a bare
  // inspect prints the document kept in $FAKE_INSPECT.
  const fakeBin = (dir) => {
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'podman'), `#!/bin/bash
if [[ "$1" == inspect && "$2" == -f && "$3" == '{{.State.Pid}}' ]]; then echo 101; exit 0; fi
if [[ "$1" == inspect && $# == 2 ]]; then cat "$FAKE_INSPECT"; exit 0; fi
exit 125
`, { mode: 0o755 });
    return bin;
  };
  // A fake /proc: pids 101-104 in the container's pid namespace, 999 outside.
  const fakeProc = (dir, { leakIn = null, unreadable = null } = {}) => {
    const proc = path.join(dir, 'proc');
    const procs = { 101: 'tini', 102: 'node', 103: 'mariadbd', 104: 'node', 999: 'sshd' };
    for (const [pid, comm] of Object.entries(procs)) {
      fs.mkdirSync(path.join(proc, pid, 'ns'), { recursive: true });
      fs.symlinkSync(pid === '999' ? 'pid:[4026531836]' : 'pid:[4026532999]', path.join(proc, pid, 'ns', 'pid'));
      const env = ['PATH=/usr/bin', 'VAULT_TOKEN_FILE=/run/secrets/VAULT_TOKEN', ...(leakIn === pid ? [`VAULT_TOKEN=${SECRET}`] : [])];
      fs.writeFileSync(path.join(proc, pid, 'environ'), `${env.join('\0')}\0`);
      fs.writeFileSync(path.join(proc, pid, 'cmdline'), `${comm}\0--flag\0`);
      if (unreadable === pid) fs.chmodSync(path.join(proc, pid, 'environ'), 0o000);
    }
    // A process outside the container holding the value is not the unit's.
    fs.writeFileSync(path.join(proc, '999', 'environ'), `SECRET_ELSEWHERE=${SECRET}\0`);
    return proc;
  };
  const values = (dir) => {
    const f = path.join(dir, 'values');
    fs.writeFileSync(f, `${SECRET}\n`, { mode: 0o600 });
    return f;
  };
  const withFakes = (fn, procOptions) => {
    const dir = tmp();
    try {
      const env = { PATH: `${fakeBin(dir)}:${process.env.PATH}` };
      return fn({ dir, env, proc: fakeProc(dir, procOptions), values: values(dir) });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };

  test('PID 1 and its pid namespace read clean: "<read> 0", exit 0', () => withFakes(({ env, proc, values: v }) => {
    const r = probe(`secrets_in_processes univ-minimal-ctr-vault '${v}' '${proc}'`, { env });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.stdout.trim(), '4 0', 'four processes of the container read, the fifth is not its');
  }));

  test('a value in one process\'s environment is found, and never printed', () => withFakes(({ env, proc, values: v }) => {
    const r = probe(`secrets_in_processes univ-minimal-ctr-vault '${v}' '${proc}'`, { env });
    assert.equal(r.status, 1);
    assert.equal(r.stdout.trim(), '4 1');
    assert.ok(!r.stdout.includes(SECRET) && !r.stderr.includes(SECRET));
  }, { leakIn: '101' }));

  test('a process whose environment cannot be read fails the probe, never counts as clean', { skip: process.getuid() === 0 && 'root reads every file' }, () => withFakes(({ env, proc, values: v }) => {
    const r = probe(`secrets_in_processes univ-minimal-ctr-vault '${v}' '${proc}'`, { env });
    assert.equal(r.status, 1);
    assert.match(r.stdout.trim(), / unknown$/);
  }, { unreadable: '103' }));

  test('podman inspect is searched whole, by fixed string', () => withFakes(({ dir, env, values: v }) => {
    const doc = path.join(dir, 'inspect.json');
    fs.writeFileSync(doc, JSON.stringify([{ Config: { Env: ['VAULT_TOKEN_FILE=/run/secrets/VAULT_TOKEN'], CreateCommand: ['podman', 'run'] } }]));
    assert.equal(probe(`secrets_in_inspect univ-minimal-ctr-vault '${v}'`, { env: { ...env, FAKE_INSPECT: doc } }).status, 0);
    fs.writeFileSync(doc, JSON.stringify([{ Config: { Env: [`VAULT_TOKEN=${SECRET}`] } }]));
    const r = probe(`secrets_in_inspect univ-minimal-ctr-vault '${v}'`, { env: { ...env, FAKE_INSPECT: doc } });
    assert.equal(r.status, 1);
    assert.ok(!r.stdout.includes(SECRET) && !r.stderr.includes(SECRET));
    assert.equal(probe(`secrets_in_inspect univ-minimal-ctr-vault '${dir}/empty'`, { env: { ...env, FAKE_INSPECT: doc } }).status, 1, 'no values: fails closed');
  }));

  test('secret_values_file gathers the store, the master key, bootstraps and passwords, root-only, nothing short', () => {
    const dir = tmp();
    try {
      const apps = path.join(dir, 'apps');
      const put = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, `${v}\n`); };
      put(path.join(apps, '.state/secrets/vault/VAULT_TOKEN'), 'a'.repeat(64));
      put(path.join(apps, '.state/secrets/vault/mount/VAULT_TOKEN'), 'a'.repeat(64));
      put(path.join(apps, 'vault/etc/vault/master.key'), 'b'.repeat(64));
      put(path.join(apps, 'vault/etc/identity/bootstrap'), 'c'.repeat(64));
      put(path.join(apps, 'queue/etc/mysql/localhost/passwd'), 'e'.repeat(64));
      put(path.join(dir, 'proof/identity/bootstrap'), 'f'.repeat(64));
      put(path.join(apps, '.state/secrets/queue/SHORT'), 'tiny');
      const out = path.join(dir, 'values');
      const r = probe(`secret_values_file '${out}' vault logger queue maestro`, { appsRoot: apps, env: { PROOF_STATE_DIR: path.join(dir, 'proof') } });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(r.stdout, '', 'nothing printed');
      assert.deepEqual(fs.readFileSync(out, 'utf8').trim().split('\n'), ['a', 'b', 'c', 'e', 'f'].map((c) => c.repeat(64)));
      assert.equal(fs.statSync(out).mode & 0o777, 0o600);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('the parent passes each secret as one read-only file and its reference', () => {
  const up = fs.readFileSync(path.join(DEPLOY, 'podman-up.sh'), 'utf8');
  test('secret_args mounts the unit\'s own copy at /run/secrets/<NAME> and names it by <NAME>_FILE, for every unit', () => {
    assert.match(up, /add -e "\$\{name\}_FILE=\$SECRETS_IN_UNIT\/\$name" -v "\$\(secret_mounted "\$slug" "\$name"\):\$SECRETS_IN_UNIT\/\$name:ro,Z"/);
    const spec = up.match(/^spec_args\(\) \{[\s\S]*?^\}$/m)[0];
    assert.match(spec, /secret_args "\$slug"/);
  });
  test('the copy is the consumer\'s, 0400, written from the source by cat — never a variable, never the store mounted', () => {
    const deliver = up.match(/^deliver_secrets\(\) \{[\s\S]*?^\}$/m)[0];
    assert.match(deliver, /cat -- "\$src" > "\$tmp"/);
    assert.match(deliver, /chown "\$uid:\$uid" "\$tmp"; chmod 0400 "\$tmp"/);
    assert.match(deliver, /\[\[ "\$\(stat -c '%u %a' -- "\$src"\)" == "0 600" \]\]/);
    assert.doesNotMatch(up, /-v "\$SECRETS_ROOT[^/]*:/, 'the store is never mounted');
    assert.doesNotMatch(up, /VAULT_TOKEN="\$\(cat/, 'the token is never read into the script');
  });
  test('Vault\'s token is declared once, for the parent and the proofs alike', () => {
    const r = probe('secrets_of vault; echo "|"; secrets_of logger; secrets_of queue; secrets_of maestro; echo "|$(secret_source vault VAULT_TOKEN)|$(secret_mounted vault VAULT_TOKEN)"', { appsRoot: '/apps' });
    assert.equal(r.stdout, 'VAULT_TOKEN\n|\n|/apps/.state/secrets/vault/VAULT_TOKEN|/apps/.state/secrets/vault/mount/VAULT_TOKEN\n');
    const custom = probe('secret_source vault VAULT_TOKEN', { appsRoot: '/apps', env: { SHAPER_SECRETS_ROOT: '/srv/univ/.state/secrets' } });
    assert.equal(custom.stdout, '/srv/univ/.state/secrets/vault/VAULT_TOKEN\n');
  });
});
