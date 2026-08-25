/**
 * Golden-path live test — tier-a DEV stack (no Helm).
 * Run after podman-up.sh with default ports. Env overrides match podman-up.sh.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const VAULT_URL = process.env.VAULT_URL || 'http://127.0.0.1:8610';
const LOGGER_URL = process.env.LOGGER_URL || 'http://127.0.0.1:8620';
const MAESTRO_URL = process.env.MAESTRO_URL || 'http://127.0.0.1:8630';
const QUEUE_URL = process.env.QUEUE_URL || 'http://127.0.0.1:8640';
const BRIDGE_URL = process.env.BRIDGE_URL || 'http://127.0.0.1:4440';

test('template-socle-live — five core HTTP endpoints healthy', async () => {
  const vaultRes = await fetch(`${VAULT_URL}/api/health`);
  assert.equal(vaultRes.status, 200);
  const vault = await vaultRes.json();
  assert.equal(vault.status, 'ok');

  const loggerRes = await fetch(`${LOGGER_URL}/api/health`);
  assert.equal(loggerRes.status, 200);
  const logger = await loggerRes.json();
  assert.equal(logger.status, 'ok');

  const bridgeRes = await fetch(`${BRIDGE_URL}/api/health`);
  assert.equal(bridgeRes.status, 200);
  const bridge = await bridgeRes.json();
  assert.equal(bridge.ok, true);

  const queueRes = await fetch(`${QUEUE_URL}/api/health`);
  assert.equal(queueRes.status, 200);
  const queue = await queueRes.json();
  assert.equal(queue.status, 'ok');

  const maestroRes = await fetch(`${MAESTRO_URL}/api/health`);
  assert.equal(maestroRes.status, 200);
  const maestro = await maestroRes.json();
  assert.equal(maestro.status, 'ok');
  assert.equal(maestro.isRunning, true);
});

test('template-socle-live — queue job round-trip', async () => {
  const pushRes = await fetch(`${QUEUE_URL}/api/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'agent-sync',
      payload: { action: 'template-live-ping', timestamp: Date.now() },
      totalSteps: 1,
    }),
  });
  assert.equal(pushRes.status, 201);
  const pushed = await pushRes.json();
  assert.ok(pushed.job?.id);

  const getRes = await fetch(`${QUEUE_URL}/api/jobs/${pushed.job.id}`);
  assert.equal(getRes.status, 200);
  const fetched = await getRes.json();
  assert.equal(fetched.job.id, pushed.job.id);
});

test('template-socle-live — logger ingest', async () => {
  const logRes = await fetch(`${LOGGER_URL}/api/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pod: 'template-socle-live',
      level: 'INFO',
      event: 'SOCLE_LIVE_OK',
      data: { source: 'npm run test:live' },
    }),
  });
  assert.equal(logRes.status, 200);
  const logged = await logRes.json();
  assert.equal(logged.record.event, 'SOCLE_LIVE_OK');
});
