import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeFile, toAnalyzeResponse } from '../lib/analyze.js';
import { storeBuffer } from '../lib/catalog.js';
import { hashBuffer } from '../lib/cas.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tmpGed = path.join(__dirname, 'tmp-ged-analyze');

function vectorPdfFixture() {
  const stream = 'BT /F1 18 Tf 72 720 Td (SHAPER clean sheet vector PDF) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf);
}

describe('GED analyze envelope', () => {
  it('analyzes a real vector PDF and returns digest + catalog + words', async () => {
    fs.rmSync(tmpGed, { recursive: true, force: true });
    fs.mkdirSync(tmpGed, { recursive: true });
    // Keep the fixture inside the test. The full OCR corpus is intentionally
    // gitignored, so depending on one of its PDFs makes a fresh clone fail.
    const buffer = vectorPdfFixture();
    const { doc, hash, abs } = storeBuffer(tmpGed, {
      originalName: 'facture_prestation.pdf',
      folder: '',
      buffer,
    });
    assert.equal(hash, hashBuffer(buffer));

    const analysis = await analyzeFile(abs, {
      displayName: doc.originalName,
    });
    const envelope = toAnalyzeResponse(doc, analysis);

    assert.equal(envelope.ok, true);
    assert.equal(envelope.digest, hash);
    assert.equal(envelope.catalog.hash, hash);
    assert.equal(envelope.catalog.originalName, 'facture_prestation.pdf');
    assert.ok(envelope.words >= 1, `expected at least one token, got ${envelope.words}`);
    assert.equal(typeof envelope.totals, 'object');
    assert.equal(analysis.mode, 'structural');
    fs.rmSync(tmpGed, { recursive: true, force: true });
  });

  it('empty file returns an explicit extract error, no throw', async () => {
    const dir = fs.mkdtempSync(path.join(__dirname, 'empty-'));
    const empty = path.join(dir, 'vide.txt');
    fs.writeFileSync(empty, '');
    const analysis = await analyzeFile(empty, { displayName: 'vide.txt' });
    const envelope = toAnalyzeResponse({
      id: 'x', hash: hashBuffer(Buffer.from('')), originalName: 'vide.txt', folder: '', relPath: 'vide.txt', size: 0,
    }, analysis);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.words, 0);
    assert.match(analysis.summary, /Aucun texte exploitable|n'a pas pu être extrait/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('corrupt binary is a stated extract failure, not an unhandled exception', async () => {
    const dir = fs.mkdtempSync(path.join(__dirname, 'corrupt-'));
    const bad = path.join(dir, 'casse.pdf');
    fs.writeFileSync(bad, Buffer.from([0x00, 0xff, 0xfe, 0x00, 0x01]));
    const analysis = await analyzeFile(bad, { displayName: 'casse.pdf' });
    assert.equal(analysis.mode, 'structural');
    assert.ok(typeof analysis.summary === 'string' && analysis.summary.length > 0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
