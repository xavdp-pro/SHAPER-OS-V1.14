import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sessionNameFromPath } from './workspaceTemplates.js';

describe('sessionNameFromPath', () => {
  it('uses the final directory segment', () => {
    assert.equal(sessionNameFromPath('/home/zaza/Bureau/CURSOR'), 'CURSOR');
    assert.equal(sessionNameFromPath('/home/zaza/Bureau/NOW3'), 'NOW3');
  });

  it('uses apps project name for turbobash app layout', () => {
    assert.equal(sessionNameFromPath('/apps/helm-v2/app'), 'helm-v2');
  });
});
