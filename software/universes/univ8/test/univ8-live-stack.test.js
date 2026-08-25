import test from 'node:test';
import assert from 'node:assert/strict';

const VAULT_URL = process.env.VAULT_URL || 'http://127.0.0.1:8610';
const LOGGER_URL = process.env.LOGGER_URL || 'http://127.0.0.1:8620';
const MAESTRO_URL = process.env.MAESTRO_URL || 'http://127.0.0.1:8630';
const QUEUE_URL = process.env.QUEUE_URL || 'http://127.0.0.1:8640';
const BRIDGE_URL = process.env.BRIDGE_URL || 'http://127.0.0.1:4440';
const HELM_URL = process.env.HELM_URL || 'http://127.0.0.1:8650';

test('univ8-live-stack — verify all 6 core socle HTTP endpoints live', async () => {
  // 1. Vault
  const vaultRes = await fetch(`${VAULT_URL}/health`);
  assert.equal(vaultRes.status, 200);
  const vault = await vaultRes.json();
  assert.equal(vault.status, 'ok');
  assert.equal(vault.service, 'vault-v1');

  // 2. Logger
  const loggerRes = await fetch(`${LOGGER_URL}/health`);
  assert.equal(loggerRes.status, 200);
  const logger = await loggerRes.json();
  assert.equal(logger.status, 'ok');
  assert.equal(logger.service, 'logger-v1');

  // 3. OpenCode Bridge
  const bridgeRes = await fetch(`${BRIDGE_URL}/api/health`);
  assert.equal(bridgeRes.status, 200);
  const bridge = await bridgeRes.json();
  assert.equal(bridge.ok, true);
  assert.equal(bridge.service, 'opencode-bridge');

  // 4. Queue
  const queueRes = await fetch(`${QUEUE_URL}/health`);
  assert.equal(queueRes.status, 200);
  const queue = await queueRes.json();
  assert.equal(queue.status, 'ok');
  assert.equal(queue.service, 'queue-v1');

  // 5. Maestro
  const maestroRes = await fetch(`${MAESTRO_URL}/health`);
  assert.equal(maestroRes.status, 200);
  const maestro = await maestroRes.json();
  assert.equal(maestro.status, 'ok');
  assert.equal(maestro.service, 'maestro-v1');
  assert.equal(maestro.isRunning, true);

  // 6. Helm Web Chat
  const helmRes = await fetch(`${HELM_URL}/api/health`);
  assert.equal(helmRes.status, 200);
  const helm = await helmRes.json();
  assert.equal(helm.ok, true);
  assert.equal(helm.service, 'helm-v2');
});

test('univ8-live-stack — test queue job create, update & status in live queue container', async () => {
  const pushRes = await fetch(`${QUEUE_URL}/api/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'agent-sync',
      payload: { action: 'test-ping', timestamp: Date.now() },
      totalSteps: 2,
    }),
  });
  assert.equal(pushRes.status, 201);
  const pushed = await pushRes.json();
  assert.equal(pushed.status, 'ok');
  assert.ok(pushed.job?.id);

  const getRes = await fetch(`${QUEUE_URL}/api/jobs/${pushed.job.id}`);
  assert.equal(getRes.status, 200);
  const fetched = await getRes.json();
  assert.equal(fetched.status, 'ok');
  assert.equal(fetched.job.id, pushed.job.id);

  const updateRes = await fetch(`${QUEUE_URL}/api/jobs/${pushed.job.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'COMPLETED', progress: 100, currentStep: 2 }),
  });
  assert.equal(updateRes.status, 200);
  const updated = await updateRes.json();
  assert.equal(updated.status, 'ok');
  assert.equal(updated.job.status, 'COMPLETED');
});

test('univ8-live-stack — test logger audit ingestion in live logger container', async () => {
  const logRes = await fetch(`${LOGGER_URL}/api/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pod: 'socle-audit-test',
      level: 'INFO',
      event: 'SOCLE_VERIFIED',
      data: { status: 'all-systems-operational' },
    }),
  });
  assert.equal(logRes.status, 200);
  const logged = await logRes.json();
  assert.equal(logged.status, 'ok');
  assert.equal(logged.record.pod, 'socle-audit-test');
  assert.equal(logged.record.event, 'SOCLE_VERIFIED');
});
