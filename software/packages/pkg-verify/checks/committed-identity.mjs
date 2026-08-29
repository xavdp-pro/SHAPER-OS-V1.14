import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { walk, rel } from '../lib/walk.js';

export const rule = 'Boot Contract 10b — never commit what is yours alone';
export const title = 'No credential, .env, or hardcoded identity in tracked files';
export const readAt = 'docs/agent/BOOT-CONTRACT.md';

const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.sh', '.json', '.yml', '.yaml', '.env']);
const SAFE_VALUE = /localhost|127\.0\.0\.1|0\.0\.0\.0|example|placeholder|changeme|change-me|^set-|<[^>]+>|^\/|^\.{1,2}\//i;

// Only a fallback on a variable that names an identity or a secret is a 10b
// violation. A default port or model name is configuration; a default user,
// password or domain is *someone's*, and it runs on everyone else's machine.
const IDENTITY = /(USER|PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|EMAIL|MAILBOX|DOMAIN|HOST|ADMIN|CREDENTIAL|ACCOUNT)/;
const ENV_FALLBACK = /process\.env\.(\w+)\s*(?:\|\||\?\?)\s*['"`](\S{4,})['"`]/g;
// An assigned secret: spaceless (an i18n label has spaces, a password rarely does).
const SECRET = /(?:password|passwd|api[_-]?key|secret|token)['"]?\s*[:=]\s*['"]([^'"$<{\s]{7,})['"]/gi;
const SECRET_SAFE = /example|placeholder|changeme|change-me|your[-_]|dummy|redacted|xxx|\*\*\*|process\.env|vault/i;

/** In a git repo, "committed" means tracked — the working tree is not the crime scene. */
function candidates(root) {
  try {
    // stderr ignored: outside a git repo the fallback below is the answer,
    // not a French "fatal:" line spilled between PASS lines.
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\0').filter(Boolean).map((f) => path.join(root, f));
  } catch {
    return [...walk(root)];
  }
}

export function run(root) {
  const findings = [];
  for (const file of candidates(root)) {
    if (!fs.existsSync(file)) continue;
    const base = path.basename(file);
    const ext = path.extname(file) || (base.startsWith('.env') ? '.env' : '');
    if (base.startsWith('.env') && !base.includes('example')) {
      findings.push(`${rel(root, file)} — a tracked .env is a shipped credential`);
      continue;
    }
    if (!TEXT_EXT.has(ext)) continue;
    if (/(^|\/)(test|tests|e2e)\//.test(rel(root, file)) || /\.(test|spec)\./.test(base)) continue;
    if (/locale|i18n|translation/i.test(base)) continue; // a dictionary of the word "password" is not a password
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(ENV_FALLBACK)) {
      if (IDENTITY.test(m[1]) && !SAFE_VALUE.test(m[2])) {
        findings.push(`${rel(root, file)} — identity fallback: ${m[0].slice(0, 70)}`);
      }
    }
    for (const m of text.matchAll(SECRET)) {
      if (!SECRET_SAFE.test(m[0]) && !SAFE_VALUE.test(m[1])) {
        findings.push(`${rel(root, file)} — looks like a committed credential: ${m[0].slice(0, 40)}…`);
      }
    }
  }
  return findings;
}
