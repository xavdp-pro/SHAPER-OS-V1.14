#!/usr/bin/env node
// shaper verify — the law, made executable where it can be.
// One small check per enforceable rule; the rest of the canon binds by reading.
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(url.fileURLToPath(import.meta.url));

function repoRoot() {
  const flag = process.argv.indexOf('--root');
  if (flag !== -1) return path.resolve(process.argv[flag + 1]);
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
}

function canonRuleCount(root) {
  const rules = path.join(root, 'software', 'RULES.md');
  if (!fs.existsSync(rules)) return null;
  return (fs.readFileSync(rules, 'utf8').match(/^### Rule /gm) || []).length;
}

const root = repoRoot();
const checkDir = path.join(here, 'checks');
const checks = [];
for (const file of fs.readdirSync(checkDir).sort()) {
  if (file.endsWith('.mjs')) checks.push(await import(url.pathToFileURL(path.join(checkDir, file))));
}

let failed = 0;
console.log(`shaper verify — ${root}\n`);
for (const check of checks) {
  const findings = check.run(root);
  if (findings.length === 0) {
    console.log(`  PASS  ${check.title}`);
  } else {
    failed++;
    console.log(`  FAIL  ${check.title}`);
    console.log(`        The rule: ${check.rule}  →  read ${check.readAt}`);
    for (const f of findings) console.log(`        - ${f}`);
  }
}

// The honest count: a check citing "Rule N" enforces the canon; the others
// hold AGENTS.md and the Boot Contract. Counting checks as canon rules would
// be a numerator over the wrong denominator (Rule 0G).
const canonChecks = checks.filter((c) => /^Rule \d/.test(c.rule)).length;
const total = canonRuleCount(root);
console.log(`\n  ${checks.length} checks — ${canonChecks}${total ? ` of ${total}` : ''} canon rules enforced by machine` +
  `${checks.length > canonChecks ? `, ${checks.length - canonChecks} more holding AGENTS.md and the Boot Contract` : ''}` +
  (total ? ' — the rest binds by reading, in full.' : '.'));

if (failed > 0) {
  console.log(`\n  ${failed} rule${failed > 1 ? 's' : ''} violated. Stop. Fix. Do not stub your way to green.`);
  process.exit(1);
}
