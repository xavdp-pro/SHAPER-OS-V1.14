import fs from 'node:fs';
import path from 'node:path';
import { files, rel } from '../lib/walk.js';

export const rule = 'Rule 37 — three manifest fields carry all lineage, never the slug';
export const title = 'Every declared brick states perimeter and source; a fork states forkedFrom';
export const readAt = 'software/RULES.md#rule-37';

const PERIMETERS = new Set(['P1', 'P2', 'P3']);
const SOURCES = new Set(['base', 'catalogue', 'fork', 'native']);

// The canonical layer of the known bricks (docs/PERIMETERS.md). A fork may
// harden a brick, never relocate it: perimeter means LAYER, not OWNER.
const CANON = {
  'brick-vault': 'P1', 'brick-logger': 'P1', 'brick-queue': 'P1', 'brick-mariadb': 'P1',
  'brick-maestro': 'P2', 'brick-bridge-opencode': 'P2', 'brick-bridge-agy': 'P2',
  'brick-bridge-cursor': 'P2', 'brick-bridge-deepseek': 'P2', 'brick-helm': 'P2',
  'brick-ged': 'P2', 'brick-qdrant': 'P2', 'brick-pipeline': 'P2',
};

export function run(root) {
  const findings = [];
  for (const file of files(root, '.json')) {
    if (!path.basename(file).startsWith('manifest')) continue;
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue; // profile-bootorder already reports invalid JSON
    }
    if (!doc.bricks || typeof doc.bricks !== 'object') continue;
    const where = rel(root, file);

    if (doc.forkedFrom && !(doc.forkedFrom.repo && doc.forkedFrom.atTag)) {
      findings.push(`${where} — repo-level forkedFrom must name { repo, atTag }`);
    }

    for (const [name, brick] of Object.entries(doc.bricks)) {
      if (typeof brick !== 'object' || brick === null) continue;
      if (!PERIMETERS.has(brick.perimeter)) {
        findings.push(`${where} — ${name} declares no perimeter (P1|P2|P3); the layer is never inferred`);
      } else if (CANON[name] && brick.perimeter !== CANON[name]) {
        findings.push(`${where} — ${name} declares ${brick.perimeter}, the canon says ${CANON[name]} (layer, never owner)`);
      }
      if (!SOURCES.has(brick.source)) {
        findings.push(`${where} — ${name} has source "${brick.source}", not one of base|catalogue|fork|native`);
      }
      const hasLineage = brick.forkedFrom && brick.forkedFrom.package && brick.forkedFrom.atVersion;
      if (brick.source === 'fork' && !hasLineage) {
        findings.push(`${where} — ${name} is a fork with no forkedFrom { package, atVersion }; a fork whose origin is unknown cannot be maintained`);
      }
      if (brick.source !== 'fork' && brick.forkedFrom) {
        findings.push(`${where} — ${name} carries forkedFrom but is not source: fork — one of the two is lying`);
      }
    }
  }
  return findings;
}
