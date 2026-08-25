import test from 'node:test';
import assert from 'node:assert/strict';

const VAULT_URL = process.env.VAULT_URL || 'http://127.0.0.1:8610';
const LOGGER_URL = process.env.LOGGER_URL || 'http://127.0.0.1:8620';
const MAESTRO_URL = process.env.MAESTRO_URL || 'http://127.0.0.1:8630';
const QUEUE_URL = process.env.QUEUE_URL || 'http://127.0.0.1:8640';
const BRIDGE_URL = process.env.BRIDGE_URL || 'http://127.0.0.1:4440';
const HELM_URL = process.env.HELM_URL || 'http://127.0.0.1:8650';

test('univ9-live-socle — verify all core socle endpoints are operational', async () => {
  // 1. Vault
  const vaultRes = await fetch(`${VAULT_URL}/health`);
  assert.equal(vaultRes.status, 200);
  const vault = await vaultRes.json();
  assert.equal(vault.status, 'ok');

  // 2. Logger
  const loggerRes = await fetch(`${LOGGER_URL}/health`);
  assert.equal(loggerRes.status, 200);
  const logger = await loggerRes.json();
  assert.equal(logger.status, 'ok');

  // 3. OpenCode Bridge
  const bridgeRes = await fetch(`${BRIDGE_URL}/api/health`);
  assert.equal(bridgeRes.status, 200);
  const bridge = await bridgeRes.json();
  assert.equal(bridge.ok, true);

  // 4. Queue
  const queueRes = await fetch(`${QUEUE_URL}/health`);
  assert.equal(queueRes.status, 200);
  const queue = await queueRes.json();
  assert.equal(queue.status, 'ok');

  // 5. Maestro
  const maestroRes = await fetch(`${MAESTRO_URL}/health`);
  assert.equal(maestroRes.status, 200);
  const maestro = await maestroRes.json();
  assert.equal(maestro.status, 'ok');

  // 6. Shaper-Helm Tout-en-Un (MariaDB embarqué)
  const helmRes = await fetch(`${HELM_URL}/api/health`);
  assert.equal(helmRes.status, 200);
  const helm = await helmRes.json();
  assert.equal(helm.ok, true);
});

test('univ9-live-socle — test Shaper-Helm Maestro UI API', async () => {
  const res = await fetch(`${HELM_URL}/api/maestro/tasks`, {
    headers: { 'Authorization': 'Bearer univ9-test-token' }
  });
  // Note: returns 401 if unauth, or list if valid token
  assert.ok([200, 401].includes(res.status));
});

test('univ9-live-socle — test Shaper-Helm Socle Health API', async () => {
  const res = await fetch(`${HELM_URL}/api/socle/health`, {
    headers: { 'Authorization': 'Bearer univ9-test-token' }
  });
  assert.ok([200, 401].includes(res.status));
});
