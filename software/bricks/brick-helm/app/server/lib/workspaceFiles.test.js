import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mimeForPath,
  isAllowedWorkspacePath,
  resolveWorkspaceAbsPath,
} from './workspaceFiles.js';

describe('workspaceFiles', () => {
  it('maps mime types', () => {
    assert.equal(mimeForPath('/tmp/plot.png'), 'image/png');
    assert.equal(mimeForPath('/tmp/doc.PDF'), 'application/pdf');
  });

  it('allows only safe workspace prefixes', () => {
    assert.equal(isAllowedWorkspacePath('/apps/helm-v2/ws/x.png'), true);
    assert.equal(isAllowedWorkspacePath('/home/zaza/x.pdf'), true);
    assert.equal(isAllowedWorkspacePath('/etc/passwd'), false);
    assert.equal(isAllowedWorkspacePath('/apps/../etc/passwd'), false);
  });

  it('resolves absolute and relative paths', () => {
    assert.equal(
      resolveWorkspaceAbsPath('out/chart.png', '/apps/helm-v2/ws/Demo'),
      '/apps/helm-v2/ws/Demo/out/chart.png',
    );
    assert.equal(resolveWorkspaceAbsPath('/apps/ws/a.png', ''), '/apps/ws/a.png');
    assert.equal(resolveWorkspaceAbsPath('https://x.com/a.png', '/apps'), null);
  });
});
