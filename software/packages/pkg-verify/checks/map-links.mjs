import fs from 'node:fs';
import path from 'node:path';
import { files, rel } from '../lib/walk.js';

export const rule = 'AGENTS.md — documentation is a map';
export const title = 'Every relative link between files resolves';
export const readAt = 'AGENTS.md#documentation-is-a-map';

const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;

/** A broken link fails silently forever — nobody follows a link to check it. */
export function run(root) {
  const findings = [];
  for (const file of files(root, '.md')) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(LINK)) {
      const target = match[1];
      if (/^(https?:|mailto:|#|tel:)/.test(target)) continue;
      const clean = target.split('#')[0];
      if (!clean) continue;
      const resolved = path.resolve(path.dirname(file), decodeURIComponent(clean));
      if (!resolved.startsWith(path.resolve(root) + path.sep)) {
        // A link that climbs out of the repository only resolved before the
        // extraction split — it now depends on which folders sit beside a clone.
        findings.push(`${rel(root, file)} → ${target} leaves the repository`);
      } else if (!fs.existsSync(resolved)) {
        findings.push(`${rel(root, file)} → ${target} points at nothing`);
      }
    }
  }
  return findings;
}
