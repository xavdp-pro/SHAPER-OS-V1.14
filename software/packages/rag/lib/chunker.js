/**
 * @file chunker.js
 * @description Semantic document chunker for RAG vector indexing.
 */

export function chunkText(text, options = {}) {
  const {
    maxChunkSize = 800, // Max character count per chunk (~200 tokens)
    overlap = 150,      // Number of shared characters between consecutive chunks
    separator = '\n\n', // Primary separator (paragraph)
  } = options;

  if (!text || typeof text !== 'string') return [];
  const raw = text.trim();
  if (!raw) return [];

  // If text is already shorter than max size
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

      // Handle overlap
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
