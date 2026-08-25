/**
 * @file split.js
 * @description Stage 1: Document Intake & Page Splitting.
 * Splits incoming documents according to their nature:
 * - PDF: split into per-page images (150 DPI) AND per-page native text layers.
 * - Lone Image: enters directly as a 1-page document with image only.
 * - Text/Office: enters with native text content only.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.tiff', '.tif', '.bmp', '.webp', '.pnm']);
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.json', '.csv', '.tsv', '.js', '.ts', '.py', '.sh', '.yaml', '.yml', '.html', '.css']);

/**
 * Splits a document into individual pages.
 * @param {string} filePath - Absolute path to input document.
 * @param {object} [options] - Options including workDir.
 * @returns {Promise<{ documentType: string, pages: Array<{ pageNumber: number, imagePath: string|null, nativeText: string|null }>, cleanup: () => void }>}
 */
export async function splitDocument(filePath, options = {}) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const ext = path.extname(filePath).toLowerCase();
  const workDir = options.workDir || fs.mkdtempSync(path.join(os.tmpdir(), 'shaper-pipeline-'));
  const tempFiles = [];

  const cleanup = () => {
    try {
      if (fs.existsSync(workDir)) {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
    } catch {
      /* ignore cleanup error */
    }
  };

  // 1. PDF Document
  if (ext === '.pdf') {
    // Generate 150 DPI PNG page images using pdftoppm
    const prefix = path.join(workDir, 'page');
    try {
      execFileSync('pdftoppm', ['-png', '-r', '150', filePath, prefix], { stdio: 'pipe' });
    } catch (err) {
      cleanup();
      throw new Error(`Failed to render PDF pages with pdftoppm: ${err.message}`);
    }

    // List generated page images (sorted numerically)
    const files = fs.readdirSync(workDir)
      .filter(f => f.startsWith('page-') && f.endsWith('.png'))
      .sort((a, b) => {
        const numA = parseInt(a.replace(/[^0-9]/g, ''), 10) || 0;
        const numB = parseInt(b.replace(/[^0-9]/g, ''), 10) || 0;
        return numA - numB;
      });

    const pages = files.map((file, idx) => {
      const pageNum = idx + 1;
      const imagePath = path.join(workDir, file);
      tempFiles.push(imagePath);

      // Extract native text layer for this specific page if pdftotext is available
      let nativeText = null;
      try {
        const textOut = execFileSync('pdftotext', ['-f', String(pageNum), '-l', String(pageNum), filePath, '-'], {
          stdio: ['ignore', 'pipe', 'ignore'],
          encoding: 'utf8',
        });
        if (textOut && textOut.trim().length > 0) {
          nativeText = textOut.trim();
        }
      } catch {
        /* pdftotext error or not available */
      }

      return {
        pageNumber: pageNum,
        imagePath,
        nativeText,
      };
    });

    return {
      documentType: 'pdf',
      pageCount: pages.length,
      pages,
      cleanup,
    };
  }

  // 2. Standalone Image: enters at Step 2 directly as a one-page document
  if (IMAGE_EXTENSIONS.has(ext)) {
    return {
      documentType: 'image',
      pageCount: 1,
      pages: [{
        pageNumber: 1,
        imagePath: filePath,
        nativeText: null,
      }],
      cleanup: () => {},
    };
  }

  // 3. Plain Text File: enters at Step 4 with single witness
  if (TEXT_EXTENSIONS.has(ext)) {
    const raw = fs.readFileSync(filePath, 'utf8');
    return {
      documentType: 'text',
      pageCount: 1,
      pages: [{
        pageNumber: 1,
        imagePath: null,
        nativeText: raw,
      }],
      cleanup: () => {},
    };
  }

  // Unsupported/binary fallback
  return {
    documentType: 'binary',
    pageCount: 0,
    pages: [],
    cleanup: () => {},
  };
}
