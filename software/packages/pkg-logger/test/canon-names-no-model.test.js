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
    //
    // Every package, not two. The first sweep read only the opencode packages,
    // and a pinned Composer version, a pinned Ollama model, a Gemini fallback
    // and a worked example in the queue consumer naming the very model the
    // clean-sheet record documents as withdrawn all survived it — each one a
    // default the guard was written to refuse, sitting one directory over.
    // The universe template's deploy script is read for the same reason: it
    // pinned a second, different version of the model a package pinned.
    //
    // A package manifest is read too. The review of that sweep found two
    // `description` fields still naming a Composer version and a DeepSeek
    // generation: a manifest is what a registry and a reader see first, so a
    // version there is a promise about the engine exactly like one in code.
    out.split('\0').filter(Boolean).filter((rel) => {
      if (rel.startsWith('software/bricks/brick-helm/app/')) return false;
      // A parser test needs realistic input, and a test ships no default to
      // production. Fixtures are data; only what runs is a promise.
      if (/\.test\.[cm]?js$/.test(rel)) return false;
      if (/\/(test|tests|fixtures?|__fixtures__)\//.test(rel)) return false;
      return /\.env\.example$/.test(rel)
        || /(^|\/)Containerfile$/.test(rel)
        || /^examples\/deploy\/.*\.sh$/.test(rel)
        || /^software\/universes\/_template\/deploy\/podman-up\.sh$/.test(rel)
        || /^software\/packages\/[^/]+\/package\.json$/.test(rel)
        || /^software\/packages\/[^/]+\/.*\.(js|mjs|cjs)$/.test(rel);
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
    // An open-weight family is versioned by its name as much as by a digit: the
    // deepseek bridge's Containerfile pinned one such family with a parameter
    // count, and the guard read the line and let it through.
    'gpt[- ]?oss',
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

  /**
   * An example env file is a default with the operator's name on it: whatever
   * value it ships is what every deployment starts from. The versioned-name
   * pattern above let one through — `GROQ_ACK_MODEL=groq/compound-mini`, the
   * voice acknowledgement engine, shipped in both .env.example files with no
   * digit in its name — so the rule for these files is the variable's shape,
   * not the vendor's spelling: a variable named `*_MODEL` carries no value.
   * It is measured at deploy, never written here (Rule 7).
   */
  it('no tracked .env.example gives a *_MODEL variable a value', () => {
    const shipped = [];
    const out = execFileSync('git', ['-C', REPO, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const examples = out.split('\0').filter((rel) => /\.env\.example$/.test(rel) && fs.existsSync(path.join(REPO, rel)));
    assert.ok(examples.length > 0, 'the tree ships at least one .env.example');
    for (const rel of examples) {
      fs.readFileSync(path.join(REPO, rel), 'utf8').split('\n').forEach((line, i) => {
        const m = /^\s*#?\s*([A-Z][A-Z0-9_]*_MODEL)=(.+)$/.exec(line);
        if (m && m[2].trim()) shipped.push(`${rel}:${i + 1}  ${m[1]}=${m[2].trim()}`);
      });
    }
    assert.deepEqual(
      shipped,
      [],
      'A model shipped as a value in an example env file is a default, and a default '
      + 'that must be edited when a vendor ships a successor is a cache, not a rule '
      + `(Rule 7). Declare the variable empty and measure it at deploy:\n  ${shipped.join('\n  ')}\n`,
    );
  });

  it('still lets proofs and verdicts record what actually answered', () => {
    // A verdict that could not name the engine it measured would prove nothing.
    const rels = canonFiles().map(([rel]) => rel);
    assert.ok(!rels.some((r) => r.includes('VERDICT')), 'verdicts must stay out of this guard');
  });
});
