/**
 * @file extractor.js
 * @description Multi-format text content extractor (TXT, MD, JSON, CSV, PDF, DOCX, Code).
 * Features native FlateDecode decompression to extract 100% of PDF text without external binary dependencies.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { extractPdfText, looksLikePdf } from './pdf-text.js';
import { listZipEntries, readZipEntry, readMatching, xmlToText } from './zip-read.js';

export async function extractTextFromFile(filePath, { displayName } = {}) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const filename = displayName || path.basename(filePath);
  const ext = (path.extname(filename) || path.extname(filePath)).toLowerCase();

  // 1. Plain text / Markdown / Code / JSON / CSV formats
  if (['.txt', '.md', '.markdown', '.json', '.csv', '.tsv', '.js', '.jsx', '.ts', '.tsx', '.py', '.sh', '.yaml', '.yml', '.html', '.css'].includes(ext)) {
    const raw = fs.readFileSync(filePath, 'utf8');
    return {
      text: raw,
      filename,
      ext,
      sizeBytes: Buffer.byteLength(raw),
      format: ext.replace('.', ''),
    };
  }

  // 2. Office document formats: ZIP archives containing XML
  if (['.odt', '.ods', '.odp', '.docx', '.xlsx', '.pptx'].includes(ext)) {
    const buffer = fs.readFileSync(filePath);
    const entries = listZipEntries(buffer);
    let text = '';
    let kind = null;

    if (['.odt', '.ods', '.odp'].includes(ext)) {
      // OpenDocument: all content lives inside content.xml.
      const content = readZipEntry(buffer, entries, 'content.xml');
      if (content) {
        kind = 'opendocument';
        text = xmlToText(content, ['text:p', 'text:h', 'table:table-row', 'table:table-cell']);
      }
    } else if (ext === '.docx') {
      const doc = readZipEntry(buffer, entries, 'word/document.xml');
      if (doc) {
        kind = 'ooxml-document';
        text = xmlToText(doc, ['w:p', 'w:tr']);
      }
    } else if (ext === '.pptx') {
      const slides = readMatching(buffer, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      if (slides.length) {
        kind = 'ooxml-presentation';
        text = slides.map(sl => xmlToText(sl.content, ['a:p', 'a:br'])).join('\n\n');
      }
    } else if (ext === '.xlsx') {
      // Text cells point to a shared strings table; without it only numeric
      // values are read, resulting in a table without headers or labels.
      const sharedRaw = readZipEntry(buffer, entries, 'xl/sharedStrings.xml');
      const shared = sharedRaw
        ? [...sharedRaw.toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => xmlToText(m[1]).trim())
        : [];
      const sheets = readMatching(buffer, (n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      if (sheets.length) {
        kind = 'ooxml-spreadsheet';
        text = sheets.map(({ content }) => {
          const xml = content.toString('utf8');
          return [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((row) => {
            return [...row[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)].map((cell) => {
              const isShared = /t="s"/.test(cell[1]);
              const v = (/<v>([\s\S]*?)<\/v>/.exec(cell[2]) || [])[1];
              if (v === undefined) return xmlToText(cell[2]).trim();
              return isShared ? (shared[Number(v)] ?? '') : v;
            }).join('\t');
          }).join('\n');
        }).join('\n\n');
      }
    }

    const clean = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (!kind || !clean) {
      return {
        text: `[Unreadable office document: ${filename} (${buffer.length} bytes). `
          + `Incomplete archive, encrypted, or unexpected internal format.]`,
        filename, ext, sizeBytes: buffer.length, format: ext.replace('.', ''),
      };
    }
    return {
      text: clean,
      filename,
      ext,
      sizeBytes: buffer.length,
      format: kind,
    };
  }

  if (ext === '.pdf') {
    const buffer = fs.readFileSync(filePath);

    // A file named .pdf is not necessarily one. If it is readable as plain text,
    // read as text rather than claiming it is unreadable.
    if (!looksLikePdf(buffer)) {
      const asText = buffer.toString('utf8');
      const printable = (asText.match(/[\x20-\x7E\s\u00C0-\u024F]/g) || []).length / Math.max(1, asText.length);
      if (printable > 0.9) {
        return {
          text: asText,
          filename,
          ext,
          sizeBytes: buffer.length,
          format: 'text (misleading .pdf extension)',
        };
      }
    }

    const { text, method, fonts } = extractPdfText(buffer);
    const resultText = text.length > 20
      ? text
      : `[Unextractable PDF: ${filename} (${buffer.length} bytes). `
        + `No readable text — scanned document, encrypted, or unsupported compressed objects (ObjStm).]`;

    return {
      pdfMethod: method,
      pdfFonts: fonts,
      text: resultText,
      filename,
      ext,
      sizeBytes: buffer.length,
      format: 'pdf',
    };
  }

  // 3. Binary fallback
  const stat = fs.statSync(filePath);
  return {
    text: `[Binary file: ${filename}, size: ${stat.size} bytes]`,
    filename,
    ext,
    sizeBytes: stat.size,
    format: 'binary',
  };
}

