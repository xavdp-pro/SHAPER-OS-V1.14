/**
 * @file pipeline.test.js
 * @description Unit and contract tests for the Document Pipeline brick.
 * Conforms to Rule 5 (Native test runner: node --test) and Rule 29 (Regression tests).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

import {
  processDocument,
  splitDocument,
  detectOrientation,
  correctGeometry,
  measureLegibility,
  arbitratePage,
  extractTextFromFile,
  PIPELINE_VERSION,
} from '../index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CORPUS_DIR = path.resolve(__dirname, '../../../test-corpus');

describe('Document Pipeline — Brick Unit Tests', () => {

  test('PIPELINE_VERSION is semver 1.0.0', () => {
    assert.equal(PIPELINE_VERSION, '1.0.0');
  });

  test('splitDocument: handles plain text files directly (Step 4)', async () => {
    const tmpFile = path.join(__dirname, 'sample.txt');
    fs.writeFileSync(tmpFile, 'Hello SHAPER OS Pipeline', 'utf8');

    try {
      const split = await splitDocument(tmpFile);
      assert.equal(split.documentType, 'text');
      assert.equal(split.pageCount, 1);
      assert.equal(split.pages[0].nativeText, 'Hello SHAPER OS Pipeline');
      assert.equal(split.pages[0].imagePath, null);
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });

  test('arbitratePage: prefers clean native text with 100% confidence for vector documents', () => {
    const result = arbitratePage({
      nativeText: 'Société Générale Facture de prestation N° 12345',
      ocrText: 'Societe Generale Facture de prestation N 12345',
      legibility: { score: 0.95, contrast: 0.4, sharpness: 0.2, isDoubtful: false },
      appliedRotation: 0,
      deskewed: false,
    });

    assert.equal(result.confidence, 1.0);
    assert.deepEqual(result.witnesses, ['native', 'ocr']);
    assert.equal(result.text, 'Société Générale Facture de prestation N° 12345');
    assert.equal(result.status, 'exact');
  });

  test('arbitratePage: uses OCR witness when native text is absent (pure scan)', () => {
    const result = arbitratePage({
      nativeText: null,
      ocrText: 'Facture scannée montant 450 EUR',
      legibility: { score: 0.90, contrast: 0.35, sharpness: 0.15, isDoubtful: false },
      appliedRotation: 0,
      deskewed: true,
    });

    assert.ok(result.confidence > 0.80);
    assert.deepEqual(result.witnesses, ['ocr']);
    assert.equal(result.text, 'Facture scannée montant 450 EUR');
    assert.equal(result.status, 'ocr');
  });

  test('arbitratePage: filters out binary noise and uses OCR witness (Rule 0G)', () => {
    const binaryNoise = '\x00\x01\x02\xFF\xFE' + 'random noise data '.repeat(3000);
    const result = arbitratePage({
      nativeText: binaryNoise,
      ocrText: 'Bon de commande N° 789',
      legibility: { score: 0.88, contrast: 0.3, sharpness: 0.12, isDoubtful: false },
      appliedRotation: 0,
      deskewed: false,
    });

    assert.deepEqual(result.witnesses, ['ocr']);
    assert.equal(result.text, 'Bon de commande N° 789');
    assert.equal(result.status, 'ocr');
  });

  test('arbitratePage: returns unusable on empty native and empty OCR without inventing text (Rule 0G)', () => {
    const result = arbitratePage({
      nativeText: '',
      ocrText: '',
      legibility: { score: 0.10, contrast: 0.02, sharpness: 0.01, isDoubtful: true },
      appliedRotation: 0,
      deskewed: false,
    });

    assert.equal(result.confidence, 0.0);
    assert.deepEqual(result.witnesses, []);
    assert.equal(result.text, '');
    assert.equal(result.status, 'unusable');
  });

  test('measureLegibility: returns valid metrics object for null/missing image', () => {
    const leg = measureLegibility('/nonexistent/image.png');
    assert.equal(typeof leg.score, 'number');
    assert.equal(typeof leg.contrast, 'number');
    assert.equal(typeof leg.sharpness, 'number');
    assert.equal(typeof leg.isDoubtful, 'boolean');
  });

  test('extractTextFromFile adapter: extracts text and returns standard metadata', async () => {
    const tmpFile = path.join(__dirname, 'contract.txt');
    fs.writeFileSync(tmpFile, 'Contrat de prestation de services informatiques SHAPER-OS.', 'utf8');

    try {
      const res = await extractTextFromFile(tmpFile);
      assert.equal(res.filename, 'contract.txt');
      assert.equal(res.format, 'text');
      assert.ok(res.text.includes('Contrat de prestation'));
      assert.equal(res.pipelineVersion, '1.0.0');
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });

});
