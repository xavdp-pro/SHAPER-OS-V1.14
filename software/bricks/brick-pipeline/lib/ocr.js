/**
 * @file ocr.js
 * @description Stage 4: OCR Reading Witness.
 * Executes Tesseract OCR with French and English language data.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * Runs OCR on a single straightened page image.
 * @param {string} imagePath - Path to the straightened image.
 * @param {object} [options] - Options including languages and psm.
 * @returns {{ text: string, engine: string, languages: string[], rawLength: number }}
 */
export function runOcr(imagePath, options = {}) {
  if (!imagePath || !fs.existsSync(imagePath)) {
    return {
      text: '',
      engine: 'tesseract-5.3.0',
      languages: ['fra', 'eng'],
      rawLength: 0,
    };
  }

  const languages = options.languages || 'fra+eng';
  const psm = options.psm ? String(options.psm) : '3';
  const outDir = path.dirname(imagePath);
  const outBase = path.join(outDir, `ocr_${path.basename(imagePath, path.extname(imagePath))}`);
  const outTxt = `${outBase}.txt`;

  try {
    execFileSync('tesseract', [imagePath, outBase, '-l', languages, '--psm', psm], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });

    if (fs.existsSync(outTxt)) {
      const raw = fs.readFileSync(outTxt, 'utf8');
      try { fs.unlinkSync(outTxt); } catch { /* ignore */ }

      // Normalise formatting: trim trailing spaces per line, limit consecutive newlines
      const cleaned = raw
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      return {
        text: cleaned,
        engine: 'tesseract-5.3.0',
        languages: languages.split('+'),
        rawLength: cleaned.length,
      };
    }
  } catch (err) {
    /* tesseract error */
  }

  return {
    text: '',
    engine: 'tesseract-5.3.0',
    languages: languages.split('+'),
    rawLength: 0,
  };
}
