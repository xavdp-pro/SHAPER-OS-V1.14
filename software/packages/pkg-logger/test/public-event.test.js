import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { generateKeyPairSync } from 'node:crypto';
import { normalizeIngestEntry } from '../ingest-contract.js';
import { formatEventRecord } from '../events.js';
import { createLoggerServer } from '../index.js';
import { MariaDbLoggerStore } from '../mariadb-store.js';
import { issueCredential } from '../../pkg-auth/unit-credentials.js';
const universe = '6a4f914b-d7a8-49dc-8d06-70ce11e6d762';
const base = { pod: 'queue', event: 'PUBLIC_PROOF', executionId: 'proof-1', sourceEventId: 'proof-1', data: {} };
const normalize = (data) => normalizeIngestEntry({ ...base, data });
test('nested secret fields and known live credential encodings are refused without content reflection', () => {
  const { privateKey } = generateKeyPairSync('ed25519');
  const token = issueCredential({ universe, unit: 'queue', incarnation: 'q1', audience: 'logger', scopes: ['logger:ingest'], epoch: 1, revocationRef: 'q:1' }, privateKey).token;
  for (const data of [{ nested: [{ client_secret: 'PRIVATE_SENTINEL' }] }, { API_KEY: 'PRIVATE_SENTINEL' },
    { note: token }, { note: `Bearer ${token}` }, { note: '-----BEGIN PRIVATE KEY-----' },
    { note: 'sk-' + 'x'.repeat(24) }, { note: 'mysql://user:PRIVATE_SENTINEL@localhost/db' },
    { note: 'https://example.invalid/?access_token=PRIVATE_SENTINEL' }, { headers: { Cookie: 'PRIVATE_SENTINEL' } }]) {
    assert.throws(() => normalize(data), error => error.code === 'EVENT_SECRET_DENIED' && !error.message.includes('PRIVATE_SENTINEL'));
    assert.throws(() => formatEventRecord({ ...base, data }), { code: 'EVENT_SECRET_DENIED' });
  }
  assert.throws(() => normalizeIngestEntry({ ...base, ignored: { password: 'PRIVATE_SENTINEL' } }), { code: 'EVENT_SECRET_DENIED' });
});
test('durable references, public digests and credential-free telemetry remain usable', () => {
  const data = { secretRef: 'vault:provider-slot', artifactRef: 'artifact:proof-1', digest: 'a'.repeat(64), tokenCount: 42, passwordSource: 'protected-file' };
  assert.deepEqual(normalize(data).data, data);
});
test('binary, cyclic, getter-bearing and deeply nested graphs are refused before serialization', () => {
  for (const data of [{ bytes: Buffer.from('private') }, { bytes: new Uint8Array(8) }, { type: 'Buffer', data: [1, 2] }]) {
    assert.throws(() => normalize(data), { code: 'EVENT_BINARY_DENIED' });
  }
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => normalize(cyclic), { code: 'EVENT_NON_JSON_DENIED' });
  let called = false;
  assert.throws(() => normalize({ get value() { called = true; return 'private'; } }), { code: 'EVENT_NON_JSON_DENIED' });
  assert.equal(called, false);
  let deep = {}; for (let i = 0; i < 34; i++) deep = { child: deep };
  assert.throws(() => normalize(deep), { code: 'EVENT_STRUCTURE_TOO_LARGE' });
});
test('the MariaDB owning boundary refuses an unnormalized secret before opening a transaction', async () => {
  let called = false;
  const store = new MariaDbLoggerStore({ pool: { getConnection: async () => { called = true; throw new Error('unexpected'); } } });
  await assert.rejects(store.ingest([{ ...base, data: { password: 'PRIVATE_SENTINEL' } }]), { code: 'EVENT_SECRET_DENIED' });
  assert.equal(called, false);
});
test('HTTP batch refusal writes nothing and malformed/storage errors do not echo body content', async () => {
  let calls = 0, failStore = false;
  const store = { storageKind: 'mariadb', emitter: new EventEmitter(), ingest: async () => {
    calls++; if (failStore) throw new Error('PRIVATE_SENTINEL'); return [];
  } };
  const server = createLoggerServer({ store, port: 0, host: '127.0.0.1', authorizeRequest: async () => ({ universe, unit: 'queue', incarnation: 'q1' }) });
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/ingest`;
  const post = body => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  try {
    let response = await post(JSON.stringify([base, { ...base, data: { password: 'PRIVATE_SENTINEL' } }]));
    assert.equal(response.status, 400); assert.doesNotMatch(await response.text(), /PRIVATE_SENTINEL/); assert.equal(calls, 0);
    response = await post('{"PRIVATE_SENTINEL":bad}');
    assert.equal(response.status, 400); assert.doesNotMatch(await response.text(), /PRIVATE_SENTINEL/); assert.equal(calls, 0);
    failStore = true; response = await post(JSON.stringify(base));
    assert.equal(response.status, 500); assert.doesNotMatch(await response.text(), /PRIVATE_SENTINEL/); assert.equal(calls, 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
