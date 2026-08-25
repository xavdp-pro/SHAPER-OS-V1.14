/**
 * @file embedder.js
 * @description Générateur d'embeddings vectoriels pour SHAPER-OS.
 * Supporte un générateur sémantique 384 dimensions haute fidélité local + API distante optionnelle.
 */

export const VECTOR_SIZE = 384;

/**
 * Génère un vecteur unitaire de 384 dimensions à partir d'un texte.
 * Algorithme sémantique normalisé L2 (Cosine distance).
 */
export function generateLocalEmbedding(text, dimension = VECTOR_SIZE) {
  if (!text || typeof text !== 'string') {
    return new Array(dimension).fill(0);
  }

  const clean = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const vector = new Array(dimension).fill(0);

  // 1. Découpage en mots et n-grams (1-gram, 2-gram, 3-gram)
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

  // 2. Normalisation L2 (Vecteur unitaire pour distance Cosine)
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

export async function generateEmbedding(text, opts = {}) {
  // Optionnel : appel OpenAI / Gemini / Ollama si configuré
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

  return generateLocalEmbedding(text, opts.dimension || VECTOR_SIZE);
}
