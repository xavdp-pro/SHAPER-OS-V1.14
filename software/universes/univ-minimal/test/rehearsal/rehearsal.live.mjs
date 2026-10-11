// Intent: software/universes/univ-minimal/INTENT.md#rehearsal
// Rehearsal of univ-minimal's deploy path where podman cannot run: the real
// deploy/podman-up.sh and proof-effects.sh, with a fake podman (bin/podman)
// that runs each unit's real server.js as a process — the container's paths
// redirected (redirect.mjs), its database on one throwaway MariaDB provisioned
// by pkg-db's live runner — then the proof's identity helpers.
//
// It proves the birth order, the parent's registration, the identity wiring,
// the evidence path between the real services and the proof's authenticated
// calls. It proves NOTHING about the container shape: no supervisor, no
// MariaDB per container, one uid for every process (a user namespace maps
// only one), no Rule 26 inventory, no lifecycle or restore drill. It never
// qualifies a universe.
//
//   (cd software/packages/pkg-db && npm ci --omit=dev)   # mysql2, once
//   MARIADB_BASEDIR=<extracted MariaDB, holding usr/sbin/mariadbd and usr/bin/mariadb> \
//     node software/packages/pkg-db/test/live/run-live.mjs \
//     software/universes/univ-minimal/test/rehearsal/rehearsal.live.mjs
//
// Needs `unshare -r` (an unprivileged user namespace: podman-up.sh runs as
// root there), curl, and ports 8610, 8620, 8630 and 8640 free on 127.0.0.1.
// Without jq on the machine, jq-shim/ stands in for the subset these scripts use.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOFTWARE = path.resolve(HERE, '../../../..');
const UNIV = path.join(SOFTWARE, 'universes/univ-minimal');
const socket = process.env.SHAPER_LIVE_SOCKET;
const appsRoot = process.env.SHAPER_LIVE_APPS_ROOT;
const workDir = process.env.SHAPER_LIVE_WORKDIR;
const fakeState = path.join(workDir, 'fake');
const proofDir = path.join(workDir, 'proof');
const mariadb = path.join(process.env.MARIADB_BASEDIR || '', 'usr/bin/mariadb');
const hasJq = spawnSync('sh', ['-c', 'command -v jq'], { encoding: 'utf8' }).status === 0;

const env = {
  ...process.env,
  PATH: [path.join(HERE, 'bin'), ...(hasJq ? [] : [path.join(HERE, 'jq-shim')]), process.env.PATH].join(':'),
  FAKE_STATE: fakeState, FAKE_SOCKET: socket, FAKE_SOFTWARE: SOFTWARE, FAKE_MARIADB: mariadb, REHEARSAL_SOFTWARE: SOFTWARE,
  SHAPER_UNIVERSE: 'univ-minimal', SHAPER_APPS_ROOT: appsRoot,
  SHAPER_REGISTRY: 'localhost', SHAPER_IMAGE_TAG: 'rehearsal',
  PROOF_STATE_DIR: proofDir, ENV_FILE: '/nonexistent',
};
delete env.VAULT_TOKEN;
const sql = (db, q) => execFileSync(mariadb, ['--no-defaults', '-S', socket, '-uroot', '-N', '-B', ...(db ? [db] : []), '-e', q], { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 60000) { const t = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > t) return v; await sleep(500); } }
const up = (...args) => spawnSync('unshare', ['-r', 'bash', path.join(UNIV, 'deploy/podman-up.sh'), ...args], { env, encoding: 'utf8', timeout: 600000 });
const identities = () => sql('vault', "SELECT GROUP_CONCAT(CONCAT(unit_id, ':', incarnation, ':', epoch) ORDER BY unit_id) FROM unit_identities");
const pids = () => Object.fromEntries(['vault', 'logger', 'queue', 'maestro'].map((s) => [s, JSON.parse(read(path.join(fakeState, `univ-minimal-ctr-${s}.json`))).pid]));
const incarnationOf = (s) => JSON.parse(read(path.join(fakeState, `univ-minimal-ctr-${s}.json`))).env.SHAPER_UNIT_INCARNATION;
// The proof's helpers, sourced exactly as proof.sh sources them.
const probe = (script) => spawnSync('bash', ['-c', `set -uo pipefail; UNIVERSE=univ-minimal; APPS_ROOT='${appsRoot}'; MANIFEST='${UNIV}/manifest.json'; source '${UNIV}/deploy/unit-probes.sh'; ${script}`], { env, encoding: 'utf8', timeout: 180000 });
const read = (p) => fs.readFileSync(p, 'utf8');
const recordsDir = path.join(appsRoot, 'vault/etc/vault/registration/records');
const renewalDir = path.join(appsRoot, 'vault/etc/vault/registration/renewal');
const renew = (extra = {}) => spawnSync('unshare', ['-r', 'bash', path.join(UNIV, 'deploy/renew-bootstraps.sh')], { env: { ...env, ...extra }, encoding: 'utf8', timeout: 120000 });
const expiries = () => Object.fromEntries(sql('vault', "SELECT CONCAT(unit_id, ' ', TIMESTAMPDIFF(SECOND, '1970-01-01', bootstrap_expires_at)) FROM unit_identities ORDER BY unit_id")
  .split('\n').map((l) => l.split(' ')).map(([u, t]) => [u, Number(t)]));
const lastRun = () => JSON.parse(read(path.join(renewalDir, 'last.json')));
// SOL-DECISIONS-2 §M: the secrets store, root-only, and Vault's own copy of its token.
const store = path.join(appsRoot, '.state/secrets');
const tokenSource = path.join(store, 'vault/VAULT_TOKEN');
const tokenCopy = path.join(store, 'vault/mount/VAULT_TOKEN');
const legacyToken = path.join(appsRoot, 'vault/etc/vault/api-token');
const SECRET_NAME = /(^|_)(TOKEN|SECRET|PASSWORD|PASSWD|PWD|PASSPHRASE|API_KEY|MASTER_KEY|PRIVATE_KEY|ENCRYPTION_KEY|SECRET_KEY|ACCESS_KEY)$/;
const secretsSeen = () => {
  const out = [];
  for (const p of [tokenSource, path.join(appsRoot, 'vault/etc/vault/master.key'),
    ...['vault', 'queue', 'maestro'].map((s) => path.join(appsRoot, s, 'etc/identity/bootstrap')), path.join(proofDir, 'identity/bootstrap'),
    ...['vault', 'logger', 'queue', 'maestro'].map((s) => path.join(appsRoot, s, 'etc/mysql/localhost/passwd'))]) {
    if (fs.existsSync(p)) out.push(read(p).trim());
  }
  return out;
};

let first, birthPreflight;
before(() => { birthPreflight = up('--preflight'); first = up(); });
after(() => {
  for (const f of fs.existsSync(fakeState) ? fs.readdirSync(fakeState).filter((x) => x.endsWith('.json')) : []) {
    spawnSync(path.join(HERE, 'bin/podman'), ['stop', f.slice(0, -5)], { env });
  }
});

test('--preflight on an empty universe says what a birth would do, with no error, and leaves nothing behind', () => {
  assert.equal(birthPreflight.status, 0, birthPreflight.stderr);
  assert.equal(birthPreflight.stderr, '', 'no error on standard error (CT121: the token digest read a file not yet written)');
  assert.match(birthPreflight.stdout, /would generate the Vault API token/);
  for (const s of ['vault', 'logger', 'queue', 'maestro']) assert.match(birthPreflight.stdout, new RegExp(`${s}\\s+recreate\\s+no container`));
});

test('podman-up births the universe: Vault first, registrations applied by root, then Logger, Queue and Maestro', () => {
  assert.equal(first.status, 0, `podman-up failed:\n${first.stdout}\n${first.stderr}`);
  const out = first.stdout;
  const order = ['layer 0 — brick-vault', 'OK   vault', 'OK   identities — 4 incarnations', 'layer 1 — brick-logger', 'OK   logger', 'layer 2 — brick-queue', 'OK   queue', 'layer 3 — brick-maestro', 'OK   maestro', 'is up'];
  let at = -1;
  for (const marker of order) { const i = out.indexOf(marker, at + 1); assert.ok(i > at, `"${marker}" after position ${at}:\n${out}`); at = i; }
  process.stdout.write(`# podman-up output:\n${out.split('\n').map((l) => `#   ${l}`).join('\n')}\n`);
});

test('the universe identity is one UUID, recorded once beside the master key', () => {
  const id = read(path.join(appsRoot, 'vault/etc/vault/universe-id')).trim();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  for (const name of ['vault', 'logger', 'queue', 'maestro']) {
    const st = JSON.parse(read(path.join(fakeState, `univ-minimal-ctr-${name}.json`)));
    assert.equal(st.env.SHAPER_UNIVERSE_ID, id, `${name} runs in the universe`);
  }
});

test('the pin is the parent derivation, delivered to the units that verify; bootstraps are owner-only files', () => {
  const pin = read(path.join(appsRoot, 'vault/etc/vault/vault-signing.pub'));
  assert.match(pin, /^-----BEGIN PUBLIC KEY-----\n/);
  for (const s of ['logger', 'queue', 'maestro']) assert.equal(read(path.join(appsRoot, s, 'etc/identity/vault-signing.pub')), pin);
  assert.ok(!fs.existsSync(path.join(appsRoot, 'vault/etc/identity/vault-signing.pub')), 'Vault verifies with its own key');
  for (const s of ['vault', 'queue', 'maestro']) {
    const f = path.join(appsRoot, s, 'etc/identity/bootstrap');
    assert.equal(fs.statSync(f).mode & 0o777, 0o600);
    assert.match(read(f), /^[0-9a-f]{64}$/);
  }
  assert.ok(!fs.existsSync(path.join(appsRoot, 'logger/etc/identity/bootstrap')), 'Logger holds no credential');
  assert.equal(fs.statSync(path.join(proofDir, 'identity/bootstrap')).mode & 0o777, 0o600);
});

test('Vault holds the four registrations by digest; the statements carry no bootstrap value', () => {
  const statements = read(path.join(appsRoot, 'vault/etc/vault/registration/registration.sql'));
  for (const f of [...['vault', 'queue', 'maestro'].map((s) => path.join(appsRoot, s, 'etc/identity/bootstrap')), path.join(proofDir, 'identity/bootstrap')]) {
    const token = read(f).trim();
    assert.ok(!statements.includes(token), `${f} value is in the statements`);
    assert.ok(statements.includes(createHash('sha256').update(token).digest('hex')), `${f} digest is registered`);
  }
  const rows = sql('vault', "SELECT CONCAT(unit_id, ' ', incarnation, ' ', epoch, ' ', grants) FROM unit_identities ORDER BY unit_id").split('\n');
  assert.equal(rows.length, 4, rows.join('\n'));
  const grants = {
    vault: '{"logger":["logger:ingest"]}',
    queue: '{"logger":["logger:ingest"]}',
    maestro: '{"logger":["logger:ingest"],"queue":["queue:enqueue","queue:read"]}',
    proof: '{"logger":["logger:ingest","logger:read:own"],"queue":["queue:enqueue","queue:read","queue:claim","queue:attempt"],"maestro":["maestro:read","maestro:admin"]}',
  };
  for (const r of rows) {
    const [unit, incarnation, epoch, granted] = r.split(' ');
    // A random incarnation per recreated unit, never a clock reading (DECISIONS §B).
    assert.match(incarnation, new RegExp(`^${unit}-[0-9a-f]{16}$`));
    assert.equal(epoch, '1');
    assert.equal(granted, grants[unit], `${unit}'s grants, explicit and separate`);
  }
});

test('no secret value reaches a podman command line or the deploy output', () => {
  const argvLog = read(path.join(fakeState, 'argv.log'));
  for (const secret of secretsSeen()) {
    assert.ok(secret.length >= 32);
    assert.ok(!argvLog.includes(secret), 'a secret is on a podman command line');
    assert.ok(!first.stdout.includes(secret) && !first.stderr.includes(secret), 'a secret is in the deploy output');
  }
});

test('every secret a unit consumes is one read-only file named by <NAME>_FILE; no unit has a secret in its environment (SOL-DECISIONS-2 §M)', () => {
  assert.equal(fs.statSync(store).mode & 0o777, 0o700, 'the store is root-only');
  assert.equal(fs.statSync(path.join(store, 'vault')).mode & 0o777, 0o700);
  assert.equal(fs.statSync(tokenSource).mode & 0o777, 0o600, 'the source is root-only');
  assert.match(read(tokenSource).trim(), /^[0-9a-f]{64}$/);
  assert.equal(fs.statSync(tokenCopy).mode & 0o777, 0o400, "vault's copy: 0400 (its owner is vault's uid on a real host)");
  assert.equal(read(tokenCopy), read(tokenSource));
  assert.ok(!fs.existsSync(legacyToken), 'no token beside the master key any more');
  for (const s of ['vault', 'logger', 'queue', 'maestro']) {
    const st = JSON.parse(read(path.join(fakeState, `univ-minimal-ctr-${s}.json`)));
    const named = Object.entries(st.env).filter(([k, v]) => SECRET_NAME.test(k) && v !== '').map(([k]) => k);
    assert.deepEqual(named, [], `${s}'s container environment carries a secret value`);
    for (const secret of secretsSeen()) assert.ok(!JSON.stringify(st.env).includes(secret), `${s}'s environment holds a secret value`);
    const secretMounts = st.spec.mounts.filter(([dst, src]) => dst.startsWith('/run/secrets/') || src.startsWith(store));
    if (s === 'vault') {
      assert.equal(st.env.VAULT_TOKEN_FILE, '/run/secrets/VAULT_TOKEN');
      assert.deepEqual(secretMounts, [['/run/secrets/VAULT_TOKEN', tokenCopy]], 'one file, the unit\'s own copy, never the store');
    } else {
      assert.deepEqual(secretMounts, [], `${s} consumes no secret file`);
    }
  }
  const argvLog = read(path.join(fakeState, 'argv.log')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  for (const argv of argvLog) {
    argv.forEach((a, i) => {
      if (argv[i - 1] === '-e') assert.ok(!SECRET_NAME.test(a.split('=')[0]), `podman ${argv[0]} passes ${a.split('=')[0]} into an environment`);
      if (argv[i - 1] === '-v') assert.ok(!a.startsWith(`${store}:`) && !a.startsWith(`${store}/vault:`), 'the store is mounted');
    });
  }
});

// Work for each credential holder's outbox: a secret written and removed, a job.
const oweEvidence = (tag) => probe(`
  H='Content-Type: application/json'
  vault_curl -sf -o /dev/null -X POST -H "$H" -d '{"data":"owe"}' "http://127.0.0.1:8610/api/secret/rehearsal/${tag}" && echo vault=ok
  job="$(queue_curl -s -X POST http://127.0.0.1:8640/api/jobs -H "$H" -d '{"type":"rehearsal.owe","payload":{},"idempotencyKey":"owe-${tag}"}' | jq -r '.job.id')"
  [[ "$(queue_complete "$job")" == 200 ]] && echo queue=ok
`);

test('an idle unit asks Vault for nothing: Queue, owing no evidence, holds no credential (DECISIONS §C)', async () => {
  await sleep(8000); // four relay intervals
  assert.equal(sql('vault', "SELECT COUNT(*) FROM unit_credentials WHERE unit_id='queue'"), '0', 'Queue obtained a credential with nothing to deliver');
  // Maestro owes its MAESTRO_STARTED at start, so it did ask; Vault then owes
  // the evidence of that issuance, so it asked once for itself.
  assert.ok(await until(() => Number(sql('vault', "SELECT COUNT(*) FROM unit_credentials WHERE unit_id='maestro'")) >= 1));
  assert.ok(Number(sql('vault', "SELECT COUNT(*) FROM event_outbox WHERE JSON_VALUE(body, '$.event') = 'UNIT_CREDENTIAL_ISSUED' AND JSON_VALUE(body, '$.data.unit') = 'maestro'")) >= 1);
});

test('every credential holder obtains a credential for its current incarnation once it owes evidence, and its evidence reaches Logger', async () => {
  const work = oweEvidence('first');
  assert.match(work.stdout, /vault=ok[\s\S]*queue=ok/, work.stderr);
  for (const s of ['vault', 'queue', 'maestro']) {
    const inc = JSON.parse(read(path.join(fakeState, `univ-minimal-ctr-${s}.json`))).env.SHAPER_UNIT_INCARNATION;
    const n = await until(() => Number(sql('vault', `SELECT COUNT(*) FROM unit_credentials WHERE unit_id='${s}' AND incarnation='${inc}' AND audience='logger'`)) >= 1);
    assert.ok(n, `${s} holds no credential for ${inc}`);
  }
  const owed = await until(() => sql('maestro', 'SELECT COUNT(*) FROM event_outbox WHERE receipt IS NULL') === '0'
    && Number(sql('maestro', 'SELECT COUNT(*) FROM event_outbox')) >= 1, 90000);
  assert.ok(owed, 'Maestro still owes evidence');
  assert.ok(Number(sql('logger', "SELECT COUNT(*) FROM ingest_keys WHERE pod='maestro'")) >= 1);
  assert.ok(Number(sql('logger', "SELECT COUNT(*) FROM events WHERE pod='vault' AND event='UNIT_CREDENTIAL_ISSUED'")) >= 1, 'Vault relays its own issuance evidence');
});

test("the proof's helpers: Logger refuses anonymity, the proof writes and reads as itself, evidence is read from both databases", () => {
  const r = probe(`
    L="http://127.0.0.1:8620"; H='Content-Type: application/json'
    echo "anon=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$L/api/ingest" -H "$H" -d '{"event":"X"}')"
    id="$(logger_curl -s -X POST "$L/api/ingest" -H "$H" -d '{"pod":"proof","event":"REHEARSAL","correlationId":"reh-1","sourceEventId":"reh/1","data":{"n":1}}' | jq -r '.record.id')"
    echo "ingested=$id"
    echo "readback=$(logger_curl -s "$L/api/events/last?correlationId=reh-1&event=REHEARSAL" | jq -r '.events[0].id')"
    echo "foreign=$(logger_curl -s -o /dev/null -w '%{http_code}' "$L/api/events/last?pod=queue")"
    since="$(rootsql vault -e 'SELECT UTC_TIMESTAMP(3)')"
    vault_curl -sf -o /dev/null -X POST -H "$H" -d '{"data":"rehearsal-value"}' "http://127.0.0.1:8610/api/secret/rehearsal/one" && echo vault-write=ok
    echo "vault-read=$(vault_curl -sf "http://127.0.0.1:8610/api/secret/rehearsal/one" | jq -r .data)"
    evidence_delivered vault "JSON_VALUE(body, '\\$.event') = 'SECRET_STORED' AND JSON_VALUE(body, '\\$.data.secretRef') = 'rehearsal/one' AND created_at >= '$since'" && echo vault-evidence=ok
    job="$(queue_curl -s -X POST http://127.0.0.1:8640/api/jobs -H "$H" -d '{"type":"rehearsal.ping","payload":{},"idempotencyKey":"reh-job-1"}' | jq -r '.job.id')"
    queue_complete "$job" >/dev/null
    evidence_delivered queue "JSON_VALUE(body, '\\$.correlationId') = '$job'" && echo queue-evidence=ok
  `);
  const out = r.stdout;
  process.stdout.write(`# helpers:\n${out.split('\n').map((l) => `#   ${l}`).join('\n')}\n# stderr: ${r.stderr.slice(0, 2000)}\n`);
  assert.match(out, /^anon=401$/m);
  const id = /^ingested=(\S+)$/m.exec(out)?.[1];
  assert.match(id || '', /^[0-9a-f-]{36}$/);
  assert.match(out, new RegExp(`^readback=${id}$`, 'm'));
  assert.match(out, /^foreign=403$/m);
  assert.match(out, /^vault-write=ok$/m);
  assert.match(out, /^vault-read=rehearsal-value$/m);
  assert.match(out, /^vault-evidence=ok$/m);
  assert.match(out, /^queue-evidence=ok$/m);
  assert.equal(sql('logger', `SELECT pod FROM events WHERE id='${id}'`), 'proof');
  for (const secret of secretsSeen()) assert.ok(!out.includes(secret) && !r.stderr.includes(secret));
});

test('a re-run that recreates nothing keeps every container, incarnation and epoch (DECISIONS §B)', () => {
  const before = { rows: identities(), pids: pids(), records: fs.readdirSync(path.join(appsRoot, 'vault/etc/vault/registration/records')).sort() };
  assert.deepEqual(before.records, ['maestro.json', 'proof.json', 'queue.json', 'vault.json']);
  const again = up();
  assert.equal(again.status, 0, `${again.stdout}\n${again.stderr}`);
  for (const s of ['vault', 'logger', 'queue', 'maestro']) assert.match(again.stdout, new RegExp(`KEEP ${s} — runs as declared`));
  assert.match(again.stdout, /identities — nothing to register/);
  assert.equal(identities(), before.rows, 'no epoch moved, no incarnation changed');
  assert.deepEqual(pids(), before.pids, 'no container was replaced');
});

test('a universe whose token sat beside the master key moves it into the store, value kept, and keeps every unit', () => {
  const before = { rows: identities(), pids: pids(), token: read(tokenSource) };
  fs.renameSync(tokenSource, legacyToken);
  const moved = up();
  assert.equal(moved.status, 0, `${moved.stdout}\n${moved.stderr}`);
  assert.match(moved.stdout, /Vault API token moved into the secrets store \(.*\), value kept/);
  assert.ok(!fs.existsSync(legacyToken));
  assert.equal(read(tokenSource), before.token, 'the same value');
  for (const s of ['vault', 'logger', 'queue', 'maestro']) assert.match(moved.stdout, new RegExp(`KEEP ${s} — runs as declared`));
  assert.deepEqual(pids(), before.pids, 'nothing restarted');
  assert.equal(identities(), before.rows);
  const call = probe(`vault_curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8610/api/secrets`);
  assert.equal(call.stdout, '200', 'the proof and the running Vault still agree on the token');
  for (const secret of secretsSeen()) assert.ok(!moved.stdout.includes(secret) && !moved.stderr.includes(secret));
  // An earlier copy left beside the store's: removed when it is the same
  // value; two different tokens halt, nothing guessed.
  fs.writeFileSync(legacyToken, `${'0'.repeat(64)}\n`, { mode: 0o600 });
  const differ = up();
  assert.equal(differ.status, 1);
  assert.match(differ.stderr, /two Vault API tokens differ/);
  assert.ok(!differ.stderr.includes(before.token.trim()) && !differ.stderr.includes('0'.repeat(64)));
  fs.copyFileSync(tokenSource, legacyToken);
  const same = up();
  assert.equal(same.status, 0, `${same.stdout}\n${same.stderr}`);
  assert.match(same.stdout, /earlier copy of the Vault API token removed/);
  assert.ok(!fs.existsSync(legacyToken));
  assert.deepEqual(pids(), before.pids, 'nothing restarted');
});

test('--preflight says what a run would do and changes nothing', () => {
  const regDir = path.join(appsRoot, 'vault/etc/vault/registration');
  const snapshot = () => ({ rows: identities(), pids: pids(),
    files: fs.readdirSync(regDir, { recursive: true }).sort().map((f) => [f, fs.statSync(path.join(regDir, f)).mtimeMs]) });
  const before = snapshot();
  const pre = up('--preflight');
  assert.equal(pre.status, 0, `${pre.stdout}\n${pre.stderr}`);
  assert.match(pre.stdout, /preflight — nothing is written, registered or started/);
  for (const s of ['vault', 'queue', 'maestro']) assert.match(pre.stdout, new RegExp(`${s}\\s+keep\\s+runs as declared — incarnation ${s}-[0-9a-f]{16} kept`));
  assert.match(pre.stdout, /logger\s+keep/);
  assert.match(pre.stdout, /proof\s+keep\s+its identity is live in Vault/);
  const forced = up('--preflight', '--recreate', 'queue');
  assert.match(forced.stdout, /queue\s+recreate\s+asked \(--recreate\)/);
  // What a unit reads only at start is part of its specification: Maestro's schedule.
  const schedule = path.join(UNIV, 'task-schedule.json');
  const declared = read(schedule);
  fs.writeFileSync(schedule, `${declared}\n`);
  try {
    assert.match(up('--preflight').stdout, /maestro\s+recreate\s+another image or run specification/);
  } finally {
    fs.writeFileSync(schedule, declared);
  }
  assert.match(up('--preflight').stdout, /maestro\s+keep/);
  assert.deepEqual(snapshot(), before, 'nothing written, registered or started');
});

test('--recreate <slug> recreates that unit alone, under a new incarnation; the others keep theirs', () => {
  const before = { vault: incarnationOf('vault'), maestro: incarnationOf('maestro'), queue: incarnationOf('queue'), pids: pids() };
  const r = up('--recreate', 'queue');
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /NEW {2}queue — asked \(--recreate\)/);
  assert.notEqual(incarnationOf('queue'), before.queue);
  assert.match(incarnationOf('queue'), /^queue-[0-9a-f]{16}$/);
  assert.deepEqual([incarnationOf('vault'), incarnationOf('maestro')], [before.vault, before.maestro]);
  const now = pids();
  assert.notEqual(now.queue, before.pids.queue);
  assert.deepEqual([now.vault, now.logger, now.maestro], [before.pids.vault, before.pids.logger, before.pids.maestro]);
  assert.match(r.stdout, /bootstraps delivered: queue$/m, 'only queue registered');
});

test('the parent\'s renewal extends every live bootstrap by 30 days, keeping incarnations, epochs and containers (DECISIONS §D)', () => {
  const before = { expiries: expiries(), rows: identities(), pids: pids() };
  // Every identity is due when the window is 40 days: a drill of the daily run.
  const forced = renew({ RENEW_WITHIN_SECONDS: String(40 * 86400) });
  assert.equal(forced.status, 0, `${forced.stdout}\n${forced.stderr}`);
  for (const u of ['maestro', 'proof', 'queue', 'vault']) {
    assert.match(forced.stdout, new RegExp(`^  ${u} +renewed `, 'm'));
    assert.equal(expiries()[u] - before.expiries[u], 30 * 86400, `${u} extended by 30 days`);
  }
  assert.match(forced.stdout, /4 identities checked, 4 renewed .* none blocked \(renewal [0-9a-f-]{36}\)/);
  assert.equal(identities(), before.rows, 'no incarnation, no epoch changed');
  assert.deepEqual(pids(), before.pids, 'nothing restarted');
  for (const secret of secretsSeen()) assert.ok(!forced.stdout.includes(secret) && !forced.stderr.includes(secret));
  assert.equal(Number(sql('vault', "SELECT COUNT(*) FROM event_outbox WHERE JSON_VALUE(body, '$.event') = 'UNIT_BOOTSTRAP_RENEWED'")), 4, 'one proof per renewal');
  const last = lastRun();
  assert.deepEqual([last.outcome, last.exit, last.renewed, last.blocked, last.units.length], ['complete', 0, 4, 0, 4]);
  assert.equal(fs.statSync(path.join(renewalDir, 'last.json')).mode & 0o777, 0o600);
  assert.ok(!fs.existsSync(path.join(renewalDir, 'unsettled')), 'the run is settled');
  // The daily run, the same day: nothing is due.
  const daily = renew();
  assert.equal(daily.status, 0, daily.stderr);
  assert.equal((daily.stdout.match(/ current /g) || []).length, 4);
  // One parent at a time: while another holds the lock, the renewal waits, then halts.
  const holder = spawn('flock', [path.join(appsRoot, 'vault/etc/vault/parent.lock'), 'sleep', '5'], { stdio: 'ignore' });
  try {
    spawnSync('sleep', ['0.3']);
    const locked = renew({ PARENT_LOCK_WAIT_SECONDS: '1' });
    assert.equal(locked.status, 1);
    assert.match(locked.stderr, /HALTED: another parent run holds/);
  } finally {
    holder.kill();
  }
});

test('decision L: a mixed run renews the consistent identities, leaves the blocked ones unchanged, and fails visibly while Logger is down', async () => {
  const record = (u) => path.join(recordsDir, `${u}.json`);
  const kept = { queue: read(record('queue')), maestro: read(record('maestro')) };
  // queue: its record no longer matches Vault (inconsistent); maestro: its record is gone (missing).
  fs.writeFileSync(record('queue'), kept.queue.replace(/"bootstrapDigest":"[0-9a-f]{64}"/, `"bootstrapDigest":"${'0'.repeat(64)}"`));
  fs.renameSync(record('maestro'), `${record('maestro')}.aside`);
  // Vault's relay cannot reach Logger: the alert must not depend on it.
  spawnSync(path.join(HERE, 'bin/podman'), ['stop', 'univ-minimal-ctr-logger'], { env });
  try {
    const now = expiries();
    const rows = identities();
    const mixed = renew({ RENEW_WITHIN_SECONDS: String(80 * 86400) });
    assert.equal(mixed.status, 2, `partial exits 2, which fails the timer's unit:\n${mixed.stdout}\n${mixed.stderr}`);
    assert.match(mixed.stdout, /^  vault +renewed /m);
    assert.match(mixed.stdout, /^  proof +renewed /m);
    assert.match(mixed.stdout, /^  queue +inconsistent +bootstrap expires \S+ \(digest\)$/m);
    assert.match(mixed.stdout, /^  maestro +missing +bootstrap expires \S+ \(no-record\)$/m);
    assert.match(mixed.stderr, /PARTIAL: univ-minimal \(\S+\): 2 renewed, 2 blocked and left unchanged — queue inconsistent \(digest\), maestro missing \(no-record\)\. The renewed ones are committed/);
    assert.doesNotMatch(mixed.stderr + mixed.stdout, /nothing (was )?renewed/i, 'never claims nothing was renewed');
    const after = expiries();
    assert.equal(after.vault - now.vault, 30 * 86400);
    assert.equal(after.proof - now.proof, 30 * 86400);
    assert.deepEqual([after.queue, after.maestro], [now.queue, now.maestro], 'the blocked identities are unchanged');
    assert.equal(identities(), rows, 'no incarnation, no epoch changed');
    const last = lastRun();
    assert.deepEqual([last.outcome, last.exit, last.renewed, last.blocked], ['partial', 2, 2, 2]);
    assert.deepEqual(last.units.map((u) => `${u.unit}:${u.state}:${u.detail}`).sort(),
      ['maestro:missing:no-record', 'proof:renewed:-', 'queue:inconsistent:digest', 'vault:renewed:-']);
    const id = last.renewalId;
    assert.equal(sql('vault', `SELECT CONCAT(JSON_VALUE(body, '$.level'), ' ', IF(receipt IS NULL, 'owed', 'receipted')) FROM event_outbox WHERE event_id = '${id}' AND JSON_VALUE(body, '$.event') = 'UNIT_BOOTSTRAP_RENEWAL_PARTIAL'`),
      'ERROR owed', 'the partial alert is committed in Vault, owed to Logger');
    assert.equal(sql('vault', `SELECT COUNT(*) FROM event_outbox WHERE JSON_VALUE(body, '$.correlationId') = '${id}' AND JSON_VALUE(body, '$.event') = 'UNIT_BOOTSTRAP_RENEWED'`), '2', 'correlated proofs');
    // The second run: nothing more is extended, the blocked ones still unchanged.
    const second = renew();
    assert.equal(second.status, 2, second.stderr);
    assert.match(second.stderr, /PARTIAL: \S+ \(\S+\): 0 renewed, 2 blocked/);
    assert.deepEqual(expiries(), after, 'a second run extends nothing');
  } finally {
    fs.writeFileSync(record('queue'), kept.queue, { mode: 0o600 });
    fs.renameSync(`${record('maestro')}.aside`, record('maestro'));
    spawnSync(path.join(HERE, 'bin/podman'), ['restart', 'univ-minimal-ctr-logger'], { env });
  }
  // Logger back: Vault's relay delivers the alert, with Logger's verified receipt.
  // (the relay's per-row backoff is capped at 256 s)
  const receipted = await until(() => sql('vault', "SELECT COUNT(*) FROM event_outbox WHERE JSON_VALUE(body, '$.event') LIKE 'UNIT_BOOTSTRAP_RENEW%' AND receipt IS NULL") === '0', 300000);
  assert.ok(receipted, 'both partial alerts and the proofs reach Logger once it is back');
  assert.equal(sql('logger', `SELECT COUNT(*) FROM events WHERE pod = 'vault' AND event = 'UNIT_BOOTSTRAP_RENEWAL_PARTIAL'`), '2');
  // Records restored: a full renewal again.
  assert.equal(renew().status, 0);
});

test('decision L: a failed transaction rolls back, a lost acknowledgement is settled from the proofs before anything is repeated, records gone are missing', () => {
  // An outbox row refused: the transaction rolls back, the script re-reads the proofs and halts.
  sql('vault', "CREATE TRIGGER rehearsal_outbox_fault BEFORE INSERT ON event_outbox FOR EACH ROW SET NEW.body = IF(JSON_VALUE(NEW.body, '$.event') LIKE 'UNIT_BOOTSTRAP_RENEW%', NULL, NEW.body)");
  let failed;
  const now = expiries();
  try {
    failed = renew({ RENEW_WITHIN_SECONDS: String(80 * 86400) });
  } finally {
    sql('vault', 'DROP TRIGGER rehearsal_outbox_fault');
  }
  assert.equal(failed.status, 1, `${failed.stdout}\n${failed.stderr}`);
  assert.match(failed.stderr, /HALTED: root's transaction did not complete \(ERROR 1048 .*\); the proofs of renewal \S+ show nothing committed: the transaction rolled back, nothing was renewed by this run/);
  assert.deepEqual(expiries(), now, 'nothing extended');
  assert.deepEqual([lastRun().outcome, lastRun().exit], ['halted', 1]);
  assert.ok(!fs.existsSync(path.join(renewalDir, 'unsettled')));

  // A run whose acknowledgement was lost: the next run settles it from its proofs first.
  const committed = renew({ RENEW_WITHIN_SECONDS: String(80 * 86400) });
  assert.equal(committed.status, 0, committed.stderr);
  const lost = lastRun().renewalId;
  fs.writeFileSync(path.join(renewalDir, 'unsettled'), `${lost}\n`, { mode: 0o600 });
  const next = renew();
  assert.equal(next.status, 0, next.stderr);
  const n = (committed.stdout.match(/^  \S+ +renewed /gm) || []).length;
  assert.ok(n >= 1, 'the drill window makes some identity due');
  assert.match(next.stdout, new RegExp(`the earlier renewal ${lost}, settled from its proofs: ${n} renewed\\n(  \\S+ +renewed .*\\n){${n}}  \\S+ +current `), 'exactly what its proofs show');
  assert.equal((next.stdout.match(/ current /g) || []).length, 4, 'and the repeat extends nothing');
  assert.ok(!fs.existsSync(path.join(renewalDir, 'unsettled')));
  // An unsettled marker that names no run: nothing is repeated.
  fs.writeFileSync(path.join(renewalDir, 'unsettled'), 'garbage\n', { mode: 0o600 });
  const garbled = renew();
  assert.equal(garbled.status, 1);
  assert.match(garbled.stderr, /HALTED: .*unsettled does not name a renewal/);
  fs.rmSync(path.join(renewalDir, 'unsettled'));

  // Records gone under an existing Vault database: every identity missing, nothing renewed blind.
  fs.renameSync(recordsDir, `${recordsDir}.aside`);
  try {
    const none = renew({ RENEW_WITHIN_SECONDS: String(80 * 86400) });
    assert.equal(none.status, 2, none.stderr);
    assert.match(none.stderr, /PARTIAL: \S+ \(\S+\): 0 renewed, 4 blocked/);
    assert.equal((none.stdout.match(/ missing +bootstrap expires \S+ \(no-record\)/g) || []).length, 4);
    assert.ok(!fs.existsSync(recordsDir), 'the parent\'s records path is never created by the renewal');
  } finally {
    fs.renameSync(`${recordsDir}.aside`, recordsDir);
  }
  // A record that cannot be trusted is an unverifiable input: everything halts.
  const record = path.join(recordsDir, 'queue.json');
  fs.chmodSync(record, 0o644);
  try {
    const untrusted = renew({ RENEW_WITHIN_SECONDS: String(80 * 86400) });
    assert.equal(untrusted.status, 1);
    assert.match(untrusted.stderr, /HALTED: the Vault image did not build the renewal: an input cannot be verified \(.*RECORD_UNTRUSTED.*\); nothing renewed/);
  } finally {
    fs.chmodSync(record, 0o600);
  }
  // Identities the installing universe declares beyond the base's are part of the inventory.
  const extra = renew({ RENEWAL_EXTRA_IDENTITIES: 'brick-voice' });
  assert.equal(extra.status, 2, extra.stderr);
  assert.match(extra.stdout, /^  brick-voice +missing +bootstrap expires - \(no-record\)$/m);
  assert.match(extra.stderr, /0 renewed, 1 blocked and left unchanged — brick-voice missing \(no-record\)/);
  const badExtra = renew({ RENEWAL_EXTRA_IDENTITIES: "x'y" });
  assert.equal(badExtra.status, 1);
  assert.match(badExtra.stderr, /HALTED: RENEWAL_EXTRA_IDENTITIES holds/);
  assert.equal(renew().status, 0, 'the base alone: complete');
  // A universe identity Vault holds nothing of: everything halts, an alert committed in Vault.
  const idFile = path.join(appsRoot, 'vault/etc/vault/universe-id');
  const realId = read(idFile);
  const before = expiries();
  fs.writeFileSync(idFile, '6ba7b810-9dad-41d1-80b4-00c04fd430c8\n');
  try {
    const unknown = renew({ RENEW_WITHIN_SECONDS: String(80 * 86400) });
    assert.equal(unknown.status, 1, unknown.stderr);
    assert.match(unknown.stderr, /HALTED: Vault holds no identity of universe 6ba7b810-9dad-41d1-80b4-00c04fd430c8: .*nothing was checked or renewed; UNIT_BOOTSTRAP_RENEWAL_HALTED committed/);
    assert.deepEqual([lastRun().outcome, lastRun().exit, lastRun().blocked], ['halted', 1, 0], 'last.json stays valid JSON');
    assert.deepEqual(expiries(), before);
    assert.equal(sql('vault', `SELECT JSON_VALUE(body, '$.data.reason') FROM event_outbox WHERE event_id = '${lastRun().renewalId}'`), 'universe-unknown');
  } finally {
    fs.writeFileSync(idFile, realId);
  }
});

test('a recreation is a new incarnation: epochs move, the old credential stops being current, the new one works', async () => {
  // A credential issued to the proof's current incarnation, kept aside.
  const keep = probe(`issue_proof_credential "$PROOF_DIR/old.header" && echo kept`);
  assert.match(keep.stdout, /kept/);
  const before = sql('vault', "SELECT GROUP_CONCAT(CONCAT(unit_id, ':', incarnation, ':', epoch) ORDER BY unit_id) FROM unit_identities");
  const again = up('--recreate', 'all');
  assert.equal(again.status, 0, `${again.stdout}\n${again.stderr}`);
  const afterRows = sql('vault', "SELECT GROUP_CONCAT(CONCAT(unit_id, ':', incarnation, ':', epoch) ORDER BY unit_id) FROM unit_identities");
  assert.notEqual(afterRows, before);
  const epochBefore = Object.fromEntries(before.split(',').map((row) => [row.split(':')[0], Number(row.split(':')[2])]));
  for (const row of afterRows.split(',')) {
    const [unit, , epoch] = row.split(':');
    assert.equal(Number(epoch), epochBefore[unit] + 1, `epoch moved: ${row}`);
  }
  const old = probe(`curl -s -o /dev/null -w '%{http_code}' -H @"$PROOF_DIR/old.header" "http://127.0.0.1:8620/api/events/last?event=NONE"`);
  assert.equal(old.stdout.trim(), '403', 'the previous incarnation\'s credential is refused');
  const fresh = probe(`logger_curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:8620/api/events/last?event=NONE"`);
  assert.equal(fresh.stdout.trim(), '200');
  oweEvidence('recreated');
  for (const s of ['vault', 'queue', 'maestro']) {
    const inc = JSON.parse(read(path.join(fakeState, `univ-minimal-ctr-${s}.json`))).env.SHAPER_UNIT_INCARNATION;
    assert.ok(await until(() => Number(sql('vault', `SELECT COUNT(*) FROM unit_credentials WHERE unit_id='${s}' AND incarnation='${inc}'`)) >= 1), `${s} renewed under ${inc}`);
  }
  process.stdout.write(`# identities before: ${before}\n# identities after:  ${afterRows}\n`);
});

test('a changed SHAPER_UNIVERSE_ID is refused; a missing identity under an existing database halts, unless the known one is named', () => {
  const idFile = path.join(appsRoot, 'vault/etc/vault/universe-id');
  const known = read(idFile).trim();
  const changed = spawnSync('unshare', ['-r', 'bash', path.join(UNIV, 'deploy/podman-up.sh')], { env: { ...env, SHAPER_UNIVERSE_ID: '11111111-2222-4333-8444-555555555555' }, encoding: 'utf8' });
  assert.notEqual(changed.status, 0);
  assert.match(changed.stderr, /never replaced under its databases/);
  // A Vault database on disk (here only its directory) and no identity file.
  const marker = path.join(appsRoot, 'vault/sav/mariadb/vault');
  fs.mkdirSync(marker, { recursive: true });
  fs.renameSync(idFile, `${idFile}.aside`);
  try {
    const lost = spawnSync('unshare', ['-r', 'bash', path.join(UNIV, 'deploy/podman-up.sh')], { env, encoding: 'utf8' });
    assert.notEqual(lost.status, 0);
    assert.match(lost.stderr, /the vault database exists but the universe identity .* does not/);
    assert.match(lost.stderr, /migrated \(INTENT\.md#migration, Rule 30\)/);
    assert.ok(!fs.existsSync(idFile), 'no new identity was invented');
    // Naming the known identity records it again (the run then stops at the
    // stand-in datadir, which no engine uid owns: nothing else is touched).
    const named = spawnSync('unshare', ['-r', 'bash', path.join(UNIV, 'deploy/podman-up.sh')], { env: { ...env, SHAPER_UNIVERSE_ID: known }, encoding: 'utf8' });
    assert.notEqual(named.status, 0);
    assert.match(named.stderr, /belongs to uid [\s\S]* no recursive chown is made/);
    assert.equal(read(idFile).trim(), known);
  } finally {
    fs.rmSync(path.join(appsRoot, 'vault/sav/mariadb'), { recursive: true, force: true });
    if (!fs.existsSync(idFile)) fs.renameSync(`${idFile}.aside`, idFile); else fs.rmSync(`${idFile}.aside`, { force: true });
  }
});

test('a re-run that stops before Vault holds the new registrations leaves the running units and the proof with working identities', async () => {
  const sha = (f) => createHash('sha256').update(read(f)).digest('hex');
  const staged = ['queue', 'maestro'].map((s) => path.join(appsRoot, s, 'etc/identity/bootstrap'));
  const before = { files: staged.map(sha), proof: sha(path.join(proofDir, 'identity/bootstrap')), inc: read(path.join(proofDir, 'identity/incarnation')),
    rows: sql('vault', "SELECT GROUP_CONCAT(CONCAT(unit_id, ':', incarnation, ':', epoch) ORDER BY unit_id) FROM unit_identities WHERE unit_id <> 'vault'") };
  await sleep(1100);
  const failed = spawnSync('unshare', ['-r', 'bash', path.join(UNIV, 'deploy/podman-up.sh'), '--recreate', 'all'], { env: { ...env, FAKE_FAIL_APPLY: '1' }, encoding: 'utf8', timeout: 600000 });
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /root could not apply the unit registrations/);
  assert.deepEqual(staged.map(sha), before.files, 'Queue and Maestro keep the bootstrap Vault holds');
  assert.equal(sha(path.join(proofDir, 'identity/bootstrap')), before.proof);
  assert.equal(read(path.join(proofDir, 'identity/incarnation')), before.inc);
  assert.equal(sql('vault', "SELECT GROUP_CONCAT(CONCAT(unit_id, ':', incarnation, ':', epoch) ORDER BY unit_id) FROM unit_identities WHERE unit_id <> 'vault'"), before.rows);
  const still = probe(`logger_curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:8620/api/events/last?event=NONE"`);
  assert.equal(still.stdout.trim(), '200', 'the proof still obtains and uses a credential');
  // A complete run puts everything in order again.
  const again = up('--recreate', 'all');
  assert.equal(again.status, 0, `${again.stdout}\n${again.stderr}`);
});

test("proof.sh's effects section runs green twice: each unit's effect, its evidence in both databases, persistence across runs", () => {
  for (const run of [1, 2]) {
    const r = spawnSync('bash', [path.join(HERE, 'effects-driver.sh')], { env, encoding: 'utf8', timeout: 600000 });
    process.stdout.write(`# effects run ${run}:\n${r.stdout.split('\n').map((l) => `#   ${l}`).join('\n')}\n# stderr: ${r.stderr.slice(0, 3000)}\n`);
    assert.equal(r.status, 0, `effects run ${run} failed`);
    assert.match(r.stdout, /EFFECTS \d+ passed, 0 failed/);
    if (run === 2) assert.match(r.stdout, /OK\s+maestro-persisted/);
    for (const secret of secretsSeen()) assert.ok(!r.stdout.includes(secret) && !r.stderr.includes(secret), 'a secret in the proof output');
    assert.deepEqual(fs.readdirSync(path.join(proofDir, 'identity')).filter((f) => f.endsWith('.header')), [], 'no credential header is left on disk');
  }
});
