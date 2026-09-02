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
// PASS and PWD are matched as whole segments: REGISTRY_PASS and DB_PWD are
// passwords, BYPASS_CACHE is not.
const IDENTITY = /(USER|PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|EMAIL|MAILBOX|DOMAIN|HOST|ADMIN|CREDENTIAL|ACCOUNT)|(?:^|_)(?:PASS|PWD)(?:_|$)/;
const ENV_FALLBACK = /process\.env\.(\w+)\s*(?:\|\||\?\?)\s*['"`](\S{4,})['"`]/g;
// The same construct, spelled the way a shell spells it: ${VAR:-value} and
// ${VAR-value}. Until V1.13 this check knew only the JavaScript spelling, and
// push-images-to-registry.sh shipped a registry IP, an account and a real
// password as shell fallbacks for a whole release while the check stayed
// green. A value that starts with `$` is a fallback to another variable, not
// a committed value, and is left alone.
const SHELL_FALLBACK = /\$\{(\w+):?-([^}$]{4,})\}/g;
// An assigned secret: spaceless (an i18n label has spaces, a password rarely does).
// `_pass` and `_pwd` are the shell's usual suffixes for the same thing.
const SECRET = /(?:password|passwd|_pass|_pwd|api[_-]?key|secret|token)['"]?\s*[:=]\s*['"]([^'"$<{\s]{7,})['"]/gi;
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
    for (const re of [ENV_FALLBACK, SHELL_FALLBACK]) {
      for (const m of text.matchAll(re)) {
        if (IDENTITY.test(m[1]) && !SAFE_VALUE.test(m[2])) {
          findings.push(`${rel(root, file)} — identity fallback: ${m[0].slice(0, 70)}`);
        }
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
