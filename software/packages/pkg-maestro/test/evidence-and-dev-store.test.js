import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { DurableMaestro, maestroEvidence } from '../durable-scheduler.js';

// Intent: software/packages/pkg-maestro/INTENT.md#evidence
// Non-regression: the durable scheduler wrote its audit to a local JSONL file
// and sent a best-effort HTTP line after each commit; a crash or a Logger
// outage between the two lost the evidence while the occurrence stayed.
// Evidence is now an outbox row committed with the change (proven live in
// evidence-outbox.live.mjs); these checks hold the wiring without a database.

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(here, '../server.js');
const UNIVERSE = '550e8400-e29b-41d4-a716-446655440000';

describe('the durable path keeps no local audit file', () => {
  it('imports neither the JSONL logger nor the best-effort ingest client', () => {
    const source = fs.readFileSync(path.join(here, '../durable-scheduler.js'), 'utf8');
    assert.doesNotMatch(source, /\bEventLogger\b|\bingestLog\b|appendFileSync|createWriteStream/);
  });

  it('hands every report to the store write that commits the change', async () => {
    const calls = [];
    const store = {
      materialize: async (decls, options) => {
        const summary = { results: [{ scheduleId: 'a', revision: 'r', outcome: 'created' }], retired: ['old'] };
        calls.push(['materialize', options.evidence(summary).map((i) => i.entry.event)]);
        return summary;
      },
      recordEvidence: async (item) => { calls.push(['standalone', item.entry.event]); },
      close: async () => {},
    };
    const maestro = new DurableMaestro({ store, universeId: UNIVERSE, queueUrl: 'http://127.0.0.1:1' });
    await maestro.materializeDeclared([{ slug: 'a', cadenceSeconds: 60 }]);
    assert.deepEqual(calls, [['materialize', ['SCHEDULE_MATERIALIZED', 'SCHEDULE_RETIRED']]]);
    assert.equal(maestro.logger, undefined);
  });

  it('a report the database refuses is said on the console, never claimed', async () => {
    const store = { recordEvidence: async () => { throw Object.assign(new Error('gone'), { code: 'DB_UNAVAILABLE' }); } };
    const maestro = new DurableMaestro({ store, universeId: UNIVERSE, queueUrl: 'http://127.0.0.1:1' });
    const errors = [];
    const original = console.error;
    console.error = (line) => errors.push(line);
    try {
      assert.equal(await maestro.recordEvidence('MAESTRO_STARTED', {}), false);
    } finally {
      console.error = original;
    }
    assert.match(errors.join('\n'), /evidence MAESTRO_STARTED not recorded: DB_UNAVAILABLE/);
  });

  it('every entry names the unit as its source and carries a stable execution id', () => {
    const { entry } = maestroEvidence('BEAT_ENQUEUED', { slug: 's' }, { correlationId: 'job-1', executionId: 'occ-1' });
    assert.equal(entry.pod, 'maestro');
    assert.equal(entry.executionId, 'occ-1');
    const standalone = maestroEvidence('SCHEDULER_STARTED');
    assert.equal(standalone.entry.executionId, standalone.eventId, 'without an occurrence, the event is its own execution');
  });
});

describe('the memory scaffolding is refused under a promotion or qualification flag', () => {
  for (const flag of [{ SHAPER_QUALIFICATION: '1' }, { SHAPER_RUNTIME_MODE: 'production' }]) {
    it(`MAESTRO_STORE=memory with ${Object.keys(flag)[0]}`, () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-dev-'));
      try {
        const r = spawnSync(process.execPath, [SERVER], {
          env: { PATH: process.env.PATH, MAESTRO_PORT: '0', MAESTRO_STORE: 'memory', LOG_DIR: dir, ...flag },
          encoding: 'utf8', timeout: 10000,
        });
        assert.equal(r.status, 1);
        assert.match(r.stderr, /refusing to start: DEV_STORE_REFUSED/);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});

describe('nothing a credential could ride on enters Maestro evidence', () => {
  it('refuses a queue URL carrying credentials, a query or a fragment', () => {
    for (const queueUrl of ['http://user:secret@127.0.0.1:8640', 'http://127.0.0.1:8640/?token=x', 'ftp://127.0.0.1']) {
      assert.throws(() => new DurableMaestro({ store: {}, universeId: UNIVERSE, queueUrl }), { code: 'QUEUE_URL_INVALID' }, queueUrl);
    }
  });

  it('reduces a remote error that looks like a credential to a digest', () => {
    const { entry } = maestroEvidence('ENQUEUE_REFUSED', { detail: 'Bearer PRIVATE_SENTINEL_TOKEN_VALUE' }, { executionId: 'occ-1' });
    assert.equal(entry.executionId, 'occ-1');
    assert.equal(entry.data.redacted, 'EVENT_SECRET_DENIED');
    assert.doesNotMatch(JSON.stringify(entry), /PRIVATE_SENTINEL/);
  });

  it('refuses a unit name its evidence source would contradict', () => {
    const r = spawnSync(process.execPath, [SERVER], {
      env: { PATH: process.env.PATH, MAESTRO_PORT: '0', SHAPER_UNIVERSE_ID: UNIVERSE, MAESTRO_QUEUE_URL: 'http://127.0.0.1:9', SHAPER_UNIT_SLUG: 'beats' },
      encoding: 'utf8', timeout: 10000,
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /refusing to start: EVIDENCE_SOURCE_MISMATCH/);
  });
});
