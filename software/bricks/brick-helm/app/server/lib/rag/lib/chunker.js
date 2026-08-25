/**
 * @file chunker.js
 * @description Découpeur sémantique de documents pour indexation vectorielle RAG.
 */

export function chunkText(text, options = {}) {
  const {
    maxChunkSize = 800, // Nombre max de caractères par chunk (~200 tokens)
    overlap = 150,      // Nombre de caractères partagés entre chunks consécutifs
    separator = '\n\n', // Séparateur principal (paragraphe)
  } = options;

  if (!text || typeof text !== 'string') return [];
  const raw = text.trim();
  if (!raw) return [];

  // Si le texte est déjà plus court que la taille max
  if (raw.length <= maxChunkSize) {
    return [{
      text: raw,
      chunkIndex: 0,
      charStart: 0,
      charEnd: raw.length,
    }];
  }

  const chunks = [];
  const paragraphs = raw.split(new RegExp(`(${separator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|\n|\. )`)).filter(Boolean);
  
  let currentChunk = '';
  let startIndex = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    if ((currentChunk + p).length > maxChunkSize && currentChunk.length > 0) {
      chunks.push({
        text: currentChunk.trim(),
        chunkIndex: chunks.length,
        charStart: startIndex,
        charEnd: startIndex + currentChunk.length,
      });

      // Gestion de l'overlap
      const overlapText = currentChunk.slice(-overlap);
      startIndex += (currentChunk.length - overlapText.length);
      currentChunk = overlapText + p;
    } else {
      currentChunk += p;
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push({
      text: currentChunk.trim(),
      chunkIndex: chunks.length,
      charStart: startIndex,
      charEnd: startIndex + currentChunk.length,
    });
  }

  return chunks;
}
