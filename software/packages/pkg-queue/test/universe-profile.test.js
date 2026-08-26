import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * A declared profile must match the bricks that are actually there.
 *
 * Two agents were asked for "the base universe" in the same words and built
 * different things, because the phrase had no definition. Profiles give the
 * starting points names — and a name nobody verifies is decoration. A manifest
 * that claims `passive` while running a bridge and a maestro is lying about what
 * it is, and the next agent will believe it.
 *
 * The check is one-directional on purpose: the floor must be present, and adding
 * bricks beyond it is expected. That is the work.
 *
 * docs/architecture/UNIVERSE-PROFILES.md
 */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** Floors, as brick keys. A bridge is any `bridge-*`: the engine is swappable. */
const FLOORS = {
  passive: ['logger'],
  agent: ['vault', 'logger', 'bridge-*', 'queue', 'maestro'],
};

/** Human Archetype Presets & Aliases mapping to canonical formulas */
const PRESETS = {
  'tier-a': 'agent',
  store: 'passive +data +public',
  'document-hub': 'agent +documents +public',
  'fleet-manager': 'agent +parent +public',
  'telephony-hub': 'agent +telephony +softphone +webmail',
  'field-service': 'agent +documents +voice',
  'accounting-vault': 'agent +documents +data +banking',
  helpdesk: 'agent +intake +messaging +documents',
  'booking-engine': 'passive +data +calendar +public',
  academy: 'passive +data +billing +public',
  watchdog: 'agent +clock',
  brochure: 'passive +public',
  'mail-triage': 'agent +intake +data',
};

const OPTION_ALIASES = {
  standard: 'telephony',
  phone: 'softphone',
  courriel: 'webmail',
  security: 'waf',
  payment: 'billing',
  paiement: 'billing',
  audio: 'voice',
  voix: 'voice',
  whatsapp: 'messaging',
  agenda: 'calendar',
  pdf: 'pdf-toolkit',
  dms: 'documents',
  ged: 'documents',
  db: 'data',
  bdd: 'data',
  cockpit: 'web',
  online: 'public',
  mail: 'intake',
  supervisor: 'parent',
  superviseur: 'parent',
  cron: 'clock',
  formulaire: 'forms',
  formulaires: 'forms',
  texto: 'sms',
  capteurs: 'iot',
  banque: 'banking',
  edi: 'sftp',
  avis: 'social',
};

const OPTIONS = {
  documents: ['ged'],          // qdrant and rag travel with it, not always as containers
  data: ['mariadb'],
  web: ['helm'],
  public: ['tunnel'],
  clock: ['maestro'],
  parent: [],                  // supervisor is in-process, nothing to assert here
  intake: [],                  // mail-agent is in-process
  telephony: [],               // target / ipbx
  softphone: [],               // target / webrtc
  webmail: [],                 // target / webmail UI
  waf: [],                     // target / adaptive firewall
  billing: [],                 // target
  voice: [],                   // target
  messaging: [],               // target
  calendar: [],                // target
  forms: [],                   // target
  sms: [],                     // target
  iot: [],                     // target
  banking: [],                 // target
  sftp: [],                    // target
  social: [],                  // target
  'pdf-toolkit': [],           // target
};

function manifests() {
  const out = execFileSync('git', ['-C', REPO, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return out.split('\0').filter(Boolean)
    .filter((rel) => /(^|\/)manifest[^/]*\.json$/.test(rel) && !rel.includes('node_modules'))
    .map((rel) => [rel, path.join(REPO, rel)])
    .filter(([, abs]) => fs.existsSync(abs));
}

// V1.11: manifest keys carry the brick- prefix, while the profile tables name
// components (`vault`, `bridge-*`). Strip the layer to compare like with like —
// the prefix states the layer, it does not change which component this is.
function has(bricks, key) {
  const components = bricks.map((b) => b.replace(/^brick-/, ''));
  return key.endsWith('*')
    ? components.some((b) => b.startsWith(key.slice(0, -1)))
    : components.includes(key);
}

function resolveProfile(raw) {
  const rawParts = String(raw).split('+').map((s) => s.trim()).filter(Boolean);
  const head = rawParts[0];
  const tail = rawParts.slice(1);

  if (PRESETS[head]) {
    const [presetFloor, ...presetOpts] = PRESETS[head].split('+').map((s) => s.trim()).filter(Boolean);
    return [presetFloor, ...presetOpts, ...tail];
  }
  return [head, ...tail];
}

test('every declared profile is backed by the bricks it names', () => {
  const problems = [];
  let checked = 0;

  for (const [rel, abs] of manifests()) {
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { continue; }
    const profile = manifest.profile;
    if (!profile) continue;                       // declaring one is not mandatory yet
    checked += 1;

    const bricks = Object.keys(manifest.bricks || {});
    const resolved = resolveProfile(profile);
    const floor = resolved[0];
    const rawOptions = resolved.slice(1);
    const options = rawOptions.map((opt) => OPTION_ALIASES[opt] || opt);

    if (!FLOORS[floor]) {
      problems.push(`${rel}: unknown floor "${floor}" (from profile "${profile}") — expected passive or agent`);
      continue;
    }

    for (const required of FLOORS[floor]) {
      if (!has(bricks, required)) {
        problems.push(`${rel}: profile "${profile}" requires ${required}, which is not in bricks`);
      }
    }
    for (const option of options) {
      if (!(option in OPTIONS)) {
        problems.push(`${rel}: unknown option "+${option}" in profile "${profile}"`);
        continue;
      }
      for (const required of OPTIONS[option]) {
        if (!has(bricks, required)) {
          problems.push(`${rel}: option "+${option}" requires ${required}, which is not in bricks`);
        }
      }
    }
  }

  assert.ok(checked > 0, 'expected at least one manifest to declare a profile');
  assert.deepEqual(
    problems,
    [],
    `A manifest declares a profile it does not carry:\n  ${problems.join('\n  ')}\n`,
  );
});

test('preset aliases resolve to valid canonical floors and known options', () => {
  for (const [preset, formula] of Object.entries(PRESETS)) {
    const resolved = resolveProfile(preset);
    const floor = resolved[0];
    const options = resolved.slice(1).map((opt) => OPTION_ALIASES[opt] || opt);

    assert.ok(FLOORS[floor], `preset "${preset}" resolves to invalid floor "${floor}"`);
    for (const opt of options) {
      assert.ok(opt in OPTIONS, `preset "${preset}" contains unknown option "+${opt}"`);
    }
  }
});
