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
  parseEnvFile, portsInUse, portsInUseFromProc, manifestPorts, collisions, classifyCollisions,
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
//
// And two holes the review of that first fix opened:
//
//  * The grammar admitted any `KEY=value`, so `KEY=1; echo INJECTED` passed
//    both guards and the tail was still run by `source`. A value is now held
//    to the same standard as the key, in the gate and in the template alike.
//  * The port gate could not tell a foreign holder from the universe's OWN
//    brick left running by a previous podman-up.sh — which `--replace`s it.
//    The second deploy of a stack halted on its own vault, and the halt told
//    the human to disable "a service installed before Rule 11".

const execFileP = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOFTWARE = path.resolve(HERE, '../../..');
const PREFLIGHT = path.join(SOFTWARE, 'scripts/preflight.mjs');
const TEMPLATE = path.join(SOFTWARE, 'universes/_template/deploy/podman-up.sh');
// univ-base is the reference script an agent copies; it sourced its cfg file
// unread while the template and the gate held the file to the grammar, so a
// note in cfg-univ-base.env was still a command on the canonical cell.
const UNIV_BASE = path.join(SOFTWARE, 'universes/univ-base/deploy/podman-up.sh');
/** Every deploy script that sources a variables file, with the file paths it must source through the guard. */
const SOURCING_SCRIPTS = [
  { name: 'the template', file: TEMPLATE, sources: ['"$ENV_FILE"'] },
  { name: 'univ-base', file: UNIV_BASE, sources: ['"$ENV_FILE"', '"$UNIV/cfg-univ-base.env"'] },
];

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

// The lines below are fed to BOTH the JS grammar and the template's bash
// grammar (see the end of this file): the two must give the same verdict on
// every one of them, or a file the gate admits is one the deploy runs.
const VALUE_LINES = {
  admitted: [
    'PLAIN=abc',
    'URL=http://localhost:8640',
    'MODEL=anthropic/claude-x',
    'EMPTY=',
    'WITH_EQUALS=a=b',
    'DQ="a b; c"',
    'DQ_DOLLAR_END="pa$"',
    'DQ_EXPANSION="${HOME}"',
    'SQ=\'a;b $(x) `y`\'',
    'HASH_INSIDE=abc#not-a-comment',
  ],
  executed: [
    'KEY=1; echo INJECTED',
    'KEY=$(cmd)',
    'KEY=`cmd`',
    'KEY="$(cmd)"',
    'KEY="`cmd`"',
    'KEY=a b',
    'KEY=a>b',
    'KEY=a|b',
    'KEY=a && rm -rf x',
    'KEY=abc # a note after the value',
    'KEY={"a":1}',
  ],
};

test('a value is exported as written, or the line is refused — the injection the review showed', () => {
  const clean = parseEnvFile(VALUE_LINES.admitted.join('\n'));
  assert.deepEqual(clean.errors, [], JSON.stringify(clean.errors));
  assert.equal(clean.entries.DQ, '"a b; c"');
  assert.equal(clean.entries.HASH_INSIDE, 'abc#not-a-comment');

  // Until the review of the first fix, `KEY=1; echo INJECTED` passed the
  // grammar and `source` printed INJECTED. Every line here names an
  // execution or a reshaping bash would perform on the bare value.
  const { errors } = parseEnvFile(VALUE_LINES.executed.join('\n'));
  assert.deepEqual(errors.map((e) => e.line), VALUE_LINES.executed.map((_, i) => i + 1));
  for (const e of errors) assert.match(e.reason, /RUN or reshaped/);
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

test("a port held by this universe's own running container is not a collision — podman-up.sh replaces it", () => {
  // The second deploy of univ-demo-dev: its vault and queue are still up
  // from the first run, and the CT's old apt MariaDB holds 3306. `ss -p`
  // shows node/node/mariadbd — only `podman ps` separates the first two
  // from the third.
  const held = [
    { brick: 'brick-vault', port: 8610, process: 'node (pid 11)' },
    { brick: 'brick-queue', port: 8640, process: 'node (pid 12)' },
    { brick: 'brick-db', port: 3306, process: 'mariadbd (pid 13)' },
  ];
  const running = ['univ-demo-dev-vault', 'univ-demo-dev-queue', 'univ-other-dev-db'];
  const { own, foreign } = classifyCollisions(held, 'univ-demo-dev', running);
  assert.deepEqual(own.map((c) => c.container), ['univ-demo-dev-vault', 'univ-demo-dev-queue']);
  assert.deepEqual(foreign, [held[2]], 'another universe\'s container is not this one\'s own brick');
  // Nothing running at all: every holder is foreign, as on a first deploy.
  assert.deepEqual(classifyCollisions(held, 'univ-demo-dev', []).foreign, held);
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

/** A `podman` at the head of PATH whose `ps` lists exactly these containers. */
function podmanShim(names) {
  const dir = scratch();
  fs.writeFileSync(path.join(dir, 'podman'), `#!/usr/bin/env bash\nprintf '%s\\n' ${names.map((n) => `'${n}'`).join(' ')}\n`, { mode: 0o755 });
  return `${dir}:${process.env.PATH}`;
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

test("preflight passes a port held by the universe's own container from a previous run, and says why", async () => {
  const holder = net.createServer();
  await new Promise((r) => holder.listen(0, '127.0.0.1', r));
  const held = holder.address().port;
  try {
    await withRegistry(async (reg) => {
      const root = scratch();
      const universe = path.join(root, 'univ-demo-dev');
      fs.mkdirSync(universe);
      fs.writeFileSync(path.join(universe, 'manifest.json'), JSON.stringify({
        bricks: { 'brick-vault': { port: held } },
      }));
      // The container the template would have named for brick-vault of
      // univ-demo-dev is up: this is the retry-after-red-health path.
      const env = { SHAPER_REGISTRY: reg, SHAPER_IMAGE_TAG: 'v0-test', PATH: podmanShim(['univ-demo-dev-vault', 'univ-demo-dev-logger']) };
      const r = await runPreflight(env, ['--root', root, '--universe', universe]);
      assert.equal(r.code, 0, `the second deploy of a stack halted on its own vault:\n${r.output}`);
      assert.match(r.output, new RegExp(`OK\\s+ports\\s+port ${held} declared by brick-vault is held by this universe's own container univ-demo-dev-vault`));
      assert.doesNotMatch(r.output, /installed before Rule 11/);

      // The same port, the same running container, but under a different
      // universe's name: foreign, and the halt says no container of THIS
      // universe holds it.
      const other = await runPreflight(
        { ...env, PATH: podmanShim(['univ-other-dev-vault']) },
        ['--root', root, '--universe', universe],
      );
      assert.equal(other.code, 1, `another universe's container passed as this one's own brick:\n${other.output}`);
      assert.match(other.output, /no running container of this universe \(univ-demo-dev-\*\) holds it/);
    });
  } finally {
    holder.close();
  }
});

test('a flag given without its value is a halt that names what to provide, not a stack trace', async () => {
  await withRegistry(async (reg) => {
    const env = { SHAPER_REGISTRY: reg, SHAPER_IMAGE_TAG: 'v0-test' };
    const cases = [
      { args: ['--root', scratch(), '--universe'], flag: '--universe', what: 'the path to <slug>-dev' },
      { args: ['--root'], flag: '--root', what: 'the path to software/' },
    ];
    for (const { args, flag, what } of cases) {
      const r = await runPreflight(env, args);
      assert.equal(r.code, 1, `${flag} without a value did not halt cleanly:\n${r.output}`);
      assert.doesNotMatch(r.output, /TypeError|at .*preflight\.mjs/, `${flag} without a value crashed:\n${r.output}`);
      assert.ok(r.output.includes(`${flag} needs ${what}`), `the halt does not say what ${flag} needs:\n${r.output}`);
      assert.match(r.output, /DO NOT START/);
    }
  });
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

function guardOf({ name, file, sources }) {
  const script = fs.readFileSync(file, 'utf8');
  const fn = script.match(/^shaper_env_file_is_variables_only\(\) \{[\s\S]*?^\}$/m);
  assert.ok(fn, `${name} must define shaper_env_file_is_variables_only before it sources any .env`);
  for (const src of sources) {
    assert.ok(script.includes(`shaper_source_env ${src}`), `${name}: ${src} is sourced through the guard`);
  }
  const wrapper = script.match(/^shaper_source_env\(\) \{[\s\S]*?^\}$/m);
  assert.ok(wrapper, `${name} wraps every source in shaper_source_env`);
  assert.match(wrapper[0], /shaper_env_file_is_variables_only "\$1" \|\| exit 1/, `${name}: the wrapper halts before it sources`);
  assert.doesNotMatch(script.replace(fn[0], '').replace(wrapper[0], ''), /set -a; source/,
    `${name}: no .env reaches \`source\` without passing the guard`);
  return fn[0];
}

function templateGuard() {
  return guardOf(SOURCING_SCRIPTS[0]);
}

function runGuard(lines, guard = templateGuard()) {
  const tmp = scratch();
  const file = path.join(tmp, 'env');
  fs.writeFileSync(file, lines.join('\n') + '\n');
  // The same shell options as the template's own first line: the function
  // must survive -e, where a grep that selects nothing (exit 1) would end
  // the script if its status were not read explicitly.
  const probe = `set -euo pipefail\n${guard}\nshaper_env_file_is_variables_only "${file}"`;
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

// univ-base is held to the same lines as the template: it is the script an
// agent copies, and until this guard reached it, it sourced cfg-univ-base.env
// unread — a note there was a command on the canonical cell while the
// template and the gate refused it.
for (const script of SOURCING_SCRIPTS) {
  test(`${script.name} and the gate hold a value to the same grammar — a command in a value stops the deploy`, () => {
    const guard = guardOf(script);

    // Admitted by both, or the script would halt on a file the gate passed.
    const clean = runGuard(VALUE_LINES.admitted, guard);
    assert.equal(clean.code, 0, clean.stderr);

    // Refused by both, one line at a time, so that each shape is proven on its
    // own: until the review of the first fix `KEY=1; echo INJECTED` passed the
    // template's grep and `source` printed INJECTED.
    for (const line of VALUE_LINES.executed) {
      const r = runGuard([line], guard);
      assert.equal(r.code, 1, `${script.name} let source run: ${line}`);
      assert.match(r.stderr, /line 1:/);
    }
    const probe = execFileSync('bash', ['-c', `set -euo pipefail\n${guard}\nf=$(mktemp); echo 'KEY=1; echo INJECTED' > "$f"\nshaper_env_file_is_variables_only "$f" || { echo halted; exit 0; }\nset -a; source "$f"; set +a`], { encoding: 'utf8', stdio: 'pipe' });
    assert.equal(probe.trim(), 'halted', 'source ran the value');
  });
}
