import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  parseEnvFile, portsInUse, portsInUseFromProc, manifestPorts, collisions,
} from '../../../scripts/lib/preflight-checks.mjs';

// Intent: docs/proof/proof-rule-11-in-production.md#a-variables-file-holds-only-variables
// Intent: software/RULES.md#rule-11-declared-ports-are-free
//
// Non-regression (Rule 29) for two lessons of the first night Rule 11 ran in
// production (1 September 2026):
//
//  * A human note slipped into a variables file (`BACKOFFICE_ADMIN = email /
//    password`) was EXECUTED by `source`, and the deploy died before it could
//    print its own halt. Until then preflight filtered keys on `^[A-Z_]+=` and
//    silently dropped both the note and every key carrying a digit
//    (R2_BUCKET_NAME) — and the template sourced the file unread.
//
//  * A container born before Rule 11 kept an apt-installed MariaDB on 3306.
//    The podman brick, on `--network host`, crash-looped, and nothing outside
//    its own journal said why. No gate compared the manifest's ports with the
//    sockets already listening.

const execFileP = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOFTWARE = path.resolve(HERE, '../../..');
const PREFLIGHT = path.join(SOFTWARE, 'scripts/preflight.mjs');
const TEMPLATE = path.join(SOFTWARE, 'universes/_template/deploy/podman-up.sh');

// ---------------------------------------------------------------------------
// The pure functions, fed the exact shapes seen on terrain.

test('a variables file admits blank lines, comments and KEY=value — digits included', () => {
  const { entries, errors } = parseEnvFile([
    '# tokens for the demo',
    '',
    '   ',
    'VAULT_MASTER_KEY=abc',
    'R2_BUCKET_NAME=demo-bucket',
    'PORT_2=8610',
    'EMPTY=',
    'WITH_EQUALS=a=b',
  ].join('\n'));
  assert.deepEqual(errors, []);
  // Until this module existed the gate dropped R2_BUCKET_NAME on the floor:
  // `^[A-Z_]+=` has no room for a digit.
  assert.equal(entries.R2_BUCKET_NAME, 'demo-bucket');
  assert.equal(entries.PORT_2, '8610');
  assert.equal(entries.EMPTY, '');
  assert.equal(entries.WITH_EQUALS, 'a=b');
});

test('the note that killed the deploy is reported with its line number and its text', () => {
  const { errors } = parseEnvFile([
    'VAULT_TOKEN=abc',
    'BACKOFFICE_ADMIN = someone@example.test / a-password',
    'just a reminder for tomorrow',
    'lowercase=1',
  ].join('\n'));
  assert.deepEqual(errors.map((e) => e.line), [2, 3, 4]);
  assert.equal(errors[0].text, 'BACKOFFICE_ADMIN = someone@example.test / a-password');
  assert.match(errors[0].reason, /whitespace|command/);
  assert.match(errors[1].reason, /no "="/);
  assert.match(errors[2].reason, /not a KEY/);
});

test('listening ports are read from ss, with the process when ss could see it', () => {
  const inUse = portsInUse([
    'LISTEN 0      80           127.0.0.1:3306        0.0.0.0:*    users:(("mariadbd",pid=1234,fd=20))',
    'LISTEN 0      4096                 *:8610              *:*',
    'LISTEN 0      511               [::]:4440           [::]:*    users:(("node",pid=99,fd=18))',
    '',
  ].join('\n'));
  assert.deepEqual([...inUse.keys()].sort((a, b) => a - b), [3306, 4440, 8610]);
  assert.equal(inUse.get(3306).process, 'mariadbd (pid 1234)');
  assert.equal(inUse.get(8610).process, null);
  assert.equal(inUse.get(4440).process, 'node (pid 99)');
});

test('without ss, /proc/net/tcp is read: hex ports, only the LISTEN state', () => {
  const inUse = portsInUseFromProc([
    '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
    '   0: 0100007F:0CEA 00000000:0000 0A 00000000:00000000 00:00000000 00000000   106        0 12345 1 0000000000000000 100 0 0 10 0',
    '   1: 0100007F:21A2 0100007F:C350 01 00000000:00000000 00:00000000 00000000     0        0 12346 1 0000000000000000 20 4 30 10 -1',
    '   0: 00000000000000000000000000000000:1158 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12347 1 0000000000000000 100 0 0 10 0',
  ].join('\n'));
  assert.deepEqual([...inUse.keys()].sort((a, b) => a - b), [3306, 4440]);
  assert.equal(inUse.get(3306).process, null);
});

test('a declared port already held is a collision naming the brick, the port and the holder', () => {
  const declared = manifestPorts({
    bricks: { 'brick-vault': { port: 8610 }, 'brick-db': { port: 3306 }, 'brick-no-port': {} },
  });
  assert.deepEqual(declared, [{ brick: 'brick-vault', port: 8610 }, { brick: 'brick-db', port: 3306 }]);
  const inUse = portsInUse('LISTEN 0 80 127.0.0.1:3306 0.0.0.0:* users:(("mariadbd",pid=1234,fd=20))');
  assert.deepEqual(collisions(declared, inUse), [{ brick: 'brick-db', port: 3306, process: 'mariadbd (pid 1234)' }]);
  assert.deepEqual(collisions(declared, new Map()), []);
});

// ---------------------------------------------------------------------------
// The gate itself, end to end. The registry is served from this process so
// that the only red line is the one under test — which is also what makes
// these fail on the unpatched gate: it exited 0 on both fixtures.

async function withRegistry(fn) {
  const server = http.createServer((_, res) => res.end('{}'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    return await fn(`127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

async function runPreflight(env, args) {
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('SHAPER_')));
  try {
    const { stdout } = await execFileP(process.execPath, [PREFLIGHT, ...args], { env: { ...base, ...env } });
    return { code: 0, output: stdout };
  } catch (err) {
    return { code: err.code, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function scratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shaper-preflight-r11-'));
}

test('preflight halts on a .env line that is not a variable, and quotes it', async () => {
  await withRegistry(async (reg) => {
    const root = scratch();
    fs.writeFileSync(path.join(root, '.env'), [
      'VAULT_MASTER_KEY=0123456789abcdef',
      'BACKOFFICE_ADMIN = someone@example.test / a-password',
      'VAULT_TOKEN=fedcba9876543210',
      '',
    ].join('\n'));
    const r = await runPreflight({ SHAPER_REGISTRY: reg, SHAPER_IMAGE_TAG: 'v0-test' }, ['--root', root]);
    assert.equal(r.code, 1, `a human note in .env passed the start line:\n${r.output}`);
    assert.match(r.output, /line 2 is not a variable: "BACKOFFICE_ADMIN = someone@example\.test \/ a-password"/);
    assert.match(r.output, /goes behind #/);
  });
});

test('preflight halts when a port the manifest declares is already held, naming both', async () => {
  const holder = net.createServer();
  await new Promise((r) => holder.listen(0, '127.0.0.1', r));
  const held = holder.address().port;
  try {
    await withRegistry(async (reg) => {
      const root = scratch();
      const universe = path.join(root, 'univ-demo-dev');
      fs.mkdirSync(universe);
      fs.writeFileSync(path.join(universe, 'manifest.json'), JSON.stringify({
        bricks: { 'brick-db': { port: held }, 'brick-vault': { port: 8610 } },
      }));
      const r = await runPreflight(
        { SHAPER_REGISTRY: reg, SHAPER_IMAGE_TAG: 'v0-test' },
        ['--root', root, '--universe', universe],
      );
      assert.equal(r.code, 1, `a held port passed the start line:\n${r.output}`);
      assert.match(r.output, new RegExp(`port ${held} declared by brick-db is already held by`));
      assert.match(r.output, /--network host/);
    });
  } finally {
    holder.close();
  }
});

test('preflight reports free ports as free, and says so when no universe is named', async () => {
  // A port nobody holds: take one from the kernel, then release it.
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const free = probe.address().port;
  await new Promise((r) => probe.close(r));

  await withRegistry(async (reg) => {
    const root = scratch();
    const universe = path.join(root, 'univ-demo-dev');
    fs.mkdirSync(universe);
    fs.writeFileSync(path.join(universe, 'manifest.json'), JSON.stringify({ bricks: { 'brick-x': { port: free } } }));
    const env = { SHAPER_REGISTRY: reg, SHAPER_IMAGE_TAG: 'v0-test' };

    const named = await runPreflight(env, ['--root', root, '--universe', universe]);
    assert.match(named.output, /OK\s+ports\s+1 declared port\(s\) free/);
    assert.doesNotMatch(named.output, /FAIL\s+ports/);

    // No universe yet (Step 0c runs before Step 4.3): the check is skipped
    // out loud, never silently — the line tells the agent when to come back.
    const unnamed = await runPreflight(env, ['--root', root]);
    assert.match(unnamed.output, /SKIP\s+ports\s+no universe named/);
    assert.match(unnamed.output, /--universe/);
  });
});

test('preflight refuses a --universe whose manifest cannot be read', async () => {
  await withRegistry(async (reg) => {
    const root = scratch();
    const r = await runPreflight(
      { SHAPER_REGISTRY: reg, SHAPER_IMAGE_TAG: 'v0-test' },
      ['--root', root, '--universe', path.join(root, 'nowhere')],
    );
    assert.equal(r.code, 1);
    assert.match(r.output, /FAIL\s+ports\s+.*cannot be read as a manifest/);
  });
});

// ---------------------------------------------------------------------------
// The template that sources the file at deploy time runs the same grammar,
// in bash, before `source` gets a chance to execute anything.

function templateGuard() {
  const script = fs.readFileSync(TEMPLATE, 'utf8');
  const fn = script.match(/^shaper_env_file_is_variables_only\(\) \{[\s\S]*?^\}$/m);
  assert.ok(fn, 'the template must define shaper_env_file_is_variables_only before it sources any .env');
  assert.match(script, /shaper_source_env "\$ENV_FILE"/, 'the operator override file is sourced through the guard');
  const wrapper = script.match(/^shaper_source_env\(\) \{[\s\S]*?^\}$/m);
  assert.ok(wrapper, 'the template wraps every source in shaper_source_env');
  assert.match(wrapper[0], /shaper_env_file_is_variables_only "\$1" \|\| exit 1/, 'the wrapper halts before it sources');
  assert.doesNotMatch(script.replace(fn[0], '').replace(wrapper[0], ''), /set -a; source/,
    'no .env reaches `source` without passing the guard');
  return fn[0];
}

function runGuard(lines) {
  const tmp = scratch();
  const file = path.join(tmp, 'env');
  fs.writeFileSync(file, lines.join('\n') + '\n');
  const probe = `set -uo pipefail\n${templateGuard()}\nshaper_env_file_is_variables_only "${file}"`;
  try {
    execFileSync('bash', ['-c', probe], { encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, stderr: '' };
  } catch (err) {
    return { code: err.status, stderr: String(err.stderr) };
  }
}

test('the template stops before sourcing a file that carries a line bash would execute', () => {
  const r = runGuard(['VAULT_MASTER_KEY=abc', 'BACKOFFICE_ADMIN = someone@example.test / a-password']);
  assert.equal(r.code, 1, 'the note must stop the deploy before source runs it');
  assert.match(r.stderr, /line 2:BACKOFFICE_ADMIN = someone@example\.test/);
  assert.match(r.stderr, /would be EXECUTED by source/);
});

test('the template accepts a file of comments, blanks and variables — digits included', () => {
  const r = runGuard(['# demo', '', 'VAULT_MASTER_KEY=abc', 'R2_BUCKET_NAME=x', 'OPENCODE_MODEL=']);
  assert.equal(r.code, 0, r.stderr);
});
