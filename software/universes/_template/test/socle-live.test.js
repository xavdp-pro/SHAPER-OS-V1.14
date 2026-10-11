/**
 * Smoke test of a running universe derived from the template — run after
 * deploy/podman-up.sh, inside the universe container (default ports; the env
 * overrides match the manifest).
 *
 * It checks only what any outside caller may see: each base unit answers a
 * minimal open health, and refuses an anonymous read or write (401). It
 * creates nothing — every write it attempts must be refused — so it leaves no
 * job, no event and no secret behind. It is not the proof: deploy/proof.sh is
 * (the Rule 26 inventory of every unit, its identity, one real effect each,
 * under the credentials Vault issues to the proof's own identity).
 *
 * Intent: software/universes/_template/INTENT.md#proof
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const VAULT_URL = process.env.VAULT_URL || 'http://127.0.0.1:8610';
const LOGGER_URL = process.env.LOGGER_URL || 'http://127.0.0.1:8620';
const MAESTRO_URL = process.env.MAESTRO_URL || 'http://127.0.0.1:8630';
const QUEUE_URL = process.env.QUEUE_URL || 'http://127.0.0.1:8640';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

test('template-socle-live — each base unit answers its open health, and only that', async () => {
  for (const [url, service] of [[VAULT_URL, 'brick-vault'], [LOGGER_URL, 'brick-logger'], [QUEUE_URL, 'brick-queue'], [MAESTRO_URL, 'brick-maestro']]) {
    const res = await fetch(`${url}/api/health`);
    assert.equal(res.status, 200, `${service} health`);
    const body = await res.json();
    assert.equal(body.status, 'ok', `${service} reports ok`);
    assert.equal(body.service, service);
  }
  // Queue's open health is minimal: no count, no account, no payload.
  const queue = await (await fetch(`${QUEUE_URL}/api/health`)).json();
  assert.deepEqual(Object.keys(queue).sort(), ['service', 'status', 'timestamp']);
});

test('template-socle-live — Vault refuses an anonymous secret read', async () => {
  const res = await fetch(`${VAULT_URL}/api/secret/socle-live/absent`);
  assert.equal(res.status, 401);
});

test('template-socle-live — Logger refuses an anonymous ingest, so nothing is written', async () => {
  const res = await fetch(`${LOGGER_URL}/api/ingest`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ pod: 'template-socle-live', level: 'INFO', event: 'SOCLE_LIVE_ANONYMOUS', data: {} }),
  });
  assert.equal(res.status, 401);
});

test('template-socle-live — Queue refuses an anonymous enqueue, read and claim, so no job is created', async () => {
  const enqueue = await fetch(`${QUEUE_URL}/api/jobs`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ type: 'socle-live', payload: {}, totalSteps: 1 }),
  });
  assert.equal(enqueue.status, 401);
  assert.equal((await fetch(`${QUEUE_URL}/api/jobs`)).status, 401);
  const claim = await fetch(`${QUEUE_URL}/api/jobs/socle-live/claim`, { method: 'POST', headers: JSON_HEADERS, body: '{}' });
  assert.equal(claim.status, 401);
});

test('template-socle-live — Maestro refuses an anonymous read and registration', async () => {
  assert.equal((await fetch(`${MAESTRO_URL}/api/tasks`)).status, 401);
  const register = await fetch(`${MAESTRO_URL}/api/tasks/register`, { method: 'POST', headers: JSON_HEADERS, body: '{}' });
  assert.equal(register.status, 401);
});
