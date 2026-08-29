import fs from 'node:fs';
import path from 'node:path';
import { files, rel } from '../lib/walk.js';

export const rule = 'Rule 27 — the escalation channel is declared, never assumed';
export const title = 'A universe promoted beyond dev declares its out-of-band alerting channel';
export const readAt = 'software/RULES.md';

/**
 * Rule 27 has required this since before V1.13; what was missing was the
 * check — four of five archetype designs routed alerts to a UI nobody is
 * looking at. "Alert the operator" is meaningless until the channel exists.
 */
export function run(root) {
  const findings = [];
  for (const file of files(root, '.json')) {
    if (!path.basename(file).startsWith('manifest')) continue;
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    if (!doc.bricks || typeof doc.bricks !== 'object') continue;
    if (doc.environment !== 'prod' && doc.environment !== 'test') continue;
    const channel = doc.alerting && typeof doc.alerting.channel === 'string' && doc.alerting.channel.trim();
    if (!channel) {
      findings.push(`${rel(root, file)} — environment "${doc.environment}" with no alerting.channel; a universe with no declared channel MUST NOT be promoted beyond DEV`);
    }
  }
  return findings;
}
