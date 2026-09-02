#!/usr/bin/env node
// Intent: software/packages/pkg-vault/INTENT.md
/**
 * Bootstrap encrypted vault from resources/vault-resources.local.json
 * Sovereign REMOTE2 — plaintext resources live ONLY in resources/*.local.json (gitignored).
 *
 * Usage:
 *   node scripts/bootstrap-vault-from-resources.mjs
 *   VAULT_RESOURCES_FILE=./resources/vault-resources.local.json node scripts/bootstrap-vault-from-resources.mjs
 *
 * Inputs, in order of precedence: the shell environment, then software/.env
 * (or VAULT_ENV_FILE), then the resources file. A key nobody chose halts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VaultStore } from '../packages/pkg-vault/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const RESOURCES_FILE = process.env.VAULT_RESOURCES_FILE
  || path.join(ROOT, 'resources/vault-resources.local.json');

// The .env this script reads is the one it would write (below): software/.env,
// or whatever VAULT_ENV_FILE points at.
const ENV_FILE = process.env.VAULT_ENV_FILE || path.join(ROOT, '.env');

// Rule 0J names software/.env as the place the operator's keys live, and every
// quick start says `cp .env.example software/.env` then `npm run vault:bootstrap`.
// Until the 2 September audit nothing between those two commands read that
// file: this script took VAULT_MASTER_KEY from process.env only, the repository
// carries no dotenv (zero dependencies, Rule 5), and the literal path halted on
// "VAULT_MASTER_KEY is required" with the key sitting in the file the
// documentation had just told the operator to create. So the file is read here
// — as DEFAULTS. What the operator exported in the shell wins over it, the
// same precedence deploy/podman-up.sh gives (V1.13.5) and the storage file was
// given (V1.13.1): an explicit choice always beats a packaged default.
//
// The grammar is deliberately narrow: `KEY=value`, `# comment`, blank. A line
// this parser cannot read is a halt naming the line, never a silent skip — a
// skipped key surfaces an hour later as "missing key" with no cause attached.
// Surrounding quotes are stripped; there are no inline comments and no
// interpolation, because a value nobody can read back verbatim is a value
// nobody can audit.
function loadDotEnv(file) {
  const fromFile = new Set();
  if (!fs.existsSync(file)) return fromFile;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      console.error(`[bootstrap-vault] HALT — ${file}:${index + 1} is not KEY=value: "${raw}"`);
      console.error('[bootstrap-vault] A .env holds KEY=value lines, # comments and blank lines, nothing else. Nothing was written.');
      process.exit(1);
    }
    const [, key, rawValue] = match;
    const quoted = rawValue.trim().match(/^(["'])(.*)\1$/);
    const value = quoted ? quoted[2] : rawValue.trim();
    // The operator's export wins; the file only fills what the shell left unset.
    if (process.env[key] !== undefined && process.env[key] !== '') return;
    process.env[key] = value;
    fromFile.add(key);
  });
  return fromFile;
}
const FROM_ENV_FILE = loadDotEnv(ENV_FILE);

let vaultMasterKey = process.env.VAULT_MASTER_KEY;
let vaultToken = process.env.VAULT_TOKEN;
let storageFile = path.resolve(ROOT, process.env.VAULT_STORAGE_FILE || 'data/vault/vault.enc');
let secrets = {};

if (fs.existsSync(RESOURCES_FILE)) {
  try {
    const resources = JSON.parse(fs.readFileSync(RESOURCES_FILE, 'utf8'));
    if (!process.env.VAULT_MASTER_KEY && resources?.vault?.masterKey) vaultMasterKey = resources.vault.masterKey;
    if (!process.env.VAULT_TOKEN && resources?.vault?.token) vaultToken = resources.vault.token;
    // An explicit env choice always beats the packaged default. Until V1.13.1
    // the resources file silently overrode VAULT_STORAGE_FILE, so every
    // universe on a host wrote into ONE shared vault.enc (beta finding F9) —
    // a deployment that asked for isolation got commingling, silently.
    if (!process.env.VAULT_STORAGE_FILE && resources?.vault?.storageFile) storageFile = path.resolve(ROOT, resources.vault.storageFile);
    if (resources?.secrets) secrets = resources.secrets;
  } catch (err) {
    console.warn(`[bootstrap-vault] Warning reading ${RESOURCES_FILE}: ${err.message}`);
  }
}

const FIX = [
  'Generate real keys and mirror them — see docs/agent/RUNBOOK-EXPLICIT.md §4.1:',
  '  sed -i "s|^VAULT_MASTER_KEY=.*|VAULT_MASTER_KEY=$(openssl rand -hex 32)|" software/.env',
  '  sed -i "s|^VAULT_TOKEN=.*|VAULT_TOKEN=$(openssl rand -hex 24)|" software/.env',
  '  then run the runbook\'s python3 block, which fills the resources file from software/.env.',
];

if (!vaultMasterKey || !String(vaultMasterKey).trim()) {
  console.error(`[bootstrap-vault] HALT — VAULT_MASTER_KEY is missing: not exported in the shell, not in ${ENV_FILE}, and no vault.masterKey in ${RESOURCES_FILE}.`);
  for (const line of FIX) console.error(`[bootstrap-vault] ${line}`);
  process.exit(1);
}

// Rule 0J — a value the operator never chose must halt, not flow. The shipped
// resources examples carry their vault keys as templates
// (`<same as .env VAULT_MASTER_KEY>`, `<GENERATE_PASSPHRASE_OR_64_HEX>`), and a
// literal `cp` that was never filled in used to reach this point unchallenged:
// the vault was encrypted with the documentation itself as master key, the
// token the example publishes became the vault's bearer token, and the run
// exited 0 reporting OK (Muse Code beta, v1.13.7 incident 1). Documentation is
// not a key. Refuse it BEFORE anything is created — a halt that already wrote
// half a vault teaches the next run to trust a file nobody chose.
const PLACEHOLDER = [
  /<[^>]*>/,                                        // the examples' own shape: <same as .env VAULT_MASTER_KEY>
  /\bchange[-_ ]?me\b/i,
  /\bplaceholder\b/i,
  /\byour[-_ ](key|token|secret|master|passphrase)\b/i,
  /\b(todo|fixme|tbd)\b/i,
  /^x{3,}$/i,
  /^(example|sample|dummy|secret|password|token|key)$/i,
];
const isPlaceholder = (value) => PLACEHOLDER.some((re) => re.test(String(value).trim()));

function haltOnPlaceholder(field, value, origin) {
  if (value === undefined || value === null || !isPlaceholder(value)) return;
  console.error(`[bootstrap-vault] HALT — ${field} (${origin}) is still an example placeholder, not a value you chose.`);
  console.error('[bootstrap-vault] Rule 0J: a key nobody chose must never encrypt a vault. Nothing was written.');
  for (const line of FIX) console.error(`[bootstrap-vault] ${line}`);
  process.exit(1);
}

// Name where the refused value came from: a halt that says "the environment"
// about a key read from software/.env sends the operator to the wrong place.
function originOf(key) {
  if (FROM_ENV_FILE.has(key)) return `${key} in ${ENV_FILE}`;
  return process.env[key] ? `${key} in the environment` : RESOURCES_FILE;
}
haltOnPlaceholder('vault.masterKey', vaultMasterKey, originOf('VAULT_MASTER_KEY'));
haltOnPlaceholder('vault.token', vaultToken, originOf('VAULT_TOKEN'));

fs.mkdirSync(path.dirname(storageFile), { recursive: true });

const store = new VaultStore({ masterKey: vaultMasterKey, storageFile });
let count = 0;

for (const [key, payload] of Object.entries(secrets || {})) {
  store.setSecret(key, payload);
  count++;
}

// An empty vault is still a materialized vault. Without this write, a
// zero-secret TEST reports success but leaves no storage file, so every boot
// repeats bootstrap and no caller can distinguish "empty" from "never done".
if (!fs.existsSync(storageFile)) store.persist();

// Optional: write .env pointers (no secret values duplicated if already in resources)
const envPath = ENV_FILE;
const envLines = [
  `VAULT_MASTER_KEY=${vaultMasterKey}`,
  `VAULT_TOKEN=${vaultToken || ''}`,
  `VAULT_STORAGE_FILE=${storageFile}`,
  `BRIDGE_AGY_STUB=1`,
];
if (!fs.existsSync(envPath)) {
  fs.writeFileSync(envPath, envLines.join('\n') + '\n', { mode: 0o600 });
  console.log(`[bootstrap-vault] Created ${envPath} (vault pointers only)`);
}

console.log(`[bootstrap-vault] OK — ${count} secret(s) → ${storageFile}`);
