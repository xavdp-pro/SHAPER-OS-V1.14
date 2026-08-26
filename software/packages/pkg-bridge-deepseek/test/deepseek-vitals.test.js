import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DeepseekBridgeServer } from '../index.js';

describe('bridge-deepseek vitals', () => {
  it('publishes evidence and no verdict on GET /api/vitals', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepseek-vitals-'));
    const bridge = new DeepseekBridgeServer({ stubMode: true, workspaceBase: tmpDir });
    const server = bridge.createServer();

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const res = await fetch(`http://127.0.0.1:${port}/api/vitals`);
    assert.equal(res.status, 200);
    const vitals = await res.json();

    assert.equal(vitals.service, 'brick-bridge-deepseek');
    assert.equal(typeof vitals.uptimeSeconds, 'number');
    assert.equal(vitals.signals.injects, 0);
    assert.equal(vitals.signals.model, 'gpt-oss:120b');
    assert.equal(vitals.checks.workspace.writable, true);

    for (const forbidden of ['status', 'ok', 'healthy', 'verdict']) {
      assert.equal(forbidden in vitals, false, `the envelope must not expose "${forbidden}"`);
    }

    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
