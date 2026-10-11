/**
 * Live (real private MariaDB for Maestro and Queue, real Vault and Logger):
 * Maestro's reports are outbox rows committed with the change they report, a
 * failed evidence write leaves the occurrence where it was, and the relay
 * delivers the beat → job → evidence loop to Logger, where Maestro's
 * BEAT_ENQUEUED and Queue's JOB_CREATED meet on one job id. No local JSONL is
 * written on this path. Maestro reaches Queue as a unit does in a universe:
 * under its own Vault-signed `queue` credential (queue:enqueue, queue:read),
 * which Queue checks at Vault on every route (DECISIONS-20261011 §E).
 *
 * Run through software/packages/pkg-db/test/live/run-live.mjs.
 * Intent: software/packages/pkg-maestro/INTENT.md#evidence
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { adminQuery, liveEnv, resetUnit, unitDb } from '../../pkg-db/test/live/live-env.mjs';
import { startEvidenceStack, UNIVERSE } from '../../pkg-logger/test/live/evidence-stack.mjs';
import { createEvidenceRelay } from '../../pkg-db/outbox.js';
import { deliverLog } from '../../pkg-logger/ingest-client.js';
import { MariaDbJobQueue } from '../../pkg-queue/mariadb-store.js';
import { createQueueServer } from '../../pkg-queue/index.js';
import { MariaDbMaestroStore } from '../mariadb-store.js';
import { DurableMaestro } from '../durable-scheduler.js';

let stack, queue, queueServer, queueUrl, store, maestro;
const listen = (server) => new Promise((resolve) => server.once('listening', resolve));

function relay(unit, pool) {
  return createEvidenceRelay({
    pool,
    credentials: stack.credentials(unit),
    deliver: (entry, signal, headers) => deliverLog({ loggerUrl: stack.loggerUrl, entry, signal, headers }),
    intervalMs: 60000,
    report: (event) => console.error(`[relay ${unit}] ${JSON.stringify(event)}`),
  });
}

const outbox = async () => (await adminQuery('SELECT event_id, body, receipt FROM maestro.event_outbox ORDER BY created_at, event_id'))
  .map((r) => ({ ...r, entry: JSON.parse(r.body) }));

before(async () => {
  stack = await startEvidenceStack({ grants: { maestro: { logger: ['logger:ingest'], queue: ['queue:enqueue', 'queue:read'] } } });
  await resetUnit('queue');
  await resetUnit('maestro');
  queue = await MariaDbJobQueue.open({ slug: 'queue', db: unitDb() });
  queueServer = createQueueServer({ port: 0, host: '127.0.0.1', queue, authorizeRequest: stack.authorizer('queue') });
  await listen(queueServer);
  queueUrl = `http://127.0.0.1:${queueServer.address().port}`;
  store = await MariaDbMaestroStore.open({ slug: 'maestro', db: unitDb() });
  maestro = new DurableMaestro({ store, universeId: UNIVERSE, queueUrl, credentials: stack.credentials('maestro', 'queue') });
});

after(async () => {
  await maestro.close();
  queueServer.closeAllConnections?.();
  await new Promise((resolve) => queueServer.close(resolve));
  await queue.close();
  await stack.close();
});

describe('Maestro evidence is committed with the change it reports', () => {
  it('materializing a schedule and enqueueing a beat commit their evidence in their own transactions', async () => {
    const summary = await maestro.materializeDeclared([{ slug: 'live-beat', cadenceSeconds: 3600, instruction: 'live probe' }]);
    assert.equal(summary.results[0].outcome, 'created');
    const beat = await maestro.triggerBeat('live-beat');
    assert.equal(beat.enqueued, true);
    assert.ok(beat.jobId);

    const rows = await outbox();
    // Rows written within one millisecond have no order between them: compare as a set.
    assert.deepEqual(rows.map((r) => r.entry.event).sort(), ['BEAT_ENQUEUED', 'OCCURRENCE_DUE', 'SCHEDULE_MATERIALIZED']);
    for (const r of rows) assert.equal(r.entry.pod, 'maestro', 'the source is the unit; the schedule is data.slug');
    const enqueued = rows.find((r) => r.entry.event === 'BEAT_ENQUEUED').entry;
    assert.equal(enqueued.correlationId, beat.jobId);
    assert.equal(enqueued.data.slug, 'live-beat');
    assert.equal(enqueued.executionId, beat.occurrence.occurrenceId);
  });

  it('when the evidence cannot be written, the occurrence is not recorded either, and nothing is enqueued', async () => {
    const jobsBefore = (await queue.listJobs()).length;
    await new Promise((r) => setTimeout(r, 1100)); // a new second: a new manual occurrence
    await adminQuery('RENAME TABLE maestro.event_outbox TO maestro.event_outbox_away');
    let result;
    try {
      result = await maestro.triggerBeat('live-beat').catch((err) => err);
    } finally {
      await adminQuery('RENAME TABLE maestro.event_outbox_away TO maestro.event_outbox');
    }
    assert.ok(result instanceof Error, 'the beat could not be recorded, so it is refused');
    const [all] = await adminQuery('SELECT COUNT(*) AS n FROM maestro.occurrences');
    assert.equal(Number(all.n), 1, 'the occurrence rolled back with its evidence');
    assert.equal((await queue.listJobs()).length, jobsBefore, 'nothing left for Queue');
  });

  it('the relays deliver the beat and its job to Logger, correlated by the job id', async () => {
    const maestroRelay = relay('maestro', store.pool);
    const queueRelay = relay('queue', queue.pool);
    try {
      for (let i = 0; i < 2; i++) { await maestroRelay.tick(); await queueRelay.tick(); }
      assert.equal((await outbox()).filter((r) => r.receipt === null).length, 0, 'no Maestro debt is left');
      assert.equal((await maestro.vitals()).signals.evidencePending, 0);
      const [{ job_id: jobId }] = await adminQuery("SELECT queue_job_id AS job_id FROM maestro.occurrences WHERE state = 'ENQUEUED'");
      const loop = await stack.loggerEvents('correlation_id = ?', [jobId]);
      assert.deepEqual(loop.map((e) => `${e.pod}:${e.event}`).sort(), ['maestro:BEAT_ENQUEUED', 'queue:JOB_CREATED']);
    } finally {
      await maestroRelay.close();
      await queueRelay.close();
    }
  });

  it('writes no local JSONL audit', () => {
    const { workDir } = liveEnv();
    const jsonl = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== 'data') walk(p);
        else if (entry.name.endsWith('.jsonl')) jsonl.push(p);
      }
    };
    walk(workDir);
    assert.deepEqual(jsonl, []);
    assert.equal(maestro.logger, undefined, 'the durable scheduler holds no file logger');
  });
});

describe('Queue answers credentials only, checked at the real Vault (DECISIONS §E)', () => {
  it('anonymous is 401; Maestro\'s credential enqueues and reads, and claims nothing (403)', async () => {
    const anonymous = await fetch(`${queueUrl}/api/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"type":"anon"}' });
    assert.equal(anonymous.status, 401);
    assert.equal((await fetch(`${queueUrl}/api/jobs`)).status, 401);
    assert.equal((await fetch(`${queueUrl}/api/health`)).status, 200);
    const headers = { ...(await stack.credentials('maestro', 'queue')()), 'Content-Type': 'application/json' };
    const created = await fetch(`${queueUrl}/api/jobs`, { method: 'POST', headers, body: '{"type":"live.authorized"}' });
    assert.equal(created.status, 201);
    const { job } = await created.json();
    assert.equal((await fetch(`${queueUrl}/api/jobs/${job.id}`, { headers })).status, 200);
    const claim = await fetch(`${queueUrl}/api/jobs/${job.id}/claim`, { method: 'POST', headers, body: '{}' });
    assert.deepEqual([claim.status, (await claim.json()).code], [403, 'CREDENTIAL_SCOPE_DENIED']);
    // A logger credential is for Logger: another audience.
    const loggerHeaders = await stack.credentials('maestro', 'logger')();
    assert.equal((await fetch(`${queueUrl}/api/jobs`, { headers: loggerHeaders })).status, 403);
  });

  it('a credential Vault no longer holds current is refused (403), and Vault down is 503, not a default', async () => {
    const headers = await stack.credentials('maestro', 'queue')();
    await adminQuery("UPDATE vault.unit_identities SET revoked = TRUE WHERE unit_id = 'maestro'");
    try {
      assert.equal((await fetch(`${queueUrl}/api/jobs`, { headers })).status, 403);
    } finally {
      await adminQuery("UPDATE vault.unit_identities SET revoked = FALSE WHERE unit_id = 'maestro'");
    }
    const unreachable = createQueueServer({ port: 0, host: '127.0.0.1', queue,
      authorizeRequest: (await import('../../pkg-auth/runtime-identity.js')).runtimeAuthorizer({
        ...stack.env('queue'), VAULT_URL: 'http://127.0.0.1:9', SHAPER_UNIT_SLUG: 'queue' }) });
    await listen(unreachable);
    try {
      const res = await fetch(`http://127.0.0.1:${unreachable.address().port}/api/jobs`, { headers: await stack.credentials('maestro', 'queue')() });
      assert.deepEqual([res.status, (await res.json()).code], [503, 'IDENTITY_UNAVAILABLE']);
    } finally {
      unreachable.closeAllConnections?.();
      await new Promise((resolve) => unreachable.close(resolve));
    }
  });
});
