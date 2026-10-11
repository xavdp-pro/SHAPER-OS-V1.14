/**
 * Live (real private MariaDB, applied by the real mariadb client as root, as
 * the parent applies it; real Logger): the parent's selective bootstrap
 * renewal (SOL decision L, replacing the all-or-nothing halt of
 * DECISIONS-20261011 §D).
 *
 * A consistent identity expiring within 7 days gets 30 days more from its
 * current expiry, in one transaction with its proof; a later one is left. A
 * missing (no row, or no parent record), expired, revoked, inconsistent or
 * unexpected identity stays exactly as it is, and the run commits a partial
 * alert correlated with the proofs. A second run extends nothing. An outbox
 * failure rolls the whole run back; a universe this Vault does not know halts
 * everything. After a lost acknowledgement, the proofs say what was
 * committed. No identity is created, no incarnation, epoch or grant changes,
 * a revoked identity is never revived, and every event is one Logger
 * receipts.
 *
 * Run through software/packages/pkg-db/test/live/run-live.mjs.
 * Intent: software/packages/pkg-vault/INTENT.md#bootstrap-renewal
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';

import { adminQuery, liveEnv } from '../../pkg-db/test/live/live-env.mjs';
import { startEvidenceStack, UNIVERSE } from '../../pkg-logger/test/live/evidence-stack.mjs';
import { createVaultEvidenceRelay } from '../evidence-runtime.js';
import { registrationStatement, renewalReadbackStatement, renewalStatement } from '../unit-registration.js';

const DAY = 24 * 3600;
const mariadb = path.join(process.env.MARIADB_BASEDIR || '', 'usr/bin/mariadb');
let stack;

before(async () => { stack = await startEvidenceStack(); });
after(async () => { await stack.close(); });

/** Registers a unit as the parent does and returns the record it keeps. */
async function register(unit, ttlSeconds, grants = { logger: ['logger:ingest'] }) {
  const bootstrapToken = crypto.randomBytes(32).toString('hex');
  const incarnation = `${unit}-${crypto.randomBytes(8).toString('hex')}`;
  const { sql, params } = registrationStatement({ universe: UNIVERSE, unit, incarnation, grants, bootstrapToken, ttlSeconds });
  await adminQuery(`USE vault; ${sql}`, params);
  const [row] = await adminQuery('SELECT epoch, grants, bootstrap_digest FROM vault.unit_identities WHERE universe_id = ? AND unit_id = ?', [UNIVERSE, unit]);
  return { unit, incarnation, epoch: Number(row.epoch), grants: JSON.parse(row.grants), bootstrapDigest: row.bootstrap_digest, bootstrapToken };
}

/** Root's client, as the parent runs it. */
const client = (input) => spawnSync(mariadb, ['--no-defaults', '-S', liveEnv().socketPath, '-uroot', '-N', '-B', 'vault'], { input, encoding: 'utf8' });
const parse = (stdout) => stdout.trim().split('\n').filter(Boolean).map((l) => l.split('\t'));

/** The parent's step: the statement through the mariadb client, as root. */
function renew(records, options = {}) {
  const renewalId = crypto.randomUUID();
  const statement = renewalStatement({ universe: UNIVERSE, records, renewalId, ...options });
  const r = client(statement);
  assert.equal(r.status, 0, r.stderr);
  const lines = parse(r.stdout);
  const summary = lines.find(([u]) => u === '*');
  const rows = Object.fromEntries(lines.filter(([u]) => u !== '*').map(([u, state, expiry, detail]) => [u, { state, expiry, detail }]));
  return { renewalId, statement, rows, summary: { state: summary[1], renewed: Number(summary[2]), blocked: Number(summary[3]) } };
}
/** What a renewal committed, from its proofs. */
function readback(renewalId) {
  const r = client(renewalReadbackStatement({ renewalId }));
  assert.equal(r.status, 0, r.stderr);
  return parse(r.stdout);
}

const identity = async (unit) => ({ ...(await adminQuery(`SELECT incarnation, epoch, grants, bootstrap_digest, revoked,
  DATE_FORMAT(bootstrap_expires_at, '%Y-%m-%dT%T.%fZ') AS expiry FROM vault.unit_identities WHERE universe_id = ? AND unit_id = ?`, [UNIVERSE, unit]))[0] });
const outbox = async (event, renewalId) => (await adminQuery(`SELECT event_id, body, body_digest FROM vault.event_outbox
  WHERE JSON_VALUE(body, '$.event') = ? AND JSON_VALUE(body, '$.correlationId') = ? ORDER BY event_id`, [event, renewalId]))
  .map((r) => ({ ...r, entry: JSON.parse(r.body) }));
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const plus = (iso, seconds) => new Date(Date.parse(iso) + seconds * 1000).toISOString().replace(/\.(\d{3})Z$/, '.$1000Z');

async function relayTicks(n = 3) {
  const env = stack.env('vault');
  const relay = createVaultEvidenceRelay({ pool: stack.vaultStore.pool, identityService: stack.identityService,
    env: { LOGGER_URL: stack.loggerUrl, SHAPER_UNIVERSE_ID: env.SHAPER_UNIVERSE_ID, SHAPER_UNIT_INCARNATION: env.SHAPER_UNIT_INCARNATION,
      UNIT_BOOTSTRAP_TOKEN_FILE: env.UNIT_BOOTSTRAP_TOKEN_FILE, VAULT_RELAY_INTERVAL_MS: '60000' } });
  try {
    for (let i = 0; i < n; i++) await relay.tick();
  } finally {
    await relay.close();
  }
}

describe('a consistent composition: due ones extended from their current expiry, with their proofs', () => {
  let due, current, first;
  before(async () => {
    due = await register('renew-due', 3 * DAY);
    current = await register('renew-current', 30 * DAY, { logger: ['logger:ingest'], queue: ['queue:enqueue', 'queue:read'] });
  });

  it('extends the one expiring within 7 days by 30 days from its expiry, leaves the other, and commits the proof with it', async () => {
    const before = { due: await identity('renew-due'), current: await identity('renew-current') };
    first = renew([due, current], { expected: ['renew-due', 'renew-current'] });
    assert.doesNotMatch(first.statement, new RegExp(due.bootstrapToken), 'no bootstrap value in the statement');
    assert.deepEqual([first.rows['renew-due'].state, first.rows['renew-current'].state], ['renewed', 'current']);
    assert.deepEqual(first.summary, { state: 'complete', renewed: 1, blocked: 0 });
    const after = { due: await identity('renew-due'), current: await identity('renew-current') };
    assert.equal(after.due.expiry, plus(before.due.expiry, 30 * DAY), 'from the current expiry, not from now');
    assert.equal(first.rows['renew-due'].expiry, after.due.expiry);
    assert.deepEqual(after.current, before.current);
    for (const field of ['incarnation', 'epoch', 'grants', 'bootstrap_digest', 'revoked']) assert.equal(after.due[field], before.due[field], field);
    const [proof] = await outbox('UNIT_BOOTSTRAP_RENEWED', first.renewalId);
    assert.equal(proof.body_digest, sha256(proof.body), 'the relay will find the digest it checks');
    assert.equal(proof.entry.sourceEventId, proof.event_id);
    assert.deepEqual([proof.entry.data.unit, proof.entry.data.incarnation, proof.entry.data.epoch, proof.entry.data.previousExpiry, proof.entry.data.newExpiry],
      ['renew-due', due.incarnation, due.epoch, before.due.expiry, after.due.expiry]);
    assert.equal((await outbox('UNIT_BOOTSTRAP_RENEWAL_PARTIAL', first.renewalId)).length, 0, 'nothing blocked, no alert');
  });

  it('a second run the same day extends nothing', async () => {
    const before = await identity('renew-due');
    const again = renew([due, current], { expected: ['renew-due', 'renew-current'] });
    assert.deepEqual([again.rows['renew-due'].state, again.rows['renew-current'].state], ['current', 'current']);
    assert.deepEqual(again.summary, { state: 'complete', renewed: 0, blocked: 0 });
    assert.deepEqual(await identity('renew-due'), before);
    assert.equal((await outbox('UNIT_BOOTSTRAP_RENEWED', again.renewalId)).length, 0);
  });

  it('the proof is an event Logger accepts: Vault\'s relay delivers it with a verified receipt', async () => {
    await relayTicks();
    const [proof] = await outbox('UNIT_BOOTSTRAP_RENEWED', first.renewalId);
    const [settled] = await adminQuery('SELECT receipt FROM vault.event_outbox WHERE event_id = ?', [proof.event_id]);
    assert.ok(settled.receipt, 'receipted');
    assert.equal((await stack.loggerEvents("pod = 'vault' AND event = 'UNIT_BOOTSTRAP_RENEWED'")).length, 1);
  });
});

describe('a mixed run: the valid identity renewed, the four refusal kinds unchanged, one partial alert', () => {
  let valid, tampered, revoked, expired, vanished, stray, first;
  const UNITS = ['renew-valid', 'renew-tampered', 'renew-revoked', 'renew-expired', 'renew-vanished', 'renew-stray'];
  const expected = ['renew-valid', 'renew-tampered', 'renew-revoked', 'renew-expired', 'renew-vanished', 'renew-norow', 'renew-norecord'];
  const snapshot = async () => Object.fromEntries(await Promise.all(UNITS.map(async (u) => [u, await identity(u)])));
  before(async () => {
    valid = await register('renew-valid', 2 * DAY);
    tampered = { ...(await register('renew-tampered', 2 * DAY)), bootstrapDigest: 'f'.repeat(64) };
    revoked = await register('renew-revoked', 2 * DAY);
    await adminQuery("UPDATE vault.unit_identities SET revoked = TRUE WHERE unit_id = 'renew-revoked'");
    expired = await register('renew-expired', 2 * DAY);
    await adminQuery("UPDATE vault.unit_identities SET bootstrap_expires_at = TIMESTAMPADD(HOUR, -1, UTC_TIMESTAMP(3)) WHERE unit_id = 'renew-expired'");
    // In Vault, due, but its parent record is gone: missing, never renewed blind.
    vanished = await register('renew-vanished', 2 * DAY);
    // A record for a unit Vault never held.
    stray = await register('renew-stray', 2 * DAY);
  });
  const records = () => [valid, tampered, revoked, expired, { ...valid, unit: 'renew-norow' }, stray];

  it('renews the valid one only; every blocked identity is exactly as it was', async () => {
    const before = await snapshot();
    first = renew(records(), { expected });
    const states = Object.fromEntries(Object.entries(first.rows).map(([u, r]) => [u, `${r.state}:${r.detail}`]));
    assert.deepEqual(states, {
      'renew-valid': 'renewed:-', 'renew-tampered': 'inconsistent:digest', 'renew-revoked': 'revoked:revoked', 'renew-expired': 'expired:expired',
      'renew-vanished': 'missing:no-record', 'renew-norow': 'missing:no-row', 'renew-norecord': 'missing:no-record', 'renew-stray': 'unexpected:not-in-composition',
    });
    assert.deepEqual(first.summary, { state: 'partial', renewed: 1, blocked: 7 }, 'partial, and says one was renewed');
    const after = await snapshot();
    assert.equal(after['renew-valid'].expiry, plus(before['renew-valid'].expiry, 30 * DAY));
    for (const u of UNITS.filter((x) => x !== 'renew-valid')) assert.deepEqual(after[u], before[u], `${u} unchanged`);
    assert.equal(after['renew-revoked'].revoked, 1, 'a revoked identity is never revived');
    assert.equal((await adminQuery("SELECT COUNT(*) AS n FROM vault.unit_identities WHERE unit_id IN ('renew-norow', 'renew-norecord')"))[0].n, 0, 'no identity created');
  });

  it('commits UNIT_BOOTSTRAP_RENEWED for the valid one and UNIT_BOOTSTRAP_RENEWAL_PARTIAL, correlated by the run', async () => {
    const proofs = await outbox('UNIT_BOOTSTRAP_RENEWED', first.renewalId);
    assert.deepEqual(proofs.map((p) => p.entry.data.unit), ['renew-valid']);
    const [alert] = await outbox('UNIT_BOOTSTRAP_RENEWAL_PARTIAL', first.renewalId);
    assert.equal(alert.event_id, first.renewalId);
    assert.equal(alert.entry.level, 'ERROR');
    assert.equal(alert.body_digest, sha256(alert.body));
    assert.equal(alert.entry.correlationId, proofs[0].entry.correlationId);
    assert.deepEqual([alert.entry.data.renewed, alert.entry.data.blocked], [1, 7]);
    assert.deepEqual(alert.entry.data.units.map((u) => `${u.unit}:${u.state}`), [
      'renew-valid:renewed', 'renew-tampered:inconsistent', 'renew-revoked:revoked', 'renew-expired:expired', 'renew-vanished:missing',
      'renew-norow:missing', 'renew-norecord:missing', 'renew-stray:unexpected']);
    assert.doesNotMatch(alert.body, new RegExp(valid.bootstrapToken));
  });

  it('a second run extends nothing and leaves the blocked ones as they are, alerting again', async () => {
    const before = await snapshot();
    const again = renew(records(), { expected });
    assert.equal(again.rows['renew-valid'].state, 'current');
    assert.deepEqual(again.summary, { state: 'partial', renewed: 0, blocked: 7 });
    assert.deepEqual(await snapshot(), before);
    assert.equal((await outbox('UNIT_BOOTSTRAP_RENEWED', again.renewalId)).length, 0);
    assert.equal((await outbox('UNIT_BOOTSTRAP_RENEWAL_PARTIAL', again.renewalId)).length, 1);
  });

  it('the partial alert and its proof reach Logger with verified receipts', async () => {
    await relayTicks();
    for (const id of [first.renewalId, `${first.renewalId}:0`]) {
      const [row] = await adminQuery('SELECT receipt FROM vault.event_outbox WHERE event_id = ?', [id]);
      assert.ok(row.receipt, `${id} receipted`);
    }
    assert.equal((await stack.loggerEvents("pod = 'vault' AND event = 'UNIT_BOOTSTRAP_RENEWAL_PARTIAL'")).length, 2, 'both runs\' alerts');
    assert.equal((await stack.loggerEvents("pod = 'vault' AND event = 'UNIT_BOOTSTRAP_RENEWED'")).length, 2, 'this run\'s proof and the first suite\'s');
  });

  it('a record of another epoch, other grants or another incarnation is inconsistent, and names what differs', async () => {
    const r = await register('renew-epoch', 2 * DAY);
    assert.equal(renew([{ ...r, epoch: r.epoch + 1 }]).rows['renew-epoch'].detail, 'epoch');
    assert.equal(renew([{ ...r, grants: { logger: ['logger:ingest', 'logger:read:own'] } }]).rows['renew-epoch'].detail, 'grants');
    assert.equal(renew([{ ...r, incarnation: 'renew-epoch-other', bootstrapDigest: 'e'.repeat(64) }]).rows['renew-epoch'].detail, 'incarnation,digest');
    assert.equal(renew([r]).rows['renew-epoch'].state, 'renewed');
  });
});

describe('a failure inside the transaction rolls the whole run back', () => {
  it('an outbox row refused for one proof: no identity extended, no proof, no alert; the readback shows nothing committed', async () => {
    const a = await register('renew-roll-a', 2 * DAY);
    const b = await register('renew-roll-b', 2 * DAY);
    const before = { a: await identity('renew-roll-a'), b: await identity('renew-roll-b') };
    await adminQuery(`CREATE TRIGGER vault.renewal_outbox_fault BEFORE INSERT ON vault.event_outbox FOR EACH ROW
      BEGIN IF JSON_VALUE(NEW.body, '$.data.unit') = 'renew-roll-b' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'outbox fault (test)'; END IF; END`);
    const renewalId = crypto.randomUUID();
    let r;
    try {
      r = client(renewalStatement({ universe: UNIVERSE, records: [a, b], renewalId }));
    } finally {
      await adminQuery('DROP TRIGGER vault.renewal_outbox_fault');
    }
    assert.notEqual(r.status, 0, 'the client fails');
    assert.match(r.stderr, /outbox fault \(test\)/);
    assert.deepEqual({ a: await identity('renew-roll-a'), b: await identity('renew-roll-b') }, before, 'renew-roll-a\'s extension rolled back too');
    assert.equal((await adminQuery('SELECT COUNT(*) AS n FROM vault.event_outbox WHERE event_id LIKE ?', [`${renewalId}%`]))[0].n, 0);
    assert.deepEqual(readback(renewalId), [['#', 'read', '-', '-']], 'nothing committed');
    // The fault gone, a new run renews both.
    const again = renew([a, b]);
    assert.deepEqual(again.summary, { state: 'complete', renewed: 2, blocked: 0 });
  });

  it('the partial alert refused: the valid identity\'s extension and proof roll back with it', async () => {
    const a = await register('renew-roll-c', 2 * DAY);
    const before = await identity('renew-roll-c');
    const renewalId = crypto.randomUUID();
    await adminQuery("INSERT INTO vault.event_outbox (event_id, body, body_digest) VALUES (?, '{}', SHA2('{}', 256))", [renewalId]);
    const r = client(renewalStatement({ universe: UNIVERSE, records: [a], expected: ['renew-roll-c', 'renew-roll-gone'], renewalId }));
    await adminQuery('DELETE FROM vault.event_outbox WHERE event_id = ?', [renewalId]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Duplicate entry/);
    assert.deepEqual(await identity('renew-roll-c'), before);
    assert.equal((await adminQuery('SELECT COUNT(*) AS n FROM vault.event_outbox WHERE event_id LIKE ?', [`${renewalId}%`]))[0].n, 0);
  });
});

describe('after a lost acknowledgement, the proofs say what was committed', () => {
  it('the readback of a committed partial run lists exactly what it renewed, and its alert', async () => {
    const a = await register('renew-ack-a', 2 * DAY);
    const b = await register('renew-ack-b', 30 * DAY);
    const run = renew([a, b], { expected: ['renew-ack-a', 'renew-ack-b', 'renew-ack-gone'] });
    const back = readback(run.renewalId);
    assert.deepEqual(back.filter(([u]) => u === 'renew-ack-a').map(([, s, e]) => [s, e]), [['renewed', run.rows['renew-ack-a'].expiry]]);
    assert.equal(back.filter(([u]) => u === 'renew-ack-b').length, 0, 'current: not renewed');
    assert.deepEqual(back.find(([u]) => u === '*'), ['*', 'partial', '1', '1']);
    assert.deepEqual(back.at(-1), ['#', 'read', '-', '-']);
    // The repeat that follows a lost acknowledgement extends nothing more.
    const repeat = renew([a, b], { expected: ['renew-ack-a', 'renew-ack-b'] });
    assert.deepEqual(repeat.summary, { state: 'complete', renewed: 0, blocked: 0 });
  });
});

describe('a universe this Vault does not know halts everything', () => {
  it('nothing is checked or changed, and UNIT_BOOTSTRAP_RENEWAL_HALTED is committed', async () => {
    const a = await register('renew-universe', 2 * DAY);
    const before = await identity('renew-universe');
    const renewalId = crypto.randomUUID();
    const other = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
    const r = client(renewalStatement({ universe: other, records: [a], renewalId }));
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(parse(r.stdout), [['*', 'halted', '0', 'universe-unknown']]);
    assert.deepEqual(await identity('renew-universe'), before);
    const [alert] = await outbox('UNIT_BOOTSTRAP_RENEWAL_HALTED', renewalId);
    assert.equal(alert.entry.level, 'ERROR');
    assert.equal(alert.entry.data.reason, 'universe-unknown');
    assert.deepEqual(readback(renewalId).find(([u]) => u === '*'), ['*', 'halted', '0', '-']);
  });
});
