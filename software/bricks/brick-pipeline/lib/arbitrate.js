/**
 * @file arbitrate.js
 * @description Stage 5: Arbitration and Witness Reconciliation.
 * Enforces Invariants 3 & 7: Three witnesses on the same page, arbitration produces the final result,
 * every field carries provenance and confidence.
 */

/**
 * Detects if a text string looks like corrupted binary stream garbage
 * (e.g. uncompressed binary image stream chunks erroneously matching Tj syntax).
 */
function isBinaryNoise(text) {
  if (!text || text.length === 0) return false;
  if (text.length > 30000 && !/\b(le|la|de|du|des|et|en|un|une|dans|pour|par|sur|est|sont|the|and|in|of|to|is)\b/i.test(text.slice(0, 1000))) {
    return true;
  }
  // Check ratio of printable ascii / latin1 characters
  const printable = (text.match(/[\x20-\x7E\s\u00C0-\u024F]/g) || []).length;
  const ratio = printable / text.length;
  return ratio < 0.70;
}

/**
 * Checks if text is an unextractable fallback marker.
 */
function isFallbackText(text) {
  if (!text) return true;
  return text.startsWith('[Unextractable PDF:') ||
         text.startsWith('[PDF non extractible:') ||
         text.startsWith('[Unreadable office document:') ||
         text.startsWith('[Binary file:');
}

/**
 * Token overlap in [0, 1]. Used only to flag disagreement, never to invent text.
 */
export function tokenOverlap(a, b) {
  const tokens = (text) => new Set(
    String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .match(/[a-z0-9]+/g) || [],
  );
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let n = 0;
  for (const t of A) {
    if (B.has(t)) n += 1;
  }
  return n / Math.max(A.size, B.size);
}

/**
 * Arbitrates between native, OCR and vision witnesses for a single page.
 * The arbiter chooses among witness readings. A witness never delivers the result alone
 * when another valid reading exists.
 *
 * @param {object} params
 * @param {string|null} params.nativeText
 * @param {string|null} params.ocrText
 * @param {string|null} [params.visionText]
 * @param {boolean} [params.visionAttempted] - true when an image was sent to document-vision
 * @param {boolean} [params.visionAvailable]
 * @param {string|null} [params.visionMissingReason]
 * @param {object} params.legibility
 * @param {number} params.appliedRotation
 * @param {boolean} params.deskewed
 * @returns {{ text: string, confidence: number, witnesses: string[], missingWitnesses: string[], disagreements: string[], status: string }}
 */
export function arbitratePage({
  nativeText,
  ocrText,
  visionText = '',
  visionAttempted = false,
  visionAvailable = false,
  visionMissingReason = null,
  legibility,
  appliedRotation,
  deskewed,
}) {
  const hasValidNative = nativeText && !isFallbackText(nativeText) && !isBinaryNoise(nativeText) && nativeText.trim().length > 20;
  const hasValidOcr = ocrText && ocrText.trim().length > 0;
  const hasValidVision = Boolean(visionAvailable && visionText && visionText.trim().length > 0);

  const witnesses = [];
  const missingWitnesses = [];
  const disagreements = [];

  if (visionAttempted && !hasValidVision) {
    missingWitnesses.push('vision');
    if (visionMissingReason) {
      disagreements.push(`vision missing: ${visionMissingReason}`);
    }
  }

  if (hasValidNative) witnesses.push('native');
  if (hasValidOcr) witnesses.push('ocr');
  if (hasValidVision) witnesses.push('vision');

  const overlapOcrVision = (hasValidOcr && hasValidVision)
    ? tokenOverlap(ocrText, visionText)
    : null;
  if (overlapOcrVision !== null && overlapOcrVision < 0.5) {
    disagreements.push(
      `ocr/vision token overlap ${overlapOcrVision.toFixed(2)} — readings diverge`,
    );
  }

  // Case 1: clean native layer — still record the other witnesses, native remains the reading
  if (hasValidNative) {
    return {
      text: nativeText.trim(),
      confidence: missingWitnesses.length ? 0.95 : 1.0,
      witnesses,
      missingWitnesses,
      disagreements,
      status: 'exact',
    };
  }

  // Case 2: OCR present — vision may corroborate or disagree; OCR stays the mechanical reading
  if (hasValidOcr) {
    const legScore = legibility?.score ?? 0.8;
    let confidence = Math.min(0.98, Math.max(0.20, legScore * 0.95));
    if (hasValidVision && overlapOcrVision !== null && overlapOcrVision >= 0.5) {
      confidence = Math.min(0.98, confidence + 0.03);
    }
    if (disagreements.some((d) => d.startsWith('ocr/vision'))) {
      confidence = Math.max(0.20, confidence - 0.15);
    }
    if (missingWitnesses.includes('vision')) {
      confidence = Math.max(0.20, confidence - 0.05);
    }

    return {
      text: ocrText.trim(),
      confidence: parseFloat(confidence.toFixed(2)),
      witnesses,
      missingWitnesses,
      disagreements,
      status: legibility?.isDoubtful ? 'doubtful_ocr' : 'ocr',
    };
  }

  // Case 3: vision is the only remaining reading — the arbiter selects it, vision does not self-certify
  if (hasValidVision) {
    const legScore = legibility?.score ?? 0.8;
    const confidence = parseFloat(Math.min(0.90, Math.max(0.20, legScore * 0.85)).toFixed(2));
    return {
      text: visionText.trim(),
      confidence,
      witnesses,
      missingWitnesses,
      disagreements,
      status: 'vision',
    };
  }

  return {
    text: '',
    confidence: 0.0,
    witnesses,
    missingWitnesses,
    disagreements: disagreements.length
      ? disagreements
      : ['No text extracted from native layer, OCR engine, or vision witness'],
    status: 'unusable',
  };
}
