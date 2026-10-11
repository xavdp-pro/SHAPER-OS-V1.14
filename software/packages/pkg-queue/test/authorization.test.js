import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

import { CredentialError, createUnitAuthorizer, issueCredential } from '../../pkg-auth/unit-credentials.js';
import { JobQueue, QUEUE_SCOPES, createQueueServer } from '../index.js';
import { MariaDbJobQueue } from '../mariadb-store.js';

// Intent: software/packages/pkg-queue/INTENT.md#authorization
// DECISIONS-20261011 §E: every Queue route but a minimal health requires a
// Vault-signed credential for audience `queue` and the route's own scope —
// 401 absent or invalid, 403 audience, scope or revocation, 503 when the
// authority cannot be verified. Claims and attempts bind to the credential's
// unit and incarnation. The real Vault check is proven live
// (pkg-maestro/test/queue-authorization.live.mjs).

const universe = '550e8400-e29b-41d4-a716-446655440000';
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
let current = 'yes';
const authorizeRequest = createUnitAuthorizer({
  publicKey, universe, audience: 'queue',
  checkCurrent: async () => {
    if (current === 'down') throw new CredentialError('IDENTITY_UNAVAILABLE', 503);
    return current === 'yes';
  },
});
const credential = (unit, scopes, { audience = 'queue', incarnation = `${unit}-1` } = {}) => issueCredential(
  { universe, unit, incarnation, audience, scopes, epoch: 1, revocationRef: `${unit}:1` }, privateKey).token;
const ALL = Object.values(QUEUE_SCOPES);

let server, base;
before(async () => {
  server = createQueueServer({ port: 0, host: '127.0.0.1', queue: new JobQueue(), authorizeRequest });
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function call(method, path, { token = null, body } = {}) {
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text.startsWith('{') ? JSON.parse(text) : text };
}

describe('only a minimal health is open', () => {
  it('health answers status, service and time, nothing more', async () => {
    const h = await call('GET', '/api/health');
    assert.equal(h.status, 200);
    assert.deepEqual(Object.keys(h.body).sort(), ['service', 'status', 'timestamp']);
  });

  it('every other route refuses an absent credential (401) and a malformed one (401)', async () => {
    for (const [method, path, body] of [['GET', '/api/jobs'], ['GET', '/api/jobs/job-x'], ['GET', '/api/vitals'], ['GET', '/api/capacity'],
      ['GET', '/api/jobs/events'], ['POST', '/api/jobs', { type: 't' }], ['POST', '/api/jobs/job-x/claim', {}], ['PATCH', '/api/jobs/job-x', {}]]) {
      const anonymous = await call(method, path, { body });
      assert.equal(anonymous.status, 401, `${method} ${path}`);
      assert.equal(anonymous.body.code, 'CREDENTIAL_INVALID');
      assert.equal((await call(method, path, { body, token: 'not.a-credential' })).status, 401, `${method} ${path}`);
    }
  });
});

describe('separate grants: enqueue, read, claim, attempt', () => {
  it('each route takes its own scope and refuses the others (403 CREDENTIAL_SCOPE_DENIED)', async () => {
    const enqueuer = credential('maestro', [QUEUE_SCOPES.enqueue]);
    const reader = credential('watcher', [QUEUE_SCOPES.read]);
    const created = await call('POST', '/api/jobs', { token: enqueuer, body: { type: 'grant.check' } });
    assert.equal(created.status, 201);
    const id = created.body.job.id;
    assert.equal((await call('GET', `/api/jobs/${id}`, { token: enqueuer })).body.code, 'CREDENTIAL_SCOPE_DENIED');
    assert.equal((await call('GET', `/api/jobs/${id}`, { token: reader })).status, 200);
    assert.equal((await call('POST', '/api/jobs', { token: reader, body: { type: 't' } })).status, 403);
    assert.equal((await call('POST', `/api/jobs/${id}/claim`, { token: reader, body: {} })).status, 403);
    const claimer = credential('worker-a', [QUEUE_SCOPES.claim]);
    const claimed = await call('POST', `/api/jobs/${id}/claim`, { token: claimer, body: {} });
    assert.equal(claimed.status, 200);
    assert.deepEqual([claimed.body.attempt.consumer, claimed.body.attempt.incarnation], ['worker-a', 'worker-a-1'], 'the claim is bound to the credential');
    const update = { attempt: claimed.body.attempt.id, status: 'COMPLETED', progress: 100 };
    assert.equal((await call('PATCH', `/api/jobs/${id}`, { token: claimer, body: update })).status, 403, 'claiming does not grant updating');
    const runner = credential('worker-a', [QUEUE_SCOPES.attempt]);
    assert.equal((await call('PATCH', `/api/jobs/${id}`, { token: credential('worker-b', [QUEUE_SCOPES.attempt]), body: update })).body.code, 'ATTEMPT_FORBIDDEN');
    assert.equal((await call('PATCH', `/api/jobs/${id}`, { token: credential('worker-a', [QUEUE_SCOPES.attempt], { incarnation: 'worker-a-2' }), body: update })).body.code, 'STALE_ATTEMPT');
    const done = await call('PATCH', `/api/jobs/${id}`, { token: runner, body: update });
    assert.deepEqual([done.status, done.body.job.status], [200, 'COMPLETED']);
  });

  it('another audience is refused (403), a revoked credential too (403), and an unverifiable authority is 503', async () => {
    const all = credential('proof', ALL);
    assert.equal((await call('GET', '/api/jobs', { token: credential('proof', ALL, { audience: 'logger' }) })).body.code, 'CREDENTIAL_BOUNDARY_DENIED');
    current = 'no';
    try {
      const revoked = await call('GET', '/api/jobs', { token: all });
      assert.deepEqual([revoked.status, revoked.body.code], [403, 'CREDENTIAL_REVOKED']);
      current = 'down';
      const unverifiable = await call('GET', '/api/jobs', { token: all });
      assert.deepEqual([unverifiable.status, unverifiable.body.code], [503, 'IDENTITY_UNAVAILABLE']);
      assert.doesNotMatch(JSON.stringify(unverifiable.body), /Bearer|eyJ/);
    } finally {
      current = 'yes';
    }
    assert.equal((await call('GET', '/api/jobs', { token: all })).status, 200);
  });
});

describe('no "localhost means authorized"', () => {
  it('the MariaDB store is never served without an authorizer', () => {
    const store = new MariaDbJobQueue({ pool: { query: async () => [[]] } });
    assert.throws(() => createQueueServer({ port: 0, host: '127.0.0.1', queue: store }), { code: 'QUEUE_AUTH_REQUIRED' });
  });
});
