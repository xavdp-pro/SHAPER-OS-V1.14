/**
 * @file pipeline-live-gbs.mjs
 * @description Live validation script for univ-pipeline on gbs-test.
 */

import assert from 'node:assert/strict';

console.log('==================================================');
console.log('=== SHAPER-OS V1.7 — UNIV-PIPELINE (gbs-test) ===');
console.log('==================================================\n');

// 1. Health Checks
console.log('[TEST 1] Bricks Health Check');
const endpoints = [
  ['Vault', 'http://127.0.0.1:8710/api/health'],
  ['Logger', 'http://127.0.0.1:8720/api/health'],
  ['Pipeline', 'http://127.0.0.1:8670/api/health'],
  ['Bridge DeepSeek', 'http://127.0.0.1:4350/api/health'],
  ['Queue', 'http://127.0.0.1:8740/api/health'],
  ['Maestro', 'http://127.0.0.1:8730/api/health'],
];

for (const [name, url] of endpoints) {
  const res = await fetch(url);
  assert.equal(res.status, 200, `${name} health returned HTTP ${res.status}`);
  const data = await res.json();
  const svc = data.service || data.status;
  console.log(`  ✓ ${name}: HTTP ${res.status} (${svc})`);
}

// 2. Pipeline Extraction — Vector Invoice
console.log('\n[TEST 2] Pipeline Extraction: Native Vector Invoice (01-vector-invoice.pdf)');
const vecRes = await fetch('http://127.0.0.1:8670/api/pipeline/process', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ filePath: '/test-corpus/pipeline-to-qdrant/fixtures/01-vector-invoice.pdf' }),
});
assert.equal(vecRes.status, 200);
const vecData = await vecRes.json();
assert.equal(vecData.ok, true);
console.log(`  ✓ Status: HTTP 200 (ok=true)`);
console.log(`  ✓ Witnesses:`, Object.keys(vecData.witnesses || {}));
console.log(`  ✓ Extracted text length: ${vecData.text?.length || 0} chars`);
console.log(`  ✓ Preview: ${(vecData.text || '').slice(0, 120).replace(/\n/g, ' ')}...`);

// 3. Pipeline Extraction — Scanned Invoice with OCR
console.log('\n[TEST 3] Pipeline Extraction: Scanned Raster Invoice (02-scan-invoice.pdf)');
const scanRes = await fetch('http://127.0.0.1:8670/api/pipeline/process', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ filePath: '/test-corpus/pipeline-to-qdrant/fixtures/02-scan-invoice.pdf' }),
});
assert.equal(scanRes.status, 200);
const scanData = await scanRes.json();
assert.equal(scanData.ok, true);
console.log(`  ✓ Status: HTTP 200 (ok=true)`);
console.log(`  ✓ Witnesses:`, Object.keys(scanData.witnesses || {}));
console.log(`  ✓ Extracted OCR text length: ${scanData.text?.length || 0} chars`);
console.log(`  ✓ Preview: ${(scanData.text || '').slice(0, 120).replace(/\n/g, ' ')}...`);

// 4. Queue Job Injection & Execution with gpt-oss:120b
console.log('\n[TEST 4] Queue Job Injection -> DeepSeek Bridge (gpt-oss:120b @ Ollama Cloud)');
const jobPayload = {
  type: 'agent.inject',
  totalSteps: 2,
  payload: {
    conversation: 'pipeline-live-gbs-test',
    bridgeUrl: 'http://127.0.0.1:4350',
    message: 'Read extracted invoice and produce summary report in JSON.',
    perimeter: '/root/work',
    goal: 'invoice summary produced'
  }
};
const queueRes = await fetch('http://127.0.0.1:8740/api/jobs', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(jobPayload),
});
assert.equal(queueRes.status, 201);
const queueData = await queueRes.json();
const jobId = queueData.id || queueData.job?.id;
console.log(`  ✓ Enqueued job ${jobId}: HTTP 201`);

// Follow job
let finalStatus = null;
let finalResult = null;
for (let i = 0; i < 20; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const poll = await (await fetch('http://127.0.0.1:8740/api/jobs')).json();
  const cur = (poll.jobs || []).find(j => j.id === jobId);
  if (cur) {
    console.log(`    T+${i + 1}s -> Job status: ${cur.status}`);
    if (cur.status === 'COMPLETED' || cur.status === 'FAILED') {
      finalStatus = cur.status;
      finalResult = cur.result;
      break;
    }
  }
}

assert.equal(finalStatus, 'COMPLETED');
console.log('  ✓ Final Result:', finalResult);

console.log('\n==================================================');
console.log('=== ALL UNIV-PIPELINE TESTS PASSED ON GBS-TEST ===');
console.log('==================================================');
