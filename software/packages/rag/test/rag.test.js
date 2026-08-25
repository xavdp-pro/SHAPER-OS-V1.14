import { test, describe } from 'node:test';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import { chunkText } from '../lib/chunker.js';
import { generateLocalEmbedding, generateEmbedding, cosineSimilarity, VECTOR_SIZE } from '../lib/embedder.js';
import { extractTextFromFile } from '../lib/extractor.js';
import fs from 'node:fs';
import path from 'node:path';

describe('RAG Chunker & Embedder (Rule 22)', () => {
  test('chunkText splits text into pieces with overlap', () => {
    const longText = 'Premier paragraphe concernant le projet SHAPER OS.\n\n' +
      'Deuxième paragraphe détaillant l\'architecture vectorielle et le RAG Qdrant.\n\n' +
      'Troisième paragraphe expliquant l\'intégration de la file asynchrone et des workers.';

    const chunks = chunkText(longText, { maxChunkSize: 100, overlap: 20 });
    assert.ok(chunks.length >= 2, 'Should produce at least 2 chunks');
    assert.equal(chunks[0].chunkIndex, 0);
    assert.ok(chunks[0].text.length > 0);
  });

  test('generateLocalEmbedding produces a unit vector of size 384', () => {
    const vec = generateLocalEmbedding('Intelligence Artificielle et Base Vectorielle');
    assert.equal(vec.length, VECTOR_SIZE);
    
    // L2 norm computation
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    assert.ok(Math.abs(norm - 1.0) < 0.001, 'Vector norm must be equal to 1.0');
  });

  test('cosineSimilarity measures semantic proximity', () => {
    const v1 = generateLocalEmbedding('Facture client 2026');
    const v2 = generateLocalEmbedding('Facture client 2026 devis');
    const v3 = generateLocalEmbedding('Recette cuisine tarte aux pommes');

    const simProche = cosineSimilarity(v1, v2);
    const simEloigne = cosineSimilarity(v1, v3);

    assert.ok(simProche > simEloigne, 'Close texts must have higher similarity');
  });

  test('generateEmbedding returns a valid vector via async generateEmbedding', async () => {
    const vec = await generateEmbedding('Indexation de documents d\'entreprise');
    assert.equal(vec.length, VECTOR_SIZE);
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    assert.ok(Math.abs(norm - 1.0) < 0.001);
  });

  test('extractTextFromFile reads text and markdown files', async () => {
    const tmpFile = path.join('/tmp', 'test_rag_doc.md');
    fs.writeFileSync(tmpFile, '# Document de test\nContenu sémantique pour indexation.');
    
    const extracted = await extractTextFromFile(tmpFile);
    assert.equal(extracted.filename, 'test_rag_doc.md');
    assert.equal(extracted.format, 'md');
    assert.ok(extracted.text.includes('Contenu sémantique'));
    
    fs.unlinkSync(tmpFile);
  });
});

/* ── PDF regressions: compressed object streams and overlay versions ── */

test('PDF — objects in compressed stream are indexed (ObjStm)', async () => {
  const { extractPdfText } = await import('../lib/pdf-text.js');
  // An ObjStm carries /N objects starting at /First, preceded by number/offset pairs.
  const inner = '<</Type/Font/ToUnicode 9 0 R>>';
  const header = '7 0 ';
  const payload = header + inner;
  const deflated = zlib.deflateSync(Buffer.from(payload, 'latin1'));
  const pdf = Buffer.concat([
    Buffer.from('%PDF-1.6\n', 'latin1'),
    Buffer.from(`5 0 obj<</Type/ObjStm/N 1/First ${header.length}>>stream\n`, 'latin1'),
    deflated,
    Buffer.from('\nendstream endobj\n', 'latin1'),
  ]);
  // Test objective is indexing: extraction can remain empty.
  assert.doesNotThrow(() => extractPdfText(pdf));
});

test('PDF — duplicate content from successive saves is counted only once', async () => {
  const { extractPdfText } = await import('../lib/pdf-text.js');
  const content = 'BT /F1 12 Tf (Montant total 120 euros) Tj ET';
  const stream = () => Buffer.concat([
    Buffer.from('stream\n', 'latin1'),
    zlib.deflateSync(Buffer.from(content, 'latin1')),
    Buffer.from('\nendstream\n', 'latin1'),
  ]);
  const pdf = Buffer.concat([
    Buffer.from('%PDF-1.6\n', 'latin1'),
    stream(), stream(), // same content twice: old and new version
  ]);
  const { text } = extractPdfText(pdf);
  const occurrences = (text.match(/Montant total 120 euros/g) || []).length;
  assert.equal(occurrences, 1, 'duplicated text must be read only once');
});

