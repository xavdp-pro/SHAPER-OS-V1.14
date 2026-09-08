import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CAPABILITIES,
  SHAPER_BRIDGE_PROTOCOL,
  bridgeStatus,
  validateBridgeStatus,
} from '../index.js';

test('bridge status is provider-neutral and complete', () => {
  const status = bridgeStatus({
    service: 'private-runtime-bridge',
    ready: true,
    capabilities: { stopRun: true, bindWorkspace: true },
  });
  assert.equal(status.protocol, SHAPER_BRIDGE_PROTOCOL);
  assert.equal(status.capabilities.stopRun, true);
  assert.equal(status.capabilities.bindWorkspace, true);
  assert.deepEqual(validateBridgeStatus(status), []);
});

test('a partial or provider-shaped response is refused', () => {
  assert.deepEqual(validateBridgeStatus({ service: 'some-model', ready: true }), [
    `protocol must be ${SHAPER_BRIDGE_PROTOCOL}`,
    'capabilities must be an object',
  ]);
  assert.equal(Object.keys(DEFAULT_CAPABILITIES).includes('provider'), false);
});
