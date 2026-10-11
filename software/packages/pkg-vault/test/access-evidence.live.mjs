/**
 * Live (real private MariaDB, real Vault server and Logger): Vault's reads and
 * refusals leave evidence (DECISIONS-20261011 §H). A secret is returned only
 * after the proof of its read is committed; with the outbox unwritable the
 * read is 503 and no value leaves; with Logger down the read succeeds and its
 * evidence waits, then is delivered. Refusals carry a typed reason and never a
 * secret, a token or a path; repeated refusals — including the ones Vault's own
 * relay would cause — stay bounded.
 *
 * Run through software/packages/pkg-db/test/live/run-live.mjs.
 * Intent: software/packages/pkg-vault/INTENT.md#access-evidence
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { adminQuery, liveEnv } from '../../pkg-db/test/live/live-env.mjs';
import { startEvidenceStack, UNIVERSE } from '../../pkg-logger/test/live/evidence-stack.mjs';
import { createVaultEvidenceRelay } from '../evidence-runtime.js';
import { registrationStatement } from '../unit-registration.js';

const VALUE = 'live-read-value-that-must-never-leave';
let stack;

before(async () => { stack = await startEvidenceStack(); });
after(async () => { await stack.close(); });

const outbox = async (where = '1=1') => (await adminQuery(`SELECT event_id, body, receipt FROM vault.event_outbox WHERE ${where} ORDER BY created_at, event_id`))
  .map((r) => ({ ...r, entry: JSON.parse(r.body) }));
const get = (p, headers = stack.adminHeaders()) => fetch(`${stack.vaultUrl}${p}`, { headers });

function relay() {
  const env = stack.env('vault');
  return createVaultEvidenceRelay({
    pool: stack.vaultStore.pool, identityService: stack.identityService,
    env: { LOGGER_URL: stack.loggerUrl, SHAPER_UNIVERSE_ID: env.SHAPER_UNIVERSE_ID, SHAPER_UNIT_INCARNATION: env.SHAPER_UNIT_INCARNATION,
      UNIT_BOOTSTRAP_TOKEN_FILE: env.UNIT_BOOTSTRAP_TOKEN_FILE, VAULT_RELAY_INTERVAL_MS: '60000' },
  });
}

describe('a read leaves its proof before the secret leaves', () => {
  it('the read and the list are committed to the outbox, naming an opaque resource, never the path or the value', async () => {
    await stack.vaultStore.setSecret('secret/mail/contact-ops', { pass: VALUE });
    const res = await get('/api/secret/secret/mail/contact-ops');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const requestId = res.headers.get('x-request-id');
    const body = await res.json();
    assert.deepEqual([body.data.pass, body.evidence], [VALUE, 'pending']);
    const [read] = (await outbox("JSON_VALUE(body, '$.event') = 'SECRET_READ'")).filter((r) => r.entry.data.requestId === requestId);
    assert.ok(read, 'the read is in the outbox when the answer arrives');
    assert.deepEqual([read.entry.data.action, read.entry.data.result, read.entry.data.identity, read.entry.data.universe],
      ['secret.read', 'returned', 'vault:admin', UNIVERSE]);
    assert.equal(read.entry.data.resource, stack.vaultStore.resourceId('secret/mail/contact-ops'));
    assert.doesNotMatch(read.body, /contact-ops|secret\/mail|live-read-value/);

    assert.equal((await get('/api/secret/nothing/here')).status, 404);
    const [missing] = await outbox("JSON_VALUE(body, '$.event') = 'SECRET_READ' AND JSON_VALUE(body, '$.data.result') = 'not_found'");
    assert.ok(missing, 'a read of nothing is a read too');
    const list = await (await get('/api/secrets')).json();
    assert.ok(list.keys.includes('secret/mail/contact-ops'));
    const [listed] = await outbox("JSON_VALUE(body, '$.event') = 'SECRET_KEYS_LISTED'");
    assert.equal(listed.entry.data.count, list.keys.length);
    assert.doesNotMatch(listed.body, /contact-ops/);
  });

  it('with the outbox unwritable, the read is 503 and no value leaves', async () => {
    await adminQuery('RENAME TABLE vault.event_outbox TO vault.event_outbox_away');
    let res;
    try {
      res = await get('/api/secret/secret/mail/contact-ops');
    } finally {
      await adminQuery('RENAME TABLE vault.event_outbox_away TO vault.event_outbox');
    }
    assert.equal(res.status, 503);
    assert.doesNotMatch(await res.text(), new RegExp(VALUE));
  });

  it('with Logger down, the read succeeds and its evidence is pending; delivered once Logger is back', async () => {
    await stack.stopLogger();
    let requestId;
    try {
      const res = await get('/api/secret/secret/mail/contact-ops');
      assert.equal(res.status, 200);
      requestId = res.headers.get('x-request-id');
      const lane = relay();
      await lane.tick();
      await lane.close();
      const [pending] = (await outbox("JSON_VALUE(body, '$.event') = 'SECRET_READ'")).filter((r) => r.entry.data.requestId === requestId);
      assert.equal(pending.receipt, null, 'owed, not lost');
    } finally {
      await stack.startLogger();
    }
    const lane = relay();
    await new Promise((r) => setTimeout(r, 1100)); // past the first retry delay
    for (let i = 0; i < 4; i++) await lane.tick();
    await lane.close();
    const delivered = await stack.loggerEvents("pod = 'vault' AND event = 'SECRET_READ'");
    assert.ok(delivered.some((e) => (typeof e.data === 'string' ? JSON.parse(e.data) : e.data).requestId === requestId));
  });
});

describe('refusals carry a typed reason, and stay bounded', () => {
  it('admin refusals without a valid token are counted, then one aggregate per reason', async () => {
    for (let i = 0; i < 5; i++) assert.equal((await get('/api/secret/secret/mail/contact-ops', { Authorization: 'Bearer wrong-token' })).status, 401);
    assert.equal((await get('/api/secrets', {})).status, 401);
    await stack.refusals.flush();
    const aggregates = (await outbox("JSON_VALUE(body, '$.event') = 'VAULT_REFUSALS_AGGREGATED' AND JSON_VALUE(body, '$.data.action') = 'admin'"))
      .map((r) => [r.entry.data.reason, r.entry.data.count]).sort();
    assert.deepEqual(aggregates, [['VAULT_TOKEN_INVALID', 5], ['VAULT_TOKEN_MISSING', 1]]);
    assert.doesNotMatch(JSON.stringify(await outbox()), /wrong-token/);
  });

  it('an identity that proved itself but asks for an audience it was not granted: one record, then a count', async () => {
    const bootstrap = crypto.randomBytes(32).toString('hex');
    const file = path.join(liveEnv().workDir, 'brick-voice.bootstrap');
    fs.writeFileSync(file, bootstrap, { mode: 0o600 });
    const { sql, params } = registrationStatement({ universe: UNIVERSE, unit: 'brick-voice', incarnation: 'brick-voice-1',
      grants: { logger: ['logger:ingest'] }, bootstrapToken: bootstrap, ttlSeconds: 3600 });
    await adminQuery(`USE vault; ${sql}`, params);
    const ask = () => fetch(`${stack.vaultUrl}/api/identity/issue`, { method: 'POST',
      headers: { Authorization: `Bearer ${bootstrap}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ unit: 'brick-voice', incarnation: 'brick-voice-1', audience: 'brick-ipbx' }) });
    for (let i = 0; i < 4; i++) assert.equal((await ask()).status, 403);
    const individual = await outbox("JSON_VALUE(body, '$.event') = 'VAULT_REQUEST_REFUSED' AND JSON_VALUE(body, '$.data.unit') = 'brick-voice'");
    assert.equal(individual.length, 1);
    assert.deepEqual([individual[0].entry.data.action, individual[0].entry.data.reason, individual[0].entry.data.incarnation],
      ['identity.issue', 'AUDIENCE_NOT_GRANTED', 'brick-voice-1']);
    assert.doesNotMatch(individual[0].body, new RegExp(bootstrap));
    // An unknown bootstrap proves nothing: counted only.
    await fetch(`${stack.vaultUrl}/api/identity/issue`, { method: 'POST', headers: { Authorization: `Bearer ${'0'.repeat(64)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ unit: 'brick-voice', incarnation: 'brick-voice-1', audience: 'logger' }) });
    await stack.refusals.flush();
    const counted = (await outbox("JSON_VALUE(body, '$.event') = 'VAULT_REFUSALS_AGGREGATED' AND JSON_VALUE(body, '$.data.action') = 'identity.issue'"))
      .map((r) => [r.entry.data.reason, r.entry.data.count, r.entry.data.authenticated]).sort();
    assert.deepEqual(counted, [['AUDIENCE_NOT_GRANTED', 3, true], ['BOOTSTRAP_MISMATCH', 1, false]]);
  });

  it('no relay-induced loop: Vault\'s own credential revoked under it costs at most two rows a window, not one per attempt', async () => {
    const lane = relay();
    await stack.vaultStore.setSecret('loop/probe', 'x');
    await lane.tick(); // Vault now holds a cached logger credential
    await adminQuery("UPDATE vault.unit_identities SET revoked = TRUE WHERE unit_id = 'vault'");
    const refusalsBefore = (await outbox("JSON_VALUE(body, '$.event') IN ('VAULT_REQUEST_REFUSED', 'VAULT_REFUSALS_AGGREGATED')")).length;
    try {
      for (let i = 0; i < 6; i++) {
        await stack.vaultStore.setSecret('loop/probe', String(i)); // work for the relay
        await adminQuery("UPDATE vault.event_outbox SET next_attempt_at = UTC_TIMESTAMP(3) WHERE receipt IS NULL");
        await lane.tick(); // Logger asks Vault to check the revoked credential, and refuses the delivery
      }
      assert.ok(Number((await adminQuery("SELECT COUNT(*) AS n FROM vault.event_outbox WHERE receipt IS NULL AND attempts >= 6"))[0].n) >= 1,
        'the deliveries were refused');
      await stack.refusals.flush();
      const added = (await outbox("JSON_VALUE(body, '$.event') IN ('VAULT_REQUEST_REFUSED', 'VAULT_REFUSALS_AGGREGATED')")).length - refusalsBefore;
      assert.ok(added >= 1 && added <= 2, `refusal rows added for six refused deliveries: ${added}`);
      const [record] = await outbox("JSON_VALUE(body, '$.event') = 'VAULT_REQUEST_REFUSED' AND JSON_VALUE(body, '$.data.action') = 'identity.check'");
      assert.deepEqual([record.entry.data.unit, record.entry.data.reason], ['vault', 'CREDENTIAL_NOT_CURRENT']);
      assert.doesNotMatch(record.body, /eyJ|Bearer/);
    } finally {
      await adminQuery("UPDATE vault.unit_identities SET revoked = FALSE WHERE unit_id = 'vault'");
      await lane.close();
    }
  });
});
