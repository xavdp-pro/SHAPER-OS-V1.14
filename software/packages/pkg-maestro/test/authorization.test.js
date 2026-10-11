import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

import { CredentialError, createUnitAuthorizer, issueCredential } from '../../pkg-auth/unit-credentials.js';
import { MAESTRO_SCOPES, createMaestroServer } from '../index.js';
import { DurableMaestro } from '../durable-scheduler.js';

// Intent: software/packages/pkg-maestro/INTENT.md#authorization
// DECISIONS-20261011 §E: every Maestro route but a minimal health requires a
// Vault-signed credential for audience `maestro` — maestro:read to read,
// maestro:admin to register, tick, start and stop — and Maestro calls Queue
// under its own `queue` credential.

const universe = '550e8400-e29b-41d4-a716-446655440000';
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
let current = 'yes';
const authorizeRequest = createUnitAuthorizer({
  publicKey, universe, audience: 'maestro',
  checkCurrent: async () => { if (current === 'down') throw new CredentialError('IDENTITY_UNAVAILABLE', 503); return current === 'yes'; },
});
const credential = (scopes, audience = 'maestro') => issueCredential(
  { universe, unit: 'proof', incarnation: 'proof-1', audience, scopes, epoch: 1, revocationRef: 'proof:1' }, privateKey).token;

const scheduler = {
  service: 'brick-maestro',
  isRunning: false,
  health: async () => ({ ok: true, body: { status: 'ok', service: 'brick-maestro', timestamp: 'now' } }),
  vitals: async () => ({ service: 'brick-maestro' }),
  listRegisteredTasks: async () => [],
  listOccurrences: async () => [],
  registerTask: async (task) => ({ slug: task.slug }),
  triggerBeat: async () => ({ ok: true }),
  startScheduler: async () => null,
  stopScheduler: () => {},
};

async function withServer(work) {
  const server = createMaestroServer({ port: 0, host: '127.0.0.1', scheduler, authorizeRequest });
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, token) => {
    const res = await fetch(`${base}${path}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: method === 'POST' ? JSON.stringify({ slug: 'task-x', cadenceSeconds: 60 }) : undefined });
    return { status: res.status, body: await res.json() };
  };
  try { await work(call); } finally { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); }
}

const READS = [['GET', '/api/tasks'], ['GET', '/api/occurrences'], ['GET', '/api/vitals']];
const ADMIN = [['POST', '/api/tasks/register'], ['POST', '/api/tasks/task-x/tick'], ['POST', '/api/scheduler/start'], ['POST', '/api/scheduler/stop']];

describe('Maestro answers credentials only', () => {
  it('a minimal health is open; everything else refuses an absent credential (401)', async () => {
    await withServer(async (call) => {
      assert.equal((await call('GET', '/api/health')).status, 200);
      for (const [m, p] of [...READS, ...ADMIN]) assert.equal((await call(m, p)).status, 401, `${m} ${p}`);
    });
  });

  it('maestro:read reads and administers nothing; maestro:admin administers', async () => {
    await withServer(async (call) => {
      const reader = credential([MAESTRO_SCOPES.read]);
      const admin = credential([MAESTRO_SCOPES.admin]);
      for (const [m, p] of READS) assert.equal((await call(m, p, reader)).status, 200, `${m} ${p}`);
      for (const [m, p] of ADMIN) {
        assert.equal((await call(m, p, reader)).body.code, 'CREDENTIAL_SCOPE_DENIED', `${m} ${p}`);
        assert.equal((await call(m, p, admin)).status, 200, `${m} ${p}`);
      }
      for (const [m, p] of READS) assert.equal((await call(m, p, admin)).status, 403, 'admin is a separate grant, not a superset');
    });
  });

  it('another audience 403, revoked 403, unverifiable 503', async () => {
    await withServer(async (call) => {
      assert.equal((await call('GET', '/api/tasks', credential([MAESTRO_SCOPES.read], 'queue'))).status, 403);
      const token = credential([MAESTRO_SCOPES.read]);
      current = 'no';
      try {
        assert.equal((await call('GET', '/api/tasks', token)).status, 403);
        current = 'down';
        assert.equal((await call('GET', '/api/tasks', token)).status, 503);
      } finally { current = 'yes'; }
    });
  });

  it('the durable scheduler is never served without an authorizer', () => {
    assert.throws(() => createMaestroServer({ port: 0, host: '127.0.0.1', scheduler }), { code: 'MAESTRO_AUTH_REQUIRED' });
  });
});

describe('Maestro calls Queue under its own queue credential', () => {
  it('every enqueue and lookup carries the header its credential client renews', async () => {
    const seen = [];
    const maestro = new DurableMaestro({
      store: {}, universeId: universe, queueUrl: 'http://127.0.0.1:8640',
      credentials: async () => ({ Authorization: 'Bearer renewed-queue-credential' }),
      fetchImpl: async (url, opts) => { seen.push([url, opts.headers.Authorization]); return { status: 201, ok: true, json: async () => ({ job: { id: 'j1' }, duplicate: false }) }; },
    });
    await maestro._post('{"type":"t"}');
    await maestro._lookup('occ-1');
    assert.deepEqual(seen.map(([, h]) => h), ['Bearer renewed-queue-credential', 'Bearer renewed-queue-credential']);
  });
});
