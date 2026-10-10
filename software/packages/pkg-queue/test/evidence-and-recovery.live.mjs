/**
 * Live (real private MariaDB, real Vault and Logger): Queue evidence survives
 * a crash between its SQL commit and Logger delivery, a Logger outage and a
 * lost Logger response, and a job found RUNNING at restart is settled FAILED
 * as interrupted — never replayed.
 *
 * Run through software/packages/pkg-db/test/live/run-live.mjs.
 * Intent: software/packages/pkg-queue/INTENT.md#lifecycle
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { adminQuery, resetUnit, unitDb } from '../../pkg-db/test/live/live-env.mjs';
import { startEvidenceStack } from '../../pkg-logger/test/live/evidence-stack.mjs';
import { createEvidenceRelay } from '../../pkg-db/outbox.js';
import { deliverLog } from '../../pkg-logger/ingest-client.js';
import { MariaDbJobQueue } from '../mariadb-store.js';
import { INTERRUPTED_REASON } from '../job-contract.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const storeModule = path.join(here, '../mariadb-store.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let stack;
before(async () => { stack = await startEvidenceStack(); });
after(async () => { await stack.close(); });

function relayFor(queue, { deliver } = {}) {
  return createEvidenceRelay({
    pool: queue.pool,
    credentials: stack.credentials('queue'),
    deliver: deliver || ((entry, signal, headers) => deliverLog({ loggerUrl: stack.loggerUrl, entry, signal, headers })),
    intervalMs: 60000,
    report: (event) => console.error(`[relay] ${JSON.stringify(event)}`),
  });
}

/**
 * A separate Node process does `work` against the unit's database, prints a
 * JSON line, and is killed with SIGKILL before anything else can run: no
 * relay, no shutdown, no finally.
 */
function crashAfter(work) {
  const script = `
    const { MariaDbJobQueue } = await import(${JSON.stringify(storeModule)});
    const queue = await MariaDbJobQueue.open({ slug: 'queue', db: ${JSON.stringify(unitDb())}, loggerUrl: ${JSON.stringify(stack.loggerUrl)} });
    const out = await (${work})(queue);
    process.stdout.write(JSON.stringify(out) + '\\n', () => process.kill(process.pid, 'SIGKILL'));
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 30000 });
  assert.equal(child.signal, 'SIGKILL', `the child was meant to die by SIGKILL: ${child.stderr}`);
  return JSON.parse(child.stdout.trim().split('\n').pop());
}

describe('Queue evidence is committed with the job, and delivered after a crash', () => {
  before(async () => { await resetUnit('queue'); });

  it('a crash between the SQL commit and Logger delivery loses neither the job nor its evidence', async () => {
    const { jobId } = crashAfter(`async (q) => ({ jobId: (await q.enqueue({ type: 'live.probe', payload: { note: 'private payload' } })).job.id })`);

    const [job] = await adminQuery('SELECT id, status FROM queue.jobs WHERE id = ?', [jobId]);
    assert.equal(job.status, 'PENDING');
    const debt = await adminQuery('SELECT event_id, body, receipt FROM queue.event_outbox');
    assert.equal(debt.length, 1, 'the evidence row committed with the job');
    assert.equal(debt[0].receipt, null, 'nothing was delivered before the crash');
    assert.equal(JSON.parse(debt[0].body).correlationId, jobId);
    assert.doesNotMatch(debt[0].body, /private payload/, 'evidence never carries the payload');
    assert.equal((await stack.loggerEvents('correlation_id = ?', [jobId])).length, 0);

    // A new process: the relay finds the debt and Logger receipts it.
    const queue = await MariaDbJobQueue.open({ slug: 'queue', db: unitDb() });
    try {
      const relay = relayFor(queue);
      assert.deepEqual(await relay.tick(), { delivered: 1, deferred: 0 });
      const events = await stack.loggerEvents('correlation_id = ?', [jobId]);
      assert.equal(events.length, 1);
      assert.equal(events[0].event, 'JOB_CREATED');
      assert.equal(events[0].pod, 'queue', 'Logger bound the source to the authenticated unit');
      assert.equal(events[0].source_event_id, debt[0].event_id);
      const [settled] = await adminQuery('SELECT receipt, delivered_at FROM queue.event_outbox WHERE event_id = ?', [debt[0].event_id]);
      assert.equal(JSON.parse(settled.receipt).id, events[0].id, 'the receipt is the Logger record');
      assert.ok(settled.delivered_at);
      assert.deepEqual(await relay.tick(), { delivered: 0, deferred: 0 }, 'nothing is delivered twice');
      await relay.close();
    } finally {
      await queue.close();
    }
  });

  it('a Logger outage keeps the debt; the retry delivers it once', async () => {
    const queue = await MariaDbJobQueue.open({ slug: 'queue', db: unitDb() });
    const relay = relayFor(queue);
    try {
      const { job } = await queue.enqueue({ type: 'live.outage' });
      await stack.stopLogger();
      assert.deepEqual(await relay.tick(), { delivered: 0, deferred: 1 });
      const [debt] = await adminQuery("SELECT event_id, receipt, last_error, attempts FROM queue.event_outbox WHERE body LIKE CONCAT('%', ?, '%')", [job.id]);
      assert.equal(debt.receipt, null);
      assert.equal(debt.last_error, 'DELIVERY_UNCONFIRMED');
      assert.equal(Number(debt.attempts), 1);
      assert.equal((await queue.evidenceStatus()).pending, 1, 'the debt is observable');

      await stack.startLogger();
      await sleep(1100); // the first retry is due one second later
      assert.deepEqual(await relay.tick(), { delivered: 1, deferred: 0 });
      assert.equal((await stack.loggerEvents('source_event_id = ?', [debt.event_id])).length, 1);
      assert.equal((await queue.evidenceStatus()).pending, 0);
    } finally {
      await relay.close();
      await queue.close();
    }
  });

  it('a lost Logger response is retried under the same source id, and Logger answers its original record', async () => {
    const queue = await MariaDbJobQueue.open({ slug: 'queue', db: unitDb() });
    let lose = true;
    const relay = relayFor(queue, {
      deliver: async (entry, signal, headers) => {
        const receipt = await deliverLog({ loggerUrl: stack.loggerUrl, entry, signal, headers });
        if (lose) { lose = false; throw new Error('response lost after Logger committed'); }
        return receipt;
      },
    });
    try {
      const { job } = await queue.enqueue({ type: 'live.lost' });
      assert.deepEqual(await relay.tick(), { delivered: 0, deferred: 1 });
      const [first] = await stack.loggerEvents('correlation_id = ?', [job.id]);
      assert.ok(first, 'Logger did record the event whose answer was lost');
      await sleep(1100);
      assert.deepEqual(await relay.tick(), { delivered: 1, deferred: 0 });
      const events = await stack.loggerEvents('correlation_id = ?', [job.id]);
      assert.equal(events.length, 1, 'the retry is a replay, not a second event');
      const [settled] = await adminQuery('SELECT receipt FROM queue.event_outbox WHERE event_id = ?', [first.source_event_id]);
      assert.equal(JSON.parse(settled.receipt).id, first.id);
    } finally {
      await relay.close();
      await queue.close();
    }
  });
});

describe('restart recovery settles a RUNNING job, whatever the worker setting', () => {
  before(async () => { await resetUnit('queue'); });

  it('a job RUNNING when the process died is FAILED as interrupted at the next start, never replayed', async () => {
    const { running, pending } = crashAfter(`async (q) => {
      const running = (await q.enqueue({ type: 'live.work' })).job;
      await q.updateJobProgress(running.id, { status: 'RUNNING', progress: 40, result: { startedAt: 'before the crash' } });
      const pending = (await q.enqueue({ type: 'live.work' })).job;
      return { running: running.id, pending: pending.id };
    }`);

    const queue = await MariaDbJobQueue.open({ slug: 'queue', db: unitDb() });
    try {
      assert.equal(queue.hydrated.byStatus.RUNNING, 1, 'the record survived the crash as it was');
      const settled = await queue.recoverInterrupted();
      assert.deepEqual(settled.map((j) => j.id), [running]);

      const job = await queue.getJob(running);
      assert.equal(job.status, 'FAILED');
      assert.equal(job.error, INTERRUPTED_REASON);
      assert.equal(job.result.orphaned, true);
      assert.equal(job.result.outcome, 'unknown');
      assert.equal(job.result.startedAt, 'before the crash', 'what was recorded is kept');
      assert.equal((await queue.getJob(pending)).status, 'PENDING', 'a PENDING job waits for its first execution');

      const [transition] = await adminQuery(
        "SELECT kind, from_status, to_status FROM queue.job_transitions WHERE job_id = ? ORDER BY transition_id DESC LIMIT 1", [running]);
      assert.deepEqual({ ...transition }, { kind: 'interrupted', from_status: 'RUNNING', to_status: 'FAILED' });
      const evidence = (await adminQuery('SELECT body FROM queue.event_outbox')).map((r) => JSON.parse(r.body))
        .filter((e) => e.correlationId === running && e.event === 'JOB_FAILED');
      assert.equal(evidence.length, 1);
      assert.deepEqual([evidence[0].data.reason, evidence[0].data.outcome, evidence[0].level], ['interrupted', 'unknown', 'ERROR']);

      assert.deepEqual(await queue.recoverInterrupted(), [], 'a second start finds nothing to settle');

      const relay = relayFor(queue);
      await relay.tick();
      const failed = await stack.loggerEvents("correlation_id = ? AND event = 'JOB_FAILED'", [running]);
      assert.equal(failed.length, 1, 'the interruption reached Logger');
      await relay.close();
    } finally {
      await queue.close();
    }
  });
});
