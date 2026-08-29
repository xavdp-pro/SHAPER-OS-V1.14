import fs from 'node:fs';
import path from 'node:path';

export const rule = 'Rule 1 — the universe repo grammar: univ-<projet>-<classe>';
export const title = 'A universe repo parses as univ-<projet>-<classe> and records its lineage';
export const readAt = 'software/RULES.md';

const GRAMMAR = /^univ-[a-z0-9]+-[a-z0-9-]+$/;

/**
 * Applies only when the verified repo IS a universe class repo (its folder
 * carries the univ- prefix). The base and the catalogue are other repo kinds
 * (Rule 1) and pass through untouched.
 */
export function run(root) {
  const findings = [];
  const name = path.basename(root);
  if (!name.startsWith('univ-')) return findings;

  if (!GRAMMAR.test(name)) {
    findings.push(`repo "${name}" does not parse as univ-<projet>-<classe> — a single-class project takes -core`);
  }
  if (!fs.existsSync(path.join(root, 'LINEAGE.md'))) {
    findings.push(`repo "${name}" has no LINEAGE.md — a repository whose origin is unknown cannot be maintained (birth procedure step 2)`);
  }
  return findings;
}
