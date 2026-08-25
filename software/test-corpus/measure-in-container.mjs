#!/usr/bin/env node
/**
 * Runs the corpus benchmark inside the pipeline container where Tesseract,
 * poppler and geometry correction are available. Invoked by measure.mjs on the
 * host — do not call this directly unless you are already inside the container.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractTextFromFile } from '/app/index.js';
import { runBenchmark } from './measure.mjs';

const corpusRoot = path.dirname(fileURLToPath(import.meta.url));

await runBenchmark({
  corpusRoot,
  extractFn: (pdfPath) => extractTextFromFile(pdfPath, { skipVision: true }),
  extractorLabel: '`brick-pipeline` in `localhost/shaper-pipeline:latest` (OCR + geometry + native text)',
});
