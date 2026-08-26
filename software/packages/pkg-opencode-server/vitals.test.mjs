import test from 'node:test';
import assert from 'node:assert/strict';
import { opencodeBridgeVitals } from './vitals.mjs';

test('opencode bridge vitals publish evidence without a verdict', () => {
  const body = opencodeBridgeVitals({
    startedAt: 1_000,
    now: 4_000,
    ready: true,
    model: 'opencode/example-free',
    stub: false,
    conversations: 2,
    activeRuns: 1,
    eventClients: 3,
    servePid: 42,
  });
  assert.equal(body.service, 'brick-bridge-opencode');
  assert.equal(body.uptimeSeconds, 3);
  assert.equal(body.signals.model, 'opencode/example-free');
  assert.equal(body.signals.stub, false);
  assert.equal(body.signals.activeRuns, 1);
  assert.equal(body.checks.opencodeServe.ready, true);
  assert.equal('healthy' in body, false);
  assert.equal('verdict' in body, false);
});
