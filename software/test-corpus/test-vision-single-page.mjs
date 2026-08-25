#!/usr/bin/env node
/**
 * @file test-vision-single-page.mjs
 * Runs inside or outside localhost/shaper-pipeline:latest.
 * Tests single-page document extraction with vision witness enabled.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Levenshtein and accuracy metrics from measure.mjs
function normalizeText(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/\s+/g, ' ').trim();
}

function levenshteinDistance(s1, s2) {
  if (s1 === s2) return 0;
  if (s1.length === 0) return s2.length;
  if (s2.length === 0) return s1.length;
  let prevRow = new Array(s2.length + 1);
  let currRow = new Array(s2.length + 1);
  for (let j = 0; j <= s2.length; j++) prevRow[j] = j;
  for (let i = 0; i < s1.length; i++) {
    currRow[0] = i + 1;
    for (let j = 0; j < s2.length; j++) {
      const cost = s1[i] === s2[j] ? 0 : 1;
      currRow[j + 1] = Math.min(
        currRow[j] + 1,
        prevRow[j + 1] + 1,
        prevRow[j] + cost,
      );
    }
    const temp = prevRow;
    prevRow = currRow;
    currRow = temp;
  }
  return prevRow[s2.length];
}

function characterAccuracy(extracted, truth) {
  const normExtracted = normalizeText(extracted);
  const normTruth = normalizeText(truth);
  if (normTruth.length === 0) return normExtracted.length === 0 ? 100 : 0;
  const dist = levenshteinDistance(normExtracted, normTruth);
  const maxLen = Math.max(normExtracted.length, normTruth.length);
  return Math.max(0, ((maxLen - dist) / maxLen) * 100);
}

// Load extractor
let processDocument;
try {
  const mod = await import('/app/index.js');
  processDocument = mod.processDocument;
} catch {
  const mod = await import('../bricks/brick-pipeline/index.js');
  processDocument = mod.processDocument;
}

const relPdf = process.argv[2] || '00-sources/facture_prestation.pdf';
const pdfPath = path.isAbsolute(relPdf) ? relPdf : path.join(__dirname, relPdf);
const truthPath = pdfPath.replace(/\.pdf$/i, '.verite.txt');

if (!fs.existsSync(pdfPath)) {
  console.error(`PDF not found: ${pdfPath}`);
  process.exit(1);
}

console.log(`=== In-Container Document Pipeline Vision Test ===`);
console.log(`Target Document: ${pdfPath}`);

const result = await processDocument(pdfPath, {
  skipVision: false,
});

let truth = '';
if (fs.existsSync(truthPath)) {
  truth = fs.readFileSync(truthPath, 'utf8');
}

const accuracy = truth ? characterAccuracy(result.text, truth) : null;

console.log(`\nResults:`);
console.log(`  Page count:             ${result.pageCount}`);
console.log(`  Processing time:        ${result.processingTimeMs} ms`);
console.log(`  Witnesses observed:     ${result.witnesses.join(', ')}`);
if (result.pages?.[0]?.missingWitnesses?.length) {
  console.log(`  Missing witnesses:      ${JSON.stringify(result.pages[0].missingWitnesses)}`);
}
if (accuracy !== null) {
  console.log(`  Character Accuracy:     ${accuracy.toFixed(2)} %`);
}

console.log(`\nSample extracted text (first 250 chars):\n---`);
console.log(result.text.slice(0, 250));
console.log(`---\n`);

process.exit(0);
