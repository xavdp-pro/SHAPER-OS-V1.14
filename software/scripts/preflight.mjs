#!/usr/bin/env node
// Intent: docs/PREREQUISITES.md
//
// The start-line gate. An agent does not begin while this exits 1 — the one
// exception is the human's explicit word, SHAPER_HUMAN_OVERRIDE=1, which an
// agent never sets for itself. Node built-ins only: this must run on a naked
// clone, before any npm install, because that is exactly when it matters.
//
// Usage:
//   node scripts/preflight.mjs [--root /path/to/software] [--universe /path/to/<slug>-dev]
//   SHAPER_HUMAN_OVERRIDE=1 node scripts/preflight.mjs   # human present only
//
// --universe (or SHAPER_UNIVERSE_DIR) names the universe whose manifest
// declares the ports about to be claimed; it exists only from runbook Step
// 4.3 on, so the port check is skipped, loudly, when no universe is named.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  parseEnvFile, portsInUse, portsInUseFromProc, manifestPorts, collisions,
} from './lib/preflight-checks.mjs';

const argv = process.argv.slice(2);
const rootIdx = argv.indexOf('--root');
const ROOT = rootIdx !== -1
  ? path.resolve(argv[rootIdx + 1])
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const univIdx = argv.indexOf('--universe');
const UNIVERSE = univIdx !== -1
  ? path.resolve(argv[univIdx + 1])
  : (process.env.SHAPER_UNIVERSE_DIR ? path.resolve(process.env.SHAPER_UNIVERSE_DIR) : '');

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
//
// And the file is read LINE BY LINE, because the deploy script will `source`
// it: every line that is not blank, a comment, or KEY=value is a command bash
// will run. On terrain a human note (`BACKOFFICE_ADMIN = email / password`)
// killed the deploy before it could print its own halt. Until then this gate
// filtered keys on `^[A-Z_]+=` and silently dropped everything else — the
// note, and every honest key with a digit in its name (R2_BUCKET_NAME).
const envPath = path.join(ROOT, '.env');
if (!fs.existsSync(envPath)) {
  ok('software/.env', 'absent — created at Step 4.1; its minimum is listed in docs/PREREQUISITES.md §4');
} else {
  const { entries: env, errors } = parseEnvFile(fs.readFileSync(envPath, 'utf8'));
  for (const e of errors) {
    fail('software/.env', `line ${e.line} is not a variable: "${e.text}" — ${e.reason}. Only blank lines, # comments and KEY=value are allowed; a note for a human goes behind #`);
  }
  const placeholder = (v) => /^<[^>]*>$/.test((v || '').trim());
  for (const key of ['VAULT_MASTER_KEY', 'VAULT_TOKEN']) {
    if (!env[key]) fail(key, `.env exists but ${key} is empty — generate it (docs/PREREQUISITES.md §4)`);
    else if (placeholder(env[key])) fail(key, 'still the example placeholder — a vault encrypted with documentation reports OK and protects nothing');
    else ok(key, 'set (value not printed)');
  }
}

// 5 — the ports the universe declares are free HERE. Bricks run with
// `--network host`, so a manifest port is a claim on the whole LXC. A
// container born before Rule 11 kept an apt-installed MariaDB on 3306; the
// podman brick crash-looped and nothing outside its own journal said why.
// The listening sockets are read with `ss`, or from /proc/net/tcp when ss is
// not on the machine; neither being readable is a halt, not a pass.
if (!UNIVERSE) {
  say('SKIP', 'ports', 'no universe named — re-run with --universe <slug>-dev before deploying (runbook Step 4.4); a declared port must be free on this machine');
} else {
  const manifestPath = path.join(UNIVERSE, 'manifest.json');
  let declared = null;
  try {
    declared = manifestPorts(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
  } catch (err) {
    fail('ports', `${manifestPath} cannot be read as a manifest (${err.message}) — the universe must exist and declare its bricks before its ports can be checked`);
  }
  if (declared) {
    let inUse = null;
    let source = '';
    const ss = spawnSync('ss', ['-ltnpH'], { encoding: 'utf8' });
    if (!ss.error && ss.status === 0) {
      inUse = portsInUse(ss.stdout);
      source = 'ss -ltnpH';
    } else {
      const procText = ['/proc/net/tcp', '/proc/net/tcp6']
        .filter((f) => fs.existsSync(f))
        .map((f) => fs.readFileSync(f, 'utf8'))
        .join('\n');
      if (procText) {
        inUse = portsInUseFromProc(procText);
        source = '/proc/net/tcp (ss not on this machine — install iproute2 to see which process holds a port)';
      }
    }
    if (!inUse) {
      fail('ports', 'cannot observe the listening sockets: neither `ss` (iproute2) nor /proc/net/tcp is readable here — install iproute2; a port check that cannot look is not a pass');
    } else {
      const held = collisions(declared, inUse);
      for (const c of held) {
        fail('ports', `port ${c.port} declared by ${c.brick} is already held by ${c.process || 'a process ss could not name (run as root to see it)'} — with --network host the brick cannot bind it; stop and disable what holds it (a service installed before Rule 11?) before deploying`);
      }
      if (held.length === 0) ok('ports', `${declared.length} declared port(s) free (${source})`);
    }
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
