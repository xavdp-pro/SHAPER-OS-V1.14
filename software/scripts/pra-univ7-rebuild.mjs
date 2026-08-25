#!/usr/bin/env node
/**
 * PRA univ7 — delete sandbox, cold-boot minimal vital socle, run integration tests, destroy.
 *
 * Usage:
 *   node scripts/pra-univ7-rebuild.mjs
 *   AGY_API_KEY=xxx BRIDGE_AGY_STUB=0 node scripts/pra-univ7-rebuild.mjs   # live agy
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// Load local SHAPER-OS secrets only (never ../../REMOTE — Rule: sovereign rebuild)
loadEnvFile(path.resolve(ROOT, '.env'));

const t0 = Date.now();
console.log('================================================================');
console.log('UNIV7 PRA — Minimal Vital Socle Rebuild');
console.log('================================================================');
console.log(`Stub mode: ${process.env.BRIDGE_AGY_STUB !== '0' ? 'YES (set BRIDGE_AGY_STUB=0 for live agy)' : 'NO — live agy'}`);
console.log(`API key loaded: ${Boolean(process.env.AGY_API_KEY || process.env.GEMINI_API_KEY)}\n`);

// Destroy any leftover sandboxes
for (const entry of fs.readdirSync(os.tmpdir())) {
  if (entry.startsWith('univ7-pra-')) {
    try { fs.rmSync(path.join(os.tmpdir(), entry), { recursive: true, force: true }); } catch { /* */ }
  }
}

const testFile = path.join(ROOT, 'universes/univ7/test/socle-integration.test.js');

const child = spawn('node', ['--test', testFile], {
  cwd: ROOT,
  env: { ...process.env, BRIDGE_AGY_STUB: process.env.BRIDGE_AGY_STUB ?? '1' },
  stdio: 'inherit',
});

child.on('close', (code) => {
  const sec = ((Date.now() - t0) / 1000).toFixed(2);
  console.log('\n================================================================');
  if (code === 0) {
    console.log(`SUCCESS — univ7 socle PRA passed in ${sec}s`);
    console.log('Scenario: Artisan BTP overnight storm quote watchdog');
    console.log('Stack: vault + logger + maestro + bridge-agy');
  } else {
    console.log(`FAILED — exit code ${code} after ${sec}s`);
  }
  console.log('================================================================\n');
  process.exit(code ?? 1);
});
