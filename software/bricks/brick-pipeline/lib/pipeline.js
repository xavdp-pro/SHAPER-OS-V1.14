/**
 * @file pipeline.js
 * @description Main Document Understanding Pipeline orchestrator.
 * Implements the canonical processing order (Doctrine §3):
 * 1. Split into pages (image + native text)
 * 2. Geometry correction (rotation + deskew)
 * 3. Legibility measurement
 * 4. Reading (native text + OCR)
 * 5. Arbitration & reconciliation
 */

import fs from 'node:fs';
import path from 'node:path';
import { splitDocument } from './split.js';
import { correctGeometry } from './geometry.js';
import { measureLegibility } from './legibility.js';
import { runOcr } from './ocr.js';
import { runVision } from './vision.js';
import { arbitratePage } from './arbitrate.js';

export const PIPELINE_VERSION = '1.0.0';

/**
 * Processes any document through the document pipeline.
 * @param {string} filePath - Path to document.
 * @param {object} [options] - Options (source, depositor, expectedType, languages).
 * @returns {Promise<object>}
 */
export async function processDocument(filePath, options = {}) {
  const startTime = Date.now();
  if (!fs.existsSync(filePath)) {
    throw new Error(`Document file not found: ${filePath}`);
  }

  const filename = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const stat = fs.statSync(filePath);

  // Step 0 & 1: Intake & Page Splitting
  const { documentType, pageCount, pages: splitPages, cleanup } = await splitDocument(filePath, options);

  try {
    const processedPages = [];
    const fullTextParts = [];
    const allWitnesses = new Set();

    for (const page of splitPages) {
      let imagePath = page.imagePath;
      let appliedRotation = 0;
      let deskewed = false;
      let orientationConfidence = 0;
      let legibility = { score: 1.0, contrast: 1.0, sharpness: 1.0, isDoubtful: false };
      let ocrResult = { text: '', engine: 'none', languages: [] };
      let visionResult = {
        text: '',
        available: false,
        missingReason: null,
      };
      let visionAttempted = false;

      // Step 2: Orientation & Deskew (for image-bearing pages)
      if (imagePath) {
        const geom = await correctGeometry(imagePath);
        imagePath = geom.imagePath;
        appliedRotation = geom.appliedRotation;
        deskewed = geom.deskewed;
        orientationConfidence = geom.orientationConfidence;

        // Step 3: Legibility Measurement
        legibility = measureLegibility(imagePath);

        // Step 4: triple reading — native (already on the page) + OCR + vision CLI
        ocrResult = runOcr(imagePath, { languages: options.languages || 'fra+eng' });
        if (!options.skipVision) {
          visionAttempted = true;
          visionResult = await runVision(imagePath, options.vision || {});
        }
      }

      // Step 5: Arbitration among the witnesses that actually answered
      const arbitration = arbitratePage({
        nativeText: page.nativeText,
        ocrText: ocrResult.text,
        visionText: visionResult.text,
        visionAttempted,
        visionAvailable: visionResult.available,
        visionMissingReason: visionResult.missingReason,
        legibility,
        appliedRotation,
        deskewed,
      });

      arbitration.witnesses.forEach(w => allWitnesses.add(w));

      if (arbitration.text) {
        fullTextParts.push(arbitration.text);
      }

      processedPages.push({
        pageNumber: page.pageNumber,
        appliedRotation,
        deskewed,
        orientationConfidence,
        legibilityScore: legibility.score,
        isDoubtful: legibility.isDoubtful,
        witnesses: arbitration.witnesses,
        missingWitnesses: arbitration.missingWitnesses,
        disagreements: arbitration.disagreements,
        confidence: arbitration.confidence,
        text: arbitration.text,
        status: arbitration.status,
      });
    }

    const combinedText = fullTextParts.join('\n\n').trim();
    const resultText = combinedText.length > 0
      ? combinedText
      : `[Unextractable document: ${filename} (${stat.size} bytes). Quality too degraded or unsupported format.]`;

    const processingTimeMs = Date.now() - startTime;

    return {
      filename,
      ext,
      sizeBytes: stat.size,
      format: documentType,
      pageCount: processedPages.length,
      pipelineVersion: PIPELINE_VERSION,
      processingTimeMs,
      text: resultText,
      witnesses: Array.from(allWitnesses),
      pages: processedPages,
      source: options.source || 'upload',
      depositor: options.depositor || 'system',
    };
  } finally {
    cleanup();
  }
}
