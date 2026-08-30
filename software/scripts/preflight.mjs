#!/usr/bin/env node
// Intent: docs/PREREQUISITES.md
//
// The start-line gate. An agent does not begin while this exits 1 — the one
// exception is the human's explicit word, SHAPER_HUMAN_OVERRIDE=1, which an
// agent never sets for itself. Node built-ins only: this must run on a naked
// clone, before any npm install, because that is exactly when it matters.
//
// Usage:
//   node scripts/preflight.mjs [--root /path/to/repo]
//   SHAPER_HUMAN_OVERRIDE=1 node scripts/preflight.mjs   # human present only

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const rootIdx = argv.indexOf('--root');
const ROOT = rootIdx !== -1
  ? path.resolve(argv[rootIdx + 1])
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const OVERRIDE = process.env.SHAPER_HUMAN_OVERRIDE === '1';
const failures = [];
const say = (verdict, name, detail) =>
  console.log(`  ${verdict.padEnd(10)} ${name.padEnd(18)} ${detail}`);
const fail = (name, detail) => { failures.push(name); say('FAIL', name, detail); };
const ok = (name, detail) => say('OK', name, detail);

// 1 — tools. The deploy path uses each of these by name.
for (const tool of ['git', 'podman', 'curl', 'python3', 'openssl']) {
  const r = spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' });
  if (r.status === 0) ok(tool, r.stdout.trim());
  else fail(tool, 'not on PATH — install it before starting');
}

// 2 — the registry: named, and reachable from HERE. A loopback answered on
// the host names the LXC itself (the F1 lesson); asking beats inventing.
const REG = process.env.SHAPER_REGISTRY || '';
if (!REG) {
  fail('SHAPER_REGISTRY', 'not exported — ask the human which registry this machine uses (docs/PREREQUISITES.md §1); never invent one');
} else {
  const r = spawnSync('curl', ['-sf', '--max-time', '5', `http://${REG}/v2/`], { encoding: 'utf8' });
  if (r.status === 0) ok('SHAPER_REGISTRY', `${REG} answers /v2/`);
  else fail('SHAPER_REGISTRY', `${REG} does not answer /v2/ from here — wrong address, or not reachable from this shell`);
}

// 3 — the image tag names the release being deployed.
if (process.env.SHAPER_IMAGE_TAG) ok('SHAPER_IMAGE_TAG', process.env.SHAPER_IMAGE_TAG);
else fail('SHAPER_IMAGE_TAG', 'not exported — the build and the deploy must name the same release');

// 4 — software/.env: created later (Step 4.1), so absence is fine at the
// start line — but an existing file with placeholder keys is worse than
// none: the vault would be encrypted with documentation.
const envPath = path.join(ROOT, '.env');
if (!fs.existsSync(envPath)) {
  ok('software/.env', 'absent — created at Step 4.1; its minimum is listed in docs/PREREQUISITES.md §4');
} else {
  const env = Object.fromEntries(
    fs.readFileSync(envPath, 'utf8').split('\n')
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
  const placeholder = (v) => /^<[^>]*>$/.test((v || '').trim());
  for (const key of ['VAULT_MASTER_KEY', 'VAULT_TOKEN']) {
    if (!env[key]) fail(key, `.env exists but ${key} is empty — generate it (docs/PREREQUISITES.md §4)`);
    else if (placeholder(env[key])) fail(key, 'still the example placeholder — a vault encrypted with documentation reports OK and protects nothing');
    else ok(key, 'set (value not printed)');
  }
}

console.log('');
if (failures.length === 0) {
  console.log('preflight: all prerequisites met — you may start.');
  process.exit(0);
}
if (OVERRIDE) {
  console.log(`preflight: ${failures.length} prerequisite(s) NOT met — ${failures.join(', ')}`);
  console.log('OVERRIDDEN on the human\'s word (SHAPER_HUMAN_OVERRIDE=1). Record this override and these failures in your report.');
  process.exit(0);
}
console.log(`preflight: DO NOT START — ${failures.length} prerequisite(s) not met: ${failures.join(', ')}`);
console.log('Fix them, or ask the human present to overrule with SHAPER_HUMAN_OVERRIDE=1 (their word, never yours). A red gate is a measured result: report it.');
process.exit(1);
