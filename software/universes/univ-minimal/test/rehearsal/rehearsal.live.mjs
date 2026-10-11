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
import { execFileSync, spawnSync } from 'node:child_process';
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
const secretsSeen = () => {
  const out = [];
  for (const p of [path.join(appsRoot, 'vault/etc/vault/api-token'), path.join(appsRoot, 'vault/etc/vault/master.key'),
    ...['vault', 'queue', 'maestro'].map((s) => path.join(appsRoot, s, 'etc/identity/bootstrap')), path.join(proofDir, 'identity/bootstrap'),
    ...['vault', 'logger', 'queue', 'maestro'].map((s) => path.join(appsRoot, s, 'etc/mysql/localhost/passwd'))]) {
    if (fs.existsSync(p)) out.push(read(p).trim());
  }
  return out;
};

let first;
before(() => { first = up(); });
after(() => {
  for (const f of fs.existsSync(fakeState) ? fs.readdirSync(fakeState).filter((x) => x.endsWith('.json')) : []) {
    spawnSync(path.join(HERE, 'bin/podman'), ['stop', f.slice(0, -5)], { env });
  }
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
  const renew = (extra = {}) => spawnSync('unshare', ['-r', 'bash', path.join(UNIV, 'deploy/renew-bootstraps.sh')], { env: { ...env, ...extra }, encoding: 'utf8', timeout: 120000 });
  const expiries = () => Object.fromEntries(sql('vault', "SELECT CONCAT(unit_id, ' ', TIMESTAMPDIFF(SECOND, '1970-01-01', bootstrap_expires_at)) FROM unit_identities ORDER BY unit_id")
    .split('\n').map((l) => l.split(' ')).map(([u, t]) => [u, Number(t)]));
  const before = { expiries: expiries(), rows: identities(), pids: pids() };
  // Every identity is due when the window is 40 days: a drill of the daily run.
  const forced = renew({ RENEW_WITHIN_SECONDS: String(40 * 86400) });
  assert.equal(forced.status, 0, `${forced.stdout}\n${forced.stderr}`);
  for (const u of ['maestro', 'proof', 'queue', 'vault']) {
    assert.match(forced.stdout, new RegExp(`^  ${u} +renewed `, 'm'));
    assert.equal(expiries()[u] - before.expiries[u], 30 * 86400, `${u} extended by 30 days`);
  }
  assert.equal(identities(), before.rows, 'no incarnation, no epoch changed');
  assert.deepEqual(pids(), before.pids, 'nothing restarted');
  for (const secret of secretsSeen()) assert.ok(!forced.stdout.includes(secret) && !forced.stderr.includes(secret));
  assert.equal(Number(sql('vault', "SELECT COUNT(*) FROM event_outbox WHERE JSON_VALUE(body, '$.event') = 'UNIT_BOOTSTRAP_RENEWED'")), 4, 'one proof per renewal');
  // The daily run, the same day: nothing is due.
  const daily = renew();
  assert.equal(daily.status, 0, daily.stderr);
  assert.equal((daily.stdout.match(/ current /g) || []).length, 4);
  // A record that no longer matches Vault halts the run: nothing renewed, an alert.
  const record = path.join(appsRoot, 'vault/etc/vault/registration/records/queue.json');
  const kept = read(record);
  fs.writeFileSync(record, kept.replace(/"bootstrapDigest":"[0-9a-f]{64}"/, `"bootstrapDigest":"${'0'.repeat(64)}"`));
  try {
    const now = expiries();
    const halted = renew({ RENEW_WITHIN_SECONDS: String(80 * 86400) });
    assert.equal(halted.status, 1);
    assert.match(halted.stderr, /HALTED: 1 identity record\(s\) do not match/);
    assert.match(halted.stdout, /^  queue +mismatch /m);
    assert.match(halted.stdout, /^  vault +held /m);
    assert.deepEqual(expiries(), now, 'nothing renewed');
    assert.equal(Number(sql('vault', "SELECT COUNT(*) FROM event_outbox WHERE JSON_VALUE(body, '$.event') = 'UNIT_BOOTSTRAP_RENEWAL_HALTED' AND JSON_VALUE(body, '$.level') = 'ERROR'")), 1);
  } finally {
    fs.writeFileSync(record, kept, { mode: 0o600 });
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
