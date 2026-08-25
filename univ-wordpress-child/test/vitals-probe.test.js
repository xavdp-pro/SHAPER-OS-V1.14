import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { collect } from '../lib/vitals-probe.mjs';

describe('wordpress child vitals probe (Rule 23)', () => {
  it('publishes signals and checks with no root verdict keys', async () => {
    const body = await collect({
      now: Date.now(),
      fetchImpl: async () => ({ status: 200 }),
    });
    assert.equal(typeof body.signals, 'object');
    assert.equal(typeof body.checks, 'object');
    assert.equal(body.status, undefined);
    assert.equal(body.ok, undefined);
    assert.equal(body.healthy, undefined);
    assert.equal(typeof body.uptimeSeconds === 'number' || body.uptimeSeconds === null, true);
  });
});
