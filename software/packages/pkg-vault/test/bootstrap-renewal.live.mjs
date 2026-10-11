/**
 * Live (real private MariaDB, applied by the real mariadb client as root, as
 * the parent applies it; real Logger): the parent's bootstrap renewal
 * (DECISIONS-20261011 §D). A consistent identity expiring within 7 days is
 * extended by 30 days in one transaction with its proof; a later one is left;
 * any inconsistency — another digest, a revoked or expired identity, a
 * missing one — changes nothing and commits an alert instead. No identity is
 * created, no incarnation, epoch or grant changes, a revoked identity is never
 * revived, and the evidence is a valid event Logger receipts.
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
import { registrationStatement, renewalStatement } from '../unit-registration.js';

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

/** The parent's step: the statement through the mariadb client, as root. */
function renew(records, options = {}) {
  const statement = renewalStatement({ universe: UNIVERSE, records, renewalId: crypto.randomUUID(), ...options });
  const r = spawnSync(mariadb, ['--no-defaults', '-S', liveEnv().socketPath, '-uroot', '-N', '-B', 'vault'], { input: statement, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return { statement, rows: Object.fromEntries(r.stdout.trim().split('\n').map((l) => { const [u, s, e] = l.split('\t'); return [u, { state: s, expiry: e }]; })) };
}

const identity = async (unit) => ({ ...(await adminQuery(`SELECT incarnation, epoch, grants, bootstrap_digest, revoked,
  DATE_FORMAT(bootstrap_expires_at, '%Y-%m-%dT%T.%fZ') AS expiry FROM vault.unit_identities WHERE universe_id = ? AND unit_id = ?`, [UNIVERSE, unit]))[0] });
const outbox = async (event) => (await adminQuery("SELECT event_id, body, body_digest FROM vault.event_outbox WHERE JSON_VALUE(body, '$.event') = ? ORDER BY created_at, event_id", [event]))
  .map((r) => ({ ...r, entry: JSON.parse(r.body) }));
const plus = (iso, seconds) => new Date(Date.parse(iso) + seconds * 1000).toISOString().replace(/\.(\d{3})Z$/, '.$1000Z');

describe('the parent renews a live bootstrap before it expires, through Vault\'s root path', () => {
  let due, current;
  before(async () => {
    due = await register('renew-due', 3 * DAY);
    current = await register('renew-current', 30 * DAY, { logger: ['logger:ingest'], queue: ['queue:enqueue', 'queue:read'] });
  });

  it('extends the one expiring within 7 days by 30 days, leaves the other, and commits the proof with it', async () => {
    const before = { due: await identity('renew-due'), current: await identity('renew-current') };
    const { statement, rows } = renew([due, current]);
    assert.doesNotMatch(statement, new RegExp(due.bootstrapToken), 'no bootstrap value in the statement');
    assert.deepEqual([rows['renew-due'].state, rows['renew-current'].state], ['renewed', 'current']);
    const after = { due: await identity('renew-due'), current: await identity('renew-current') };
    assert.equal(after.due.expiry, plus(before.due.expiry, 30 * DAY));
    assert.equal(rows['renew-due'].expiry, after.due.expiry);
    assert.deepEqual(after.current, before.current);
    for (const field of ['incarnation', 'epoch', 'grants', 'bootstrap_digest', 'revoked']) assert.equal(after.due[field], before.due[field], field);
    const [proof] = await outbox('UNIT_BOOTSTRAP_RENEWED');
    assert.equal(proof.body_digest, crypto.createHash('sha256').update(proof.body).digest('hex'), 'the relay will find the digest it checks');
    assert.equal(proof.entry.sourceEventId, proof.event_id);
    assert.deepEqual([proof.entry.data.unit, proof.entry.data.incarnation, proof.entry.data.epoch, proof.entry.data.previousExpiry, proof.entry.data.newExpiry],
      ['renew-due', due.incarnation, due.epoch, before.due.expiry, after.due.expiry]);
  });

  it('a second run the same day renews nothing', async () => {
    const { rows } = renew([due, current]);
    assert.deepEqual([rows['renew-due'].state, rows['renew-current'].state], ['current', 'current']);
    assert.equal((await outbox('UNIT_BOOTSTRAP_RENEWED')).length, 1);
  });

  it('the proof is an event Logger accepts: Vault\'s relay delivers it with a verified receipt', async () => {
    const env = stack.env('vault');
    const relay = createVaultEvidenceRelay({ pool: stack.vaultStore.pool, identityService: stack.identityService,
      env: { LOGGER_URL: stack.loggerUrl, SHAPER_UNIVERSE_ID: env.SHAPER_UNIVERSE_ID, SHAPER_UNIT_INCARNATION: env.SHAPER_UNIT_INCARNATION,
        UNIT_BOOTSTRAP_TOKEN_FILE: env.UNIT_BOOTSTRAP_TOKEN_FILE, VAULT_RELAY_INTERVAL_MS: '60000' } });
    try {
      for (let i = 0; i < 3; i++) await relay.tick();
    } finally {
      await relay.close();
    }
    const [proof] = await outbox('UNIT_BOOTSTRAP_RENEWED');
    const [settled] = await adminQuery('SELECT receipt FROM vault.event_outbox WHERE event_id = ?', [proof.event_id]);
    assert.ok(settled.receipt, 'receipted');
    assert.equal((await stack.loggerEvents("pod = 'vault' AND event = 'UNIT_BOOTSTRAP_RENEWED'")).length, 1);
  });
});

describe('an inconsistency stops the renewal and alerts; nothing changes', () => {
  it('another digest, a revoked, an expired or a missing identity: none renewed, not even the consistent one, and one alert', async () => {
    const due = await register('renew-held', 2 * DAY);
    const tampered = { ...(await register('renew-other', 2 * DAY)), bootstrapDigest: 'f'.repeat(64) };
    const revoked = await register('renew-revoked', 2 * DAY);
    await adminQuery("UPDATE vault.unit_identities SET revoked = TRUE WHERE unit_id = 'renew-revoked'");
    const expired = await register('renew-expired', 2 * DAY);
    await adminQuery("UPDATE vault.unit_identities SET bootstrap_expires_at = TIMESTAMPADD(HOUR, -1, UTC_TIMESTAMP(3)) WHERE unit_id = 'renew-expired'");
    const missing = { ...due, unit: 'renew-nobody' };
    const units = ['renew-held', 'renew-other', 'renew-revoked', 'renew-expired'];
    const before = Object.fromEntries(await Promise.all(units.map(async (u) => [u, await identity(u)])));
    const { rows } = renew([due, tampered, revoked, expired, missing]);
    assert.deepEqual(Object.fromEntries(Object.entries(rows).map(([u, r]) => [u, r.state])), {
      'renew-held': 'held', 'renew-other': 'mismatch', 'renew-revoked': 'revoked', 'renew-expired': 'expired', 'renew-nobody': 'missing',
    });
    for (const u of units) assert.deepEqual(await identity(u), before[u], `${u} unchanged`);
    assert.equal((await identity('renew-revoked')).revoked, 1, 'a revoked identity is never revived');
    const alerts = await outbox('UNIT_BOOTSTRAP_RENEWAL_HALTED');
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].entry.level, 'ERROR');
    assert.equal(alerts[0].body_digest, crypto.createHash('sha256').update(alerts[0].body).digest('hex'));
    assert.deepEqual(alerts[0].entry.data.units.map((u) => `${u.unit}:${u.state}`),
      ['renew-held:due', 'renew-other:mismatch', 'renew-revoked:revoked', 'renew-expired:expired', 'renew-nobody:missing']);
    assert.equal((await outbox('UNIT_BOOTSTRAP_RENEWED')).filter((r) => r.entry.data.unit === 'renew-held').length, 0);
  });

  it('a record of another epoch or other grants is a mismatch too', async () => {
    const r = await register('renew-epoch', 2 * DAY);
    assert.equal(renew([{ ...r, epoch: r.epoch + 1 }]).rows['renew-epoch'].state, 'mismatch');
    assert.equal(renew([{ ...r, grants: { logger: ['logger:ingest', 'logger:read:own'] } }]).rows['renew-epoch'].state, 'mismatch');
    assert.equal(renew([r]).rows['renew-epoch'].state, 'renewed');
  });
});
