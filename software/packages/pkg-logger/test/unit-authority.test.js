import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { generateKeyPairSync } from 'node:crypto';
import { createLoggerServer } from '../index.js';
import { buildRecord } from '../ingest-contract.js';
import { createUnitAuthorizer, issueCredential } from '../../pkg-auth/unit-credentials.js';

const universe = '550e8400-e29b-41d4-a716-446655440000';
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
test('Logger HTTP refuses anonymous, forged-source, foreign-reader, expired and revoked credentials', async () => {
  let active = true;
  const records = [];
  // Protocol fixture: this test proves HTTP authority, not database persistence.
  const store = { storageKind: 'mariadb', emitter: new EventEmitter(),
    ingest: async (claims) => claims.map((c) => { const record = buildRecord(c, { id: `r${records.length}`, receivedAtMs: Date.now() }); records.push(record); return { record }; }),
    query: async (filters) => records.filter((r) => r.pod === filters.pod),
  };
  assert.throws(() => createLoggerServer({ store, port: 0 }), { code: 'LOGGER_AUTH_REQUIRED' });
  const authorizeRequest = createUnitAuthorizer({ publicKey, universe, audience: 'logger', checkCurrent: async () => active });
  const server = createLoggerServer({ store, authorizeRequest, port: 0, host: '127.0.0.1' });
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const identity = { universe, unit: 'queue', incarnation: 'inc-1', audience: 'logger',
    scopes: ['logger:ingest', 'logger:read:own'], epoch: 1, revocationRef: 'queue:1' };
  const token = issueCredential(identity, privateKey).token;
  const post = (body, bearer = token) => fetch(`${base}/api/ingest`, { method: 'POST', headers: {
    'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body) });
  try {
    assert.equal((await post({ event: 'PROBE' }, null)).status, 401);
    assert.equal((await post({ pod: 'vault', event: 'PROBE' })).status, 403);
    assert.equal(records.length, 0);
    assert.equal((await post({ event: 'PROBE' })).status, 200);
    assert.equal(records[0].pod, 'queue');
    const headers = { Authorization: `Bearer ${token}` };
    assert.equal((await fetch(`${base}/api/events/last?pod=vault`, { headers })).status, 403);
    assert.equal((await (await fetch(`${base}/api/events/last`, { headers })).json()).events.length, 1);
    const expired = issueCredential(identity, privateKey, { now: Date.now()-301000 }).token;
    assert.equal((await post({ event: 'PROBE' }, expired)).status, 401);
    active = false;
    assert.equal((await post({ event: 'PROBE' })).status, 403);
    assert.equal(records.length, 1);
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});
