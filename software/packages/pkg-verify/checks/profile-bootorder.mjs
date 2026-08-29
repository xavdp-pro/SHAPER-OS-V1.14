import fs from 'node:fs';
import path from 'node:path';
import { files, rel } from '../lib/walk.js';

export const rule = 'AGENTS.md §4b + Boot Contract 6 — a named profile, an explicit start order';
export const title = 'Every universe manifest declares a known profile and a bootOrder covering its bricks';
export const readAt = 'docs/architecture/UNIVERSE-PROFILES.md';

// Two agents once received the same words, "the base universe", and built
// different things. Naming the profile is what ended that — so the name is checked.
const PROFILE = /^(passive|agent)(\s+\+(documents|data|web|public|parent))*$/;

export function run(root) {
  const findings = [];
  for (const file of files(root, '.json')) {
    if (!path.basename(file).startsWith('manifest')) continue;
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      findings.push(`${rel(root, file)} — not valid JSON`);
      continue;
    }
    if (!doc.bricks || typeof doc.bricks !== 'object') continue; // not a universe manifest
    const where = rel(root, file);

    if (!doc.profile) {
      findings.push(`${where} — no profile named; "the base universe" built two different things once`);
    } else if (!PROFILE.test(doc.profile)) {
      findings.push(`${where} — profile "${doc.profile}" is not in the defined vocabulary`);
    }

    const declared = new Set(Object.keys(doc.bricks));
    if (!Array.isArray(doc.bootOrder)) {
      findings.push(`${where} — no bootOrder; start order is declared, never improvised`);
      continue;
    }
    const ordered = new Set(doc.bootOrder.flat());
    for (const brick of declared) {
      if (!ordered.has(brick)) findings.push(`${where} — ${brick} declared but absent from bootOrder`);
    }
    for (const brick of ordered) {
      if (!declared.has(brick)) findings.push(`${where} — bootOrder names ${brick}, which is not declared`);
    }
  }
  return findings;
}
