import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chunkText } from '../lib/chunker.js';
import { generateLocalEmbedding, VECTOR_SIZE } from '../lib/embedder.js';
import { extractTextFromFile } from '../lib/extractor.js';
import fs from 'node:fs';
import path from 'node:path';

describe('RAG Chunker & Embedder', () => {
  test('chunkText splits text into chunks with overlap', () => {
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
    
    // Calculate L2 norm
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    assert.ok(Math.abs(norm - 1.0) < 0.001, 'Vector norm must equal 1.0');
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
