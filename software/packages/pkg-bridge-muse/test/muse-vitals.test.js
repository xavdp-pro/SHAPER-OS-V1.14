import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MuseBridgeServer } from '../index.js';

describe('bridge-muse vitals', () => {
  it('publishes evidence on GET /api/vitals', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'muse-vitals-'));
    const bridge = new MuseBridgeServer({
      stubMode: true,
      defaultModel: 'engine/measured-at-deploy',
      workspaceBase: tmpDir,
    });
    const server = bridge.createServer();

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const res = await fetch(`http://127.0.0.1:${port}/api/vitals`);
    assert.equal(res.status, 200);
    const vitals = await res.json();

    assert.equal(vitals.service, 'brick-bridge-muse');
    assert.equal(vitals.signals.model, 'engine/measured-at-deploy');
    assert.equal(vitals.checks.workspace.writable, true);

    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
