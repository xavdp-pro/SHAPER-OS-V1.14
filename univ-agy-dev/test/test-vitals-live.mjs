/**
 * Test suite verifying live vitals across all running bricks in univ-agy-dev
 */
import assert from 'node:assert/strict';

const BRICKS = [
  { name: 'vault', port: 8810, expectedService: 'vault-v1' },
  { name: 'logger', port: 8820, expectedService: 'logger-v1' },
  { name: 'bridge-agy', port: 4330, expectedService: 'univ-bridge-agy' },
  { name: 'bridge-deepseek', port: 4350, expectedService: 'univ-bridge-deepseek' },
  { name: 'queue', port: 8840, expectedService: 'queue-v1' },
  { name: 'maestro', port: 8830, expectedService: 'maestro-v1' },
];

const FORBIDDEN_ROOT_KEYS = ['status', 'ok', 'healthy', 'verdict'];

async function run() {
  console.log('=== Proving /api/vitals across all bricks in univ-agy-dev ===\n');
  let passed = 0;

  for (const b of BRICKS) {
    const url = `http://127.0.0.1:${b.port}/api/vitals`;
    console.log(`Checking ${b.name} @ ${url}...`);

    try {
      const res = await fetch(url);
      assert.equal(res.status, 200, `${b.name} returned HTTP status ${res.status}`);
      const vitals = await res.json();

      assert.equal(vitals.service, b.expectedService, `Service mismatch: got ${vitals.service}, expected ${b.expectedService}`);
      assert.equal(typeof vitals.uptimeSeconds, 'number', 'uptimeSeconds must be a number');
      assert.equal(typeof vitals.signals, 'object', 'signals must be an object');
      assert.equal(typeof vitals.checks, 'object', 'checks must be an object');

      // Rule 23: A brick never grades itself in the root envelope
      for (const k of FORBIDDEN_ROOT_KEYS) {
        assert.equal(k in vitals, false, `Envelope of ${b.name} must NOT contain forbidden key "${k}"`);
      }

      console.log(`  ✔ [PASS] ${b.name} (${vitals.service})`);
      console.log(`    Signals: ${JSON.stringify(vitals.signals)}`);
      console.log(`    Checks:  ${JSON.stringify(vitals.checks)}`);
      passed++;
    } catch (err) {
      console.error(`  ✖ [FAIL] ${b.name}: ${err.message}`);
    }
  }

  console.log(`\nResults: ${passed}/${BRICKS.length} vitals endpoints verified.`);
  if (passed !== BRICKS.length) {
    process.exit(1);
  }
}

run();
