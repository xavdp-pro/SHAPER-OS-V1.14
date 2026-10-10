import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliverLog } from '../ingest-client.js';
import { buildRecord, eventDigest, normalizeIngestEntry } from '../ingest-contract.js';

const entry = { pod: 'queue', event: 'JOB_CREATED', executionId: 'job-1', sourceEventId: 'event-1', data: { jobId: 'job-1' } };
const record = () => buildRecord(normalizeIngestEntry(entry), { id: 'receipt-1', receivedAtMs: Date.now() });
const response = (r) => async () => ({ ok: true, json: async () => ({ record: r }) });

test('strict relay accepts a matching durable Logger record', async () => {
  const r = record();
  const receipt = await deliverLog({ loggerUrl: 'http://logger', entry, fetchImpl: response(r) });
  assert.equal(receipt.id, r.id);
  assert.equal(receipt.digest, r.digest);
});

test('HTTP success, a corrupt digest or another valid claim cannot clear debt', async () => {
  const changed = { ...record(), data: { jobId: 'other-job' } };
  changed.digest = eventDigest(changed);
  for (const r of [undefined, { ...record(), digest: 'bad' }, changed]) {
    await assert.rejects(deliverLog({ loggerUrl: 'http://logger', entry, fetchImpl: response(r) }), /LOGGER_RECEIPT_INVALID/);
  }
});

test('ids stay stable and credentials are passed only as transport headers', async () => {
  await deliverLog({ loggerUrl: 'http://logger', entry, headers: { Authorization: 'Bearer test-credential' },
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer test-credential');
      assert.doesNotMatch(options.body, /test-credential/);
      assert.equal(JSON.parse(options.body).sourceEventId, entry.sourceEventId);
      return { ok: true, json: async () => ({ record: record() }) };
    } });
});
