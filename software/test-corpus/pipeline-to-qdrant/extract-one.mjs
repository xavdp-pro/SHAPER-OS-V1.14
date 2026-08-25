#!/usr/bin/env node
/**
 * Runs inside localhost/shaper-pipeline:latest. Reads one PDF, writes JSON on stdout.
 * Vision is skipped so this protocol stays an OCR + native + arbiter yardstick.
 */
import { extractTextFromFile } from '/app/index.js';

const filePath = process.argv[2];
if (!filePath) {
  process.stderr.write('usage: node extract-one.mjs <pdf>\n');
  process.exit(2);
}

const r = await extractTextFromFile(filePath, { skipVision: true });
process.stdout.write(JSON.stringify({
  filename: r.filename,
  text: r.text,
  witnesses: r.witnesses,
  pages: (r.pages || []).map((p) => ({
    pageNumber: p.pageNumber,
    witnesses: p.witnesses,
    missingWitnesses: p.missingWitnesses,
    confidence: p.confidence,
    status: p.status,
  })),
  processingTimeMs: r.processingTimeMs,
  pipelineVersion: r.pipelineVersion,
}));
