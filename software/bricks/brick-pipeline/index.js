/**
 * @file index.js
 * @package @shaper/brick-pipeline
 * @description Document Understanding Pipeline with OCR, Geometry & Legibility.
 */

import { processDocument, PIPELINE_VERSION } from './lib/pipeline.js';

export { processDocument, PIPELINE_VERSION };
export { splitDocument } from './lib/split.js';
export { correctGeometry, detectOrientation } from './lib/geometry.js';
export { measureLegibility } from './lib/legibility.js';
export { runOcr } from './lib/ocr.js';
export { runVision, visionConfig, buildVisionCommand, extractVisionStdout } from './lib/vision.js';
export { arbitratePage } from './lib/arbitrate.js';

/**
 * Standard extraction adapter compatible with SHAPER extractTextFromFile contract.
 * @param {string} filePath - Absolute path to document file.
 * @param {object} [options] - Extraction options.
 * @returns {Promise<{ text: string, filename: string, ext: string, sizeBytes: number, format: string, witnesses: string[], pages: Array<object> }>}
 */
export async function extractTextFromFile(filePath, options = {}) {
  const result = await processDocument(filePath, options);
  return {
    text: result.text,
    filename: result.filename,
    ext: result.ext,
    sizeBytes: result.sizeBytes,
    format: result.format,
    witnesses: result.witnesses,
    pages: result.pages,
    pipelineVersion: result.pipelineVersion,
    processingTimeMs: result.processingTimeMs,
  };
}
