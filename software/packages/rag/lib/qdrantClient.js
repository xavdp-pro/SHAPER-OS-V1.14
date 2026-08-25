/**
 * @file qdrantClient.js
 * @description High-performance native REST client for Qdrant Vector DB.
 */

export class QdrantClient {
  constructor(baseUrl = process.env.QDRANT_URL || 'http://127.0.0.1:6333') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async fetch(path, options = {}) {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    if (process.env.QDRANT_API_KEY) {
      headers['api-key'] = process.env.QDRANT_API_KEY;
    }

    const res = await fetch(url, {
      ...options,
      headers,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Qdrant API error [${res.status}]: ${errText}`);
    }

    return res.json();
  }

  /**
   * Checks general health of Qdrant cluster
   */
  async getStatus() {
    try {
      const root = await this.fetch('/');
      const collections = await this.listCollections();
      return {
        ok: true,
        version: root.version || 'unknown',
        collections: collections.map((c) => c.name),
      };
    } catch (err) {
      return {
        ok: false,
        error: err.message,
      };
    }
  }

  /**
   * Lists all existing collections
   */
  async listCollections() {
    const data = await this.fetch('/collections');
    return data.result?.collections || [];
  }

  /**
   * Creates a collection if it does not already exist
   */
  async ensureCollection(name, size = 384, distance = 'Cosine') {
    const collections = await this.listCollections();
    const exists = collections.some((c) => c.name === name);
    if (exists) return { created: false, name };

    await this.fetch(`/collections/${name}`, {
      method: 'PUT',
      body: JSON.stringify({
        vectors: {
          size,
          distance,
        },
      }),
    });

    return { created: true, name };
  }

  /**
   * Inserts or updates vector points with metadata
   * @param {string} collectionName
   * @param {Array<{ id: string|number, vector: number[], payload: object }>} points
   */
  async upsertPoints(collectionName, points) {
    if (!points || !points.length) return { ok: true, count: 0 };

    await this.fetch(`/collections/${collectionName}/points`, {
      method: 'PUT',
      body: JSON.stringify({
        points,
      }),
    });

    return { ok: true, count: points.length };
  }

  /**
   * Semantic search by vector similarity
   * @param {string} collectionName
   * @param {number[]} vector
   * @param {number} limit
   * @param {object} filter
   */
  async searchPoints(collectionName, vector, limit = 5, filter = null) {
    const body = {
      vector,
      limit,
      with_payload: true,
    };
    if (filter) {
      body.filter = filter;
    }

    const data = await this.fetch(`/collections/${collectionName}/points/search`, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    return data.result || [];
  }

  /**
   * Deletes points by filter (e.g. deletion of a complete file)
   */
  async deletePointsByFileId(collectionName, fileId) {
    return this.fetch(`/collections/${collectionName}/points/delete`, {
      method: 'POST',
      body: JSON.stringify({
        filter: {
          must: [
            {
              key: 'file_id',
              match: { value: fileId },
            },
          ],
        },
      }),
    });
  }

  /**
   * Retrieves total number of vectors in a collection
   */
  async countPoints(collectionName) {
    try {
      const data = await this.fetch(`/collections/${collectionName}/points/count`, {
        method: 'POST',
        body: JSON.stringify({ exact: true }),
      });
      return data.result?.count || 0;
    } catch {
      return 0;
    }
  }
}

