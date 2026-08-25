import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeSimilarity,
  evaluateCategory,
  normalizeText,
  buildPodmanMeasureArgs,
} from './measure.mjs';

const corpusRoot = path.dirname(fileURLToPath(import.meta.url));

describe('measure.mjs', () => {
  it('normalizes whitespace for comparison', () => {
    assert.equal(normalizeText('  Hello\n\nWorld  '), 'hello world');
  });

  it('scores identical normalized text at 100 %', () => {
    assert.equal(computeSimilarity('Bonjour le monde', 'bonjour le monde'), 1);
  });

  it('uses a supplied extractor instead of the host RAG extractor', async () => {
    const results = await evaluateCategory('00-sources', {
      corpusRoot,
      extractFn: async (pdfPath) => ({
        text: `stub for ${pdfPath.split('/').pop()}`,
        format: 'pdf',
        witnesses: ['stub'],
      }),
    });
    assert.ok(results.length >= 1);
    assert.equal(results[0].format, 'pdf');
    assert.deepEqual(results[0].witnesses, ['stub']);
    assert.ok(results[0].similarity < 1, 'stub text must not match ground truth');
  });

  it('builds a podman invocation that mounts the corpus and runs in-container', () => {
    const args = buildPodmanMeasureArgs({
      corpusDir: '/tmp/corpus',
      image: 'localhost/shaper-pipeline:latest',
    });
    assert.deepEqual(args.slice(0, 4), ['run', '--rm', '--cgroups=disabled', '-v']);
    assert.match(args.join(' '), /\/tmp\/corpus:\/work:Z/);
    assert.match(args.join(' '), /measure-in-container\.mjs$/);
  });
});
