/**
 * Tier-b live test — Helm /console (requires WITH_HELM=1 in podman-up.sh).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const HELM_URL = process.env.HELM_URL || 'http://127.0.0.1:8650';

test('template-helm-live — health and demo login', async () => {
  const healthRes = await fetch(`${HELM_URL}/api/health`);
  assert.equal(healthRes.status, 200);
  const health = await healthRes.json();
  assert.equal(health.ok, true);
  assert.equal(health.service, 'helm-v2');

  const loginRes = await fetch(`${HELM_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'thesuperuser@helm.local',
      password: '123Soleil123!',
    }),
  });
  assert.equal(loginRes.status, 200);
  const login = await loginRes.json();
  assert.equal(login.ok, true);
  assert.ok(login.token);
});
