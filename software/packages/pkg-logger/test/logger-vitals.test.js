import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLoggerServer, LogCollector } from '../index.js';

describe('logger vitals endpoint', () => {
  it('publishes evidence and no verdict on GET /api/vitals', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logger-vitals-'));
    const collector = new LogCollector({ logDir: tmpDir });
    const server = createLoggerServer({ port: 0, collector, logDir: tmpDir });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    collector.ingest({ pod: 'test-pod', event: 'JOB_STARTED', data: { id: 'job-1' } });

    const res = await fetch(`http://127.0.0.1:${port}/api/vitals`);
    assert.equal(res.status, 200);
    const vitals = await res.json();

    assert.equal(vitals.service, 'brick-logger');
    assert.equal(typeof vitals.uptimeSeconds, 'number');
    assert.equal(vitals.signals.podsCount, 1);
    assert.equal(vitals.signals.eventsLast60s, 1);
    assert.equal(typeof vitals.signals.lastWriteAgeSeconds, 'number');
    assert.equal(vitals.checks.disk.writable, true);

    for (const forbidden of ['status', 'ok', 'healthy', 'verdict']) {
      assert.equal(forbidden in vitals, false, `the envelope must not expose "${forbidden}"`);
    }

    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
