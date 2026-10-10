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
