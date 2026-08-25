import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sshTargetsForMachine } from './remoteFs.js';

describe('sshTargetsForMachine', () => {
  it('prefers WireGuard gbs-asus before LAN Host asus', () => {
    assert.deepEqual(sshTargetsForMachine('asus', 'zaza'), [
      'gbs-asus',
      'zaza@gbs-asus',
      'asus',
      'zaza@asus',
    ]);
  });

  it('prefers gbs-acer for acer', () => {
    const targets = sshTargetsForMachine('acer', 'zaza');
    assert.equal(targets[0], 'gbs-acer');
    assert.ok(targets.includes('acer'));
  });

  it('keeps gbs-h1 as-is', () => {
    assert.deepEqual(sshTargetsForMachine('gbs-h1', 'zaza'), [
      'gbs-h1',
      'zaza@gbs-h1',
    ]);
  });
});
