/**
 * Live (real private MariaDB, real Logger): every Vault secret mutation and
 * credential issuance commits its evidence in the same transaction, a failed
 * evidence write rolls the mutation back, and the Vault's own relay drains the
 * outbox to Logger under a credential it issues to itself — carrying no
 * secret value anywhere.
 *
 * Run through software/packages/pkg-db/test/live/run-live.mjs.
 * Intent: software/packages/pkg-vault/INTENT.md#evidence-relay
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { adminQuery, unitDb } from '../../pkg-db/test/live/live-env.mjs';
import { startEvidenceStack } from '../../pkg-logger/test/live/evidence-stack.mjs';
import { createVaultEvidenceRelay } from '../evidence-runtime.js';
import { openUnitDb } from '../../pkg-db/pool.js';
import { pruneExpiredCredentials } from '../unit-identity.js';

const VALUE = 'live-secret-value-that-must-never-leave';
let stack;

before(async () => {
  // A server whose own time zone is not UTC: the units pin their sessions.
  await adminQuery("SET GLOBAL time_zone = '+05:00'");
  stack = await startEvidenceStack();
});
after(async () => {
  await stack.close();
  await adminQuery("SET GLOBAL time_zone = 'SYSTEM'");
});

function vaultRelay() {
  const env = stack.env('vault');
  return createVaultEvidenceRelay({
    pool: stack.vaultStore.pool,
    identityService: stack.identityService,
    env: { LOGGER_URL: stack.loggerUrl, SHAPER_UNIVERSE_ID: env.SHAPER_UNIVERSE_ID,
      SHAPER_UNIT_INCARNATION: env.SHAPER_UNIT_INCARNATION, UNIT_BOOTSTRAP_TOKEN_FILE: env.UNIT_BOOTSTRAP_TOKEN_FILE,
      VAULT_RELAY_INTERVAL_MS: '60000' },
    report: (event) => console.error(`[relay] ${JSON.stringify(event)}`),
  });
}

const outbox = async () => (await adminQuery('SELECT event_id, body, receipt FROM vault.event_outbox ORDER BY created_at, event_id'))
  .map((r) => ({ ...r, entry: JSON.parse(r.body) }));

describe('Vault evidence is committed with the change it reports', () => {
  it('a unit session is UTC even when the server is not', async () => {
    const { pool } = await openUnitDb({ slug: 'vault', ...unitDb() });
    try {
      const [[row]] = await pool.query('SELECT @@session.time_zone AS tz, @@global.time_zone AS global_tz');
      assert.deepEqual({ ...row }, { tz: '+00:00', global_tz: '+05:00' });
    } finally {
      await pool.end();
    }
  });

  it('store, overwrite and delete each commit one evidence row, without the value', async () => {
    const store = stack.vaultStore;
    const before = new Set((await outbox()).map((r) => r.event_id));
    await store.setSecret('mailbox/ops', { pass: VALUE });
    await store.setSecret('mailbox/ops', { pass: `${VALUE}-2` });
    assert.equal(await store.deleteSecret('mailbox/ops'), true);
    assert.equal(await store.deleteSecret('mailbox/ops'), false, 'deleting nothing changes nothing and reports nothing');
    // Rows written within one millisecond have no order between them: compare as a set.
    const rows = (await outbox()).filter((r) => !before.has(r.event_id));
    assert.deepEqual(rows.map((r) => `${r.entry.event} ${r.entry.data.secretRef} ${r.entry.data.created}`).sort(),
      ['SECRET_DELETED mailbox/ops undefined', 'SECRET_STORED mailbox/ops false', 'SECRET_STORED mailbox/ops true']);
    for (const r of rows) {
      assert.equal(r.entry.pod, 'vault');
      assert.equal(r.receipt, null);
      assert.doesNotMatch(r.body, new RegExp(VALUE));
    }
  });

  it('when the evidence cannot be written, the mutation is not either', async () => {
    const store = stack.vaultStore;
    await adminQuery('RENAME TABLE vault.event_outbox TO vault.event_outbox_away');
    try {
      await assert.rejects(store.setSecret('mailbox/rollback', { pass: VALUE }), (err) => /event_outbox/.test(err.message));
    } finally {
      await adminQuery('RENAME TABLE vault.event_outbox_away TO vault.event_outbox');
    }
    assert.equal(await store.getSecret('mailbox/rollback'), null, 'the secret was rolled back with its evidence');
  });

  it('an idle Vault issues itself no credential: nothing due, nothing asked (DECISIONS §C)', async () => {
    const drain = vaultRelay();
    for (let i = 0; i < 3; i++) await drain.tick(); // whatever earlier steps left
    await drain.close();
    // A fresh lane holds no cached credential: before §C its first tick issued one.
    const relay = vaultRelay();
    try {
      const issued = async () => Number((await adminQuery("SELECT COUNT(*) AS n FROM vault.unit_credentials WHERE unit_id = 'vault'"))[0].n);
      const before = await issued();
      for (let i = 0; i < 5; i++) assert.deepEqual(await relay.tick(), { delivered: 0, deferred: 0 });
      assert.equal(await issued(), before, 'no issuance while the outbox owes nothing');
      assert.equal(Number((await adminQuery('SELECT COUNT(*) AS n FROM vault.event_outbox WHERE receipt IS NULL'))[0].n), 0);
    } finally {
      await relay.close();
    }
  });

  it('the Vault relay drains its outbox to Logger under its own credential', async () => {
    await stack.vaultStore.setSecret('provider/key', { apiKey: VALUE });
    const relay = vaultRelay();
    try {
      let result;
      for (let i = 0; i < 3; i++) result = await relay.tick(); // issuance evidence lands while the first batch drains
      assert.ok(result, 'the relay obtained its credential and ran');
      const pending = (await outbox()).filter((r) => r.receipt === null);
      assert.deepEqual(pending.map((r) => r.entry.event), [], 'no debt is left');
      const events = await stack.loggerEvents("pod = 'vault'");
      const names = events.map((e) => e.event);
      for (const name of ['SECRET_STORED', 'SECRET_DELETED', 'UNIT_CREDENTIAL_ISSUED']) assert.ok(names.includes(name), `${name} reached Logger`);
      assert.equal(new Set(events.map((e) => e.source_event_id)).size, events.length, 'each outbox row is one Logger event');
      assert.doesNotMatch(JSON.stringify(events), new RegExp(VALUE), 'no secret value reached Logger');
      const issued = events.find((e) => e.event === 'UNIT_CREDENTIAL_ISSUED');
      const data = typeof issued.data === 'string' ? JSON.parse(issued.data) : issued.data;
      assert.deepEqual([data.unit, data.audience], ['vault', 'logger']);
      assert.doesNotMatch(JSON.stringify((await outbox()).map((r) => r.body)), /Bearer|eyJ/, 'no credential entered the outbox');
    } finally {
      await relay.close();
    }
  });
});

describe('expired credentials are removed after 24 hours, and nothing else (DECISIONS §C)', () => {
  it('keeps current, recently expired and revoked rows, and every identity', async () => {
    const universe = '550e8400-e29b-41d4-a716-446655440000';
    await adminQuery('DELETE FROM vault.unit_credentials');
    const identitiesBefore = await adminQuery('SELECT unit_id, incarnation, epoch, revoked FROM vault.unit_identities ORDER BY unit_id');
    const rows = [
      ['old', 'TIMESTAMPADD(HOUR, -30, UTC_TIMESTAMP(3))', 0],
      ['recent', 'TIMESTAMPADD(HOUR, -20, UTC_TIMESTAMP(3))', 0],
      ['current', 'TIMESTAMPADD(SECOND, 200, UTC_TIMESTAMP(3))', 0],
      ['revoked', 'TIMESTAMPADD(HOUR, -30, UTC_TIMESTAMP(3))', 1],
    ];
    for (const [name, expires, revoked] of rows) {
      await adminQuery(`INSERT INTO vault.unit_credentials (credential_id, universe_id, unit_id, incarnation, epoch, audience, expires_at, revoked)
        VALUES (?, ?, 'queue', 'queue-live-1', 1, 'logger', ${expires}, ?)`, [`00000000-0000-4000-8000-00000000000${rows.indexOf(rows.find((r) => r[0] === name))}`, universe, revoked]);
    }
    const { pool } = await openUnitDb({ slug: 'vault', ...unitDb() });
    try {
      assert.deepEqual(await pruneExpiredCredentials(pool), { removed: 1 });
      assert.deepEqual(await pruneExpiredCredentials(pool), { removed: 0 });
    } finally {
      await pool.end();
    }
    const left = await adminQuery("SELECT credential_id FROM vault.unit_credentials ORDER BY credential_id");
    assert.deepEqual(left.map((r) => r.credential_id.slice(-1)), ['1', '2', '3'], 'only the row expired over 24 h ago is gone');
    assert.deepEqual(await adminQuery('SELECT unit_id, incarnation, epoch, revoked FROM vault.unit_identities ORDER BY unit_id'), identitiesBefore);
  });
});
