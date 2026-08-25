/**
 * @package @shaper/rag
 * @description Moteur d'indexation RAG & Vectoriel pour SHAPER-OS.
 */

import { QdrantClient } from './lib/qdrantClient.js';
import { chunkText } from './lib/chunker.js';
import { generateEmbedding, VECTOR_SIZE } from './lib/embedder.js';
import { extractTextFromFile } from './lib/extractor.js';
import crypto from 'node:crypto';

export class QdrantRagEngine {
  constructor(options = {}) {
    this.qdrantUrl = options.qdrantUrl || process.env.QDRANT_URL || 'http://127.0.0.1:6333';
    this.client = new QdrantClient(this.qdrantUrl);
    this.defaultCollection = options.defaultCollection || 'documents';
    this.memoryCollection = options.memoryCollection || 'memories';
  }

  /**
   * Initialise les collections nécessaires dans Qdrant
   */
  async init() {
    await this.client.ensureCollection(this.defaultCollection, VECTOR_SIZE, 'Cosine');
    await this.client.ensureCollection(this.memoryCollection, VECTOR_SIZE, 'Cosine');
    return { ok: true, collections: [this.defaultCollection, this.memoryCollection] };
  }

  /**
   * Indexe un document complet (extraction, chunking, embedding, insertion Qdrant)
   */
  async indexDocument(params = {}) {
    const {
      filePath,
      fileId = crypto.randomUUID(),
      metadata = {},
      collection = this.defaultCollection,
    } = params;

    // 1. Extraction du texte
    const extracted = await extractTextFromFile(filePath);
    if (!extracted.text || !extracted.text.trim()) {
      return { ok: false, error: 'Document vide ou non extractible', chunks: 0 };
    }

    // 2. Découpage en chunks sémantiques
    const chunks = chunkText(extracted.text, {
      maxChunkSize: 800,
      overlap: 120,
    });

    if (!chunks.length) {
      return { ok: false, error: 'Aucun fragment généré', chunks: 0 };
    }

    // 3. Suppression des anciens vecteurs associés à ce fileId s'il existait déjà
    try {
      await this.client.deletePointsByFileId(collection, fileId);
    } catch {
      /* ignore */
    }

    // 4. Vectorisation de chaque chunk et préparation des points
    const points = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const vector = await generateEmbedding(chunk.text);
      const pointId = crypto.randomUUID();

      points.push({
        id: pointId,
        vector,
        payload: {
          file_id: fileId,
          filename: extracted.filename,
          format: extracted.format,
          chunk_index: chunk.chunkIndex,
          total_chunks: chunks.length,
          text: chunk.text,
          char_start: chunk.charStart,
          char_end: chunk.charEnd,
          indexed_at: Date.now(),
          ...metadata,
        },
      });
    }

    // 5. Insertion par lot dans Qdrant
    await this.client.upsertPoints(collection, points);

    return {
      ok: true,
      fileId,
      filename: extracted.filename,
      chunksCount: chunks.length,
      collection,
    };
  }

  /**
   * Indexe directement un texte libre ou une mémoire de travail
   */
  async indexText(text, metadata = {}, collection = this.memoryCollection) {
    if (!text || !text.trim()) return { ok: false, error: 'Texte vide' };
    const chunks = chunkText(text, { maxChunkSize: 600, overlap: 80 });
    const memoryId = metadata.memoryId || crypto.randomUUID();

    const points = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const vector = await generateEmbedding(chunk.text);
      const pointId = crypto.randomUUID();

      points.push({
        id: pointId,
        vector,
        payload: {
          memory_id: memoryId,
          chunk_index: chunk.chunkIndex,
          total_chunks: chunks.length,
          text: chunk.text,
          indexed_at: Date.now(),
          ...metadata,
        },
      });
    }

    await this.client.upsertPoints(collection, points);
    return { ok: true, memoryId, chunksCount: chunks.length, collection };
  }

  /**
   * Recherche sémantique par similarité Cosine
   */
  async search(queryText, options = {}) {
    const {
      limit = 5,
      collection = this.defaultCollection,
      filter = null,
    } = options;

    if (!queryText || !queryText.trim()) return [];

    const queryVector = await generateEmbedding(queryText);
    const results = await this.client.searchPoints(collection, queryVector, limit, filter);

    return results.map((r) => ({
      id: r.id,
      score: r.score,
      text: r.payload?.text || '',
      fileId: r.payload?.file_id,
      filename: r.payload?.filename,
      chunkIndex: r.payload?.chunk_index,
      totalChunks: r.payload?.total_chunks,
      payload: r.payload,
    }));
  }

  /**
   * Supprime tous les vecteurs associés à un fichier
   */
  async deleteDocument(fileId, collection = this.defaultCollection) {
    return this.client.deletePointsByFileId(collection, fileId);
  }

  /**
   * Récupère les métriques et statistiques globales du RAG
   */
  async getStats() {
    const status = await this.client.getStatus();
    const docCount = await this.client.countPoints(this.defaultCollection);
    const memCount = await this.client.countPoints(this.memoryCollection);

    return {
      qdrant: status,
      counts: {
        documents: docCount,
        memories: memCount,
        total: docCount + memCount,
      },
    };
  }
}

export { QdrantClient } from './lib/qdrantClient.js';
export { chunkText } from './lib/chunker.js';
export { generateEmbedding, generateLocalEmbedding } from './lib/embedder.js';
export { extractTextFromFile } from './lib/extractor.js';
