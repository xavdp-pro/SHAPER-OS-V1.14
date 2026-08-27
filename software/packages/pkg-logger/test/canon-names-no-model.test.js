/**
 * Guard: the canon names no model.
 *
 * A rule that names a model expires with that model. This was not hypothetical:
 * until v1.8 Rule 0H recommended a two-generation-old model as its "elite" tier,
 * and Rule 7 was literally titled "Official LLM Models & Execution Defaults".
 * The canon had aged while the principle forbidding it was being written.
 *
 * Scope is deliberate. Rules, intents and doctrine are **prescriptive**: they must
 * outlive vendors. Proofs and verdicts are **descriptive** — they record which
 * engine actually answered on a given day, and must keep saying so.
 *
 * Rule 0B (zero hardcoding) · Rule 7 · Rule 29 (a fixed defect ships its test).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Intent: software/RULES.md#rule-7

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** Prescriptive texts: they bind future behaviour, so they must not name a product. */
function canonFiles() {
  const out = execFileSync('git', ['-C', REPO, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter(Boolean).filter((rel) => {
    if (!rel.endsWith('.md')) return false;
    // Descriptive records keep their model names: that is what they are for.
    if (/\/proof\/|VERDICT|CHANGELOG|COLD-READ/.test(rel)) return false;
    // Third-party application docs vendored under the helm app are not the canon.
    if (rel.startsWith('software/bricks/brick-helm/app/')) return false;
    return rel === 'INTENT.md' || rel === 'LAW.md' || rel === 'README.md'
      || rel === 'software/RULES.md' || rel === 'software/INTENT.md'
      || rel.startsWith('docs/') || rel.startsWith('doctrine/')
      || /^software\/(bricks|packages)\/[^/]+\/INTENT\.md$/.test(rel);
  }).concat(
    // Configuration and code ship defaults, and a default expires exactly like a
    // rule does. The model pinned in .env.example, in a Containerfile, in a deploy
    // script and in a package source had been withdrawn from its catalogue while
    // the suite stayed green — because the guard only read Markdown.
    out.split('\0').filter(Boolean).filter((rel) => {
      if (rel.startsWith('software/bricks/brick-helm/app/')) return false;
      // A parser test needs realistic input, and a test ships no default to
      // production. Fixtures are data; only what runs is a promise.
      if (/\.test\.[cm]?js$/.test(rel)) return false;
      return /\.env\.example$/.test(rel)
        || /(^|\/)Containerfile$/.test(rel)
        || /^examples\/deploy\/.*\.sh$/.test(rel)
        || /^software\/packages\/(pkg-bridge-opencode|pkg-opencode-server)\/[^/]+\.(js|mjs)$/.test(rel);
    }),
  ).filter((rel) => {
    return true;
  }).map((rel) => [rel, path.join(REPO, rel)])
    .filter(([, abs]) => fs.existsSync(abs))
    // A document may declare itself a dated snapshot. The declaration lives in the
    // file, in the first lines a reader sees — not hidden in this test.
    .filter(([, abs]) => !/^>?\s*\*\*Status\*\*:\s*dated snapshot/m.test(
      fs.readFileSync(abs, 'utf8').split('\n').slice(0, 12).join('\n'),
    ));
}

/** Versioned product identifiers. A vendor family name alone is allowed: a bridge
 *  brick must be able to say which CLI it wraps. A *version* is what expires. */
const VERSIONED_MODEL = new RegExp(
  [
    'claude[- ]?\\d',
    'gpt[- ]?\\d',
    'gemini[- ]?\\d',
    'grok[- ]?\\d',
    'llama[- ]?\\d',
    'qwen\\d',
    'mistral[- ]?\\d',
    'nemotron[- ]?\\d',
    'deepseek[- ]?[vr]\\d',
    'composer[- ]?\\d',
    'mimo[- ]?v\\d',
    'o[1-9][- ]?(mini|preview)',
  ].join('|'),
  'gi',
);

describe('the canon names no model', () => {
  it('contains no versioned model identifier in any prescriptive text', () => {
    const violations = [];
    for (const [rel, abs] of canonFiles()) {
      fs.readFileSync(abs, 'utf8').split('\n').forEach((line, i) => {
        VERSIONED_MODEL.lastIndex = 0;
        const m = VERSIONED_MODEL.exec(line);
        if (m) violations.push(`${rel}:${i + 1}  ${m[0]}`);
      });
    }
    assert.deepEqual(
      violations,
      [],
      'A prescriptive text names a specific model version. It will be wrong the day '
      + 'that vendor ships a successor, and the rule will quietly recommend the past. '
      + 'Declare the required depth and throughput instead '
      + `(docs/architecture/COGNITION.md):\n  ${violations.join('\n  ')}\n`,
    );
  });

  it('still lets proofs and verdicts record what actually answered', () => {
    // A verdict that could not name the engine it measured would prove nothing.
    const rels = canonFiles().map(([rel]) => rel);
    assert.ok(!rels.some((r) => r.includes('VERDICT')), 'verdicts must stay out of this guard');
  });
});
