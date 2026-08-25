import test from 'node:test';
import assert from 'node:assert/strict';

const HELM_URL = process.env.HELM_URL || 'http://127.0.0.1:8650';

test('univ8-helm — health check & demo login', async () => {
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
  assert.equal(login.user.email, 'thesuperuser@helm.local');
});

test('univ8-helm — Deepgram STT/TTS voice status', async () => {
  const loginRes = await fetch(`${HELM_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'thesuperuser@helm.local',
      password: '123Soleil123!',
    }),
  });
  const { token } = await loginRes.json();

  const voiceRes = await fetch(`${HELM_URL}/api/voice/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(voiceRes.status, 200);
  const voice = await voiceRes.json();
  assert.equal(voice.provider, 'deepgram');
  assert.equal(voice.sttProvider, 'deepgram');
  assert.equal(voice.sttModel, 'nova-3');
  assert.equal(voice.configured, true);
});

test('univ8-helm — chat injection to OpenCode bridge', async () => {
  const loginRes = await fetch(`${HELM_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'thesuperuser@helm.local',
      password: '123Soleil123!',
    }),
  });
  const { token } = await loginRes.json();

  const injectRes = await fetch(`${HELM_URL}/api/inject`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      message: 'Ping from automated unit test',
      conversation: 'Demo',
    }),
  });
  assert.equal(injectRes.status, 200);
  const inject = await injectRes.json();
  assert.equal(inject.ok, true);
  assert.equal(inject.plugin, 'opencode');
  assert.ok(inject.run_id);
});
