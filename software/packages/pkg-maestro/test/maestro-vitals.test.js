import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMaestroServer, MaestroScheduler } from '../index.js';

describe('maestro vitals endpoint', () => {
  it('publishes evidence and no verdict on GET /api/vitals', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-vitals-'));
    const sched = new MaestroScheduler({ logDir: tmpDir });
    sched.registerTask({ slug: 'task-vitals-probe', cadenceSeconds: 60 });
    const server = createMaestroServer({ port: 0, scheduler: sched });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const res = await fetch(`http://127.0.0.1:${port}/api/vitals`);
    assert.equal(res.status, 200);
    const vitals = await res.json();

    assert.equal(vitals.service, 'brick-maestro');
    assert.equal(typeof vitals.uptimeSeconds, 'number');
    assert.equal(vitals.signals.tasksRegistered, 1);
    assert.equal(vitals.signals.activeTasks, 1);
    assert.equal(vitals.signals.beatsSkippedTotal, 0);
    assert.equal(typeof vitals.signals.tasks['task-vitals-probe'], 'object');

    for (const forbidden of ['status', 'ok', 'healthy', 'verdict']) {
      assert.equal(forbidden in vitals, false, `the envelope must not expose "${forbidden}"`);
    }

    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
