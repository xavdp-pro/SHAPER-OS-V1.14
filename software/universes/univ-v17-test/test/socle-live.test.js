import test from 'node:test';
import assert from 'node:assert/strict';

const urls = {
  vault: process.env.VAULT_URL || 'http://127.0.0.1:8610',
  logger: process.env.LOGGER_URL || 'http://127.0.0.1:8620',
  bridge: process.env.BRIDGE_URL || 'http://127.0.0.1:4440',
  queue: process.env.QUEUE_URL || 'http://127.0.0.1:8640',
  maestro: process.env.MAESTRO_URL || 'http://127.0.0.1:8630',
};

test('all five manifest services are healthy', async () => {
  for (const [name, base] of Object.entries(urls)) {
    const response = await fetch(`${base}/api/health`);
    assert.equal(response.status, 200, `${name} health status`);
    const body = await response.json();
    assert.equal(name === 'bridge' ? body.ok : body.status, name === 'bridge' ? true : 'ok');
  }
});

test('logger accepts a clean-sheet proof event', async () => {
  const response = await fetch(`${urls.logger}/api/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pod: 'univ-v17-test',
      level: 'INFO',
      event: 'V17_CLEAN_SHEET_LIVE_OK',
      data: { source: '@shaper/univ-v17-test test:live' },
    }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.record.event, 'V17_CLEAN_SHEET_LIVE_OK');
});
