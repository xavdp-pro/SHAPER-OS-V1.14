/**
 * @file embedder.js
 * @description Vector embeddings generator for SHAPER-OS (Rule 22).
 * Supports:
 * 1. Local ONNX MiniLM model (384 dimensions) via @xenova/transformers if present.
 * 2. Remote Ollama Cloud / OpenAI embeddings API if keys are configured.
 * 3. Unit normalized L2 semantic vector generator (384 dimensions) locally and instantly.
 */

export const VECTOR_SIZE = 384;
export const ONNX_MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';

let transformerPipeline = null;

/**
 * Loads ONNX MiniLM pipeline asynchronously if available.
 */
export async function getTransformerPipeline() {
  if (transformerPipeline) return transformerPipeline;
  try {
    const { pipeline } = await import('@xenova/transformers');
    transformerPipeline = await pipeline('feature-extraction', ONNX_MODEL_NAME, {
      quantized: true,
    });
    return transformerPipeline;
  } catch {
    return null;
  }
}

/**
 * Computes Cosine similarity between two L2 normalized vectors.
 */
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
  }
  return dot;
}

/**
 * Generates a unit vector of 384 dimensions from text.
 * L2 normalized semantic algorithm (Cosine distance).
 */
export function generateLocalEmbedding(text, dimension = VECTOR_SIZE) {
  if (!text || typeof text !== 'string') {
    return new Array(dimension).fill(0);
  }

  const clean = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const vector = new Array(dimension).fill(0);

  // 1. Tokenization into words and n-grams (1-gram, 2-gram, 3-gram)
  const words = clean.split(/[^a-z0-9_]+/i).filter(Boolean);
  
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    
    // Hash unigram
    let h1 = 5381;
    for (let c = 0; c < word.length; c++) {
      h1 = ((h1 << 5) + h1) ^ word.charCodeAt(c);
    }
    const idx1 = Math.abs(h1) % dimension;
    vector[idx1] += 1.5;

    // Hash bigram
    if (i < words.length - 1) {
      const bigram = `${word}_${words[i + 1]}`;
      let h2 = 5381;
      for (let c = 0; c < bigram.length; c++) {
        h2 = ((h2 << 5) + h2) ^ bigram.charCodeAt(c);
      }
      const idx2 = Math.abs(h2) % dimension;
      vector[idx2] += 2.5;
    }

    // Hash trigram
    if (i < words.length - 2) {
      const trigram = `${word}_${words[i + 1]}_${words[i + 2]}`;
      let h3 = 5381;
      for (let c = 0; c < trigram.length; c++) {
        h3 = ((h3 << 5) + h3) ^ trigram.charCodeAt(c);
      }
      const idx3 = Math.abs(h3) % dimension;
      vector[idx3] += 3.0;
    }
  }

  // 2. L2 normalization (Unit vector for Cosine distance)
  let norm = 0;
  for (let i = 0; i < dimension; i++) {
    norm += vector[i] * vector[i];
  }
  norm = Math.sqrt(norm);

  if (norm > 0) {
    for (let i = 0; i < dimension; i++) {
      vector[i] = vector[i] / norm;
    }
  }

  return vector;
}

/**
 * Generates a high-fidelity embedding (Local ONNX MiniLM > Ollama Cloud > OpenAI > Local L2).
 */
export async function generateEmbedding(text, opts = {}) {
  // 1. If ONNX pipeline is available
  try {
    const pipe = await getTransformerPipeline();
    if (pipe) {
      const output = await pipe(text, { pooling: 'mean', normalize: true });
      return Array.from(output.data);
    }
  } catch {
    /* Fallback */
  }

  // 2. If Ollama Cloud key is configured
  const ollamaKey = opts.apiKey || process.env.OLLAMA_API_KEY || process.env.OLLAMA_CLOUD_API_KEY;
  if (ollamaKey && opts.provider === 'ollama') {
    try {
      const endpoint = (opts.endpoint || process.env.OLLAMA_CLOUD_BASE_URL || 'https://ollama.com/v1').replace(/\/$/, '');
      const res = await fetch(`${endpoint}/embeddings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ollamaKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: opts.model || 'all-minilm',
          prompt: text,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.embedding && Array.isArray(json.embedding)) {
          return json.embedding;
        }
      }
    } catch {
      /* Fallback to local */
    }
  }

  // 3. If OpenAI key is configured
  if (opts.apiKey && opts.provider === 'openai') {
    try {
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${opts.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: text,
          dimensions: VECTOR_SIZE,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        return json.data[0].embedding;
      }
    } catch {
      /* Fallback to local */
    }
  }

  // 4. Local unit L2 generator (Cosine Distance)
  return generateLocalEmbedding(text, opts.dimension || VECTOR_SIZE);
}

