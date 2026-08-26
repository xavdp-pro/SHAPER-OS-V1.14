import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { vitals, ageSeconds, dependency, writable } from '../vitals.js';

const NOW = Date.parse('2026-08-23T12:00:00.000Z');
const ago = (s) => new Date(NOW - s * 1000).toISOString();

describe('ageSeconds', () => {
  it('turns a timestamp into an age a reader can judge', () => {
    assert.equal(ageSeconds(ago(320), NOW), 320);
  });

  it('answers null for what never happened, rather than zero', () => {
    // Zero would read as "just now", which is the opposite of the truth.
    assert.equal(ageSeconds(null, NOW), null);
    assert.equal(ageSeconds('not a date', NOW), null);
  });

  it('keeps sub-second resolution, so a fast loop is still measurable', () => {
    assert.equal(ageSeconds(new Date(NOW - 400).toISOString(), NOW), 0.4);
  });
});

describe('vitals envelope', () => {
  it('carries the brick name, the instant, and its uptime', () => {
    const v = vitals({ service: 'brick-queue', startedAt: ago(90), signals: { pending: 3 } }, NOW);
    assert.equal(v.service, 'brick-queue');
    assert.equal(v.at, new Date(NOW).toISOString());
    assert.equal(v.uptimeSeconds, 90);
    assert.equal(v.signals.pending, 3);
  });

  it('publishes no verdict of its own', () => {
    // The envelope must not offer a field a brick could use to grade itself.
    // Judging is the parent's job, from the evidence below.
    const v = vitals({ service: 's', startedAt: ago(1) }, NOW);
    for (const forbidden of ['status', 'ok', 'healthy', 'verdict']) {
      assert.equal(forbidden in v, false, `the envelope must not expose "${forbidden}"`);
    }
  });
});

describe('dependency', () => {
  it('dates reachability instead of asserting it', () => {
    const d = dependency({ name: 'bridge', url: 'http://x', lastOkAt: ago(4) }, NOW);
    assert.equal(d.lastOkAgeSeconds, 4);
    // A probe that succeeded four hours ago is a different fact from one that
    // succeeded four seconds ago; a boolean would hide the difference.
    assert.equal('reachable' in d, false);
  });

  it('reports a dependency never reached as null, and keeps the error', () => {
    const d = dependency({ name: 'bridge', lastError: 'ECONNREFUSED', attempts: 7 }, NOW);
    assert.equal(d.lastOkAgeSeconds, null);
    assert.equal(d.lastError, 'ECONNREFUSED');
    assert.equal(d.attempts, 7);
  });
});

describe('writable', () => {
  it('proves a directory is writable by writing to it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vitals-'));
    const r = await writable(fs, dir);
    assert.equal(r.writable, true);
    assert.deepEqual(fs.readdirSync(dir), [], 'the probe must leave nothing behind');
  });

  it('reports a directory that does not exist, with the reason', async () => {
    const r = await writable(fs, '/nonexistent-b7f2/queue');
    assert.equal(r.writable, false);
    assert.equal(r.reason, 'ENOENT');
  });

  it('says so plainly when no path is configured at all', async () => {
    const r = await writable(fs, null);
    assert.equal(r.writable, false);
    assert.match(r.reason, /no path/);
  });
});
