import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { extractTextFromFile } from '../lib/extractor.js';
import { listZipEntries, readZipEntry, xmlToText } from '../lib/zip-read.js';

/**
 * Builds a minimal in-memory ZIP archive — deflated method — to
 * test the reader without checking binary files into the repository.
 */
function makeZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const raw = Buffer.from(content, 'utf8');
    const deflated = zlib.deflateRawSync(raw);
    const crc = zlib.crc32 ? zlib.crc32(raw) : crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);          // method: deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, deflated);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(deflated.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);

    offset += local.length + nameBuf.length + deflated.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuf, eocd]);
}

/** Minimal CRC32 for runtimes without zlib.crc32. */
function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}

const tmp = (name, buf) => {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ged-')), name);
  fs.writeFileSync(p, buf);
  return p;
};

test('ZIP reader — lists and reads deflated entry', () => {
  const zip = makeZip({ 'content.xml': '<t>bonjour</t>' });
  const entries = listZipEntries(zip);
  assert.ok(entries.has('content.xml'));
  assert.equal(readZipEntry(zip, entries, 'content.xml').toString(), '<t>bonjour</t>');
});

test('xmlToText — removes tags, decodes entities, breaks at paragraphs', () => {
  const out = xmlToText('<text:p>Total&#160;: 120&#8364;</text:p><text:p>Net &amp; payable</text:p>', ['text:p']);
  assert.match(out, /Total/);
  assert.match(out, /Net & payable/);
  assert.ok(out.includes('\n'), 'paragraphs must produce a newline');
});

test('ODT — content is extracted, never reported as binary', async () => {
  const zip = makeZip({
    mimetype: 'application/vnd.oasis.opendocument.text',
    'content.xml': '<office:body><text:p>FACTURE 2026-42</text:p><text:p>Net a payer 120,00</text:p></office:body>',
  });
  const r = await extractTextFromFile(tmp('facture.odt', zip));
  assert.equal(r.format, 'opendocument');
  assert.match(r.text, /FACTURE 2026-42/);
  assert.match(r.text, /120,00/);
  assert.doesNotMatch(r.text, /binary/i);
});

test('DOCX — document body is extracted', async () => {
  const zip = makeZip({
    'word/document.xml': '<w:body><w:p><w:r><w:t>Rapport annuel</w:t></w:r></w:p></w:body>',
  });
  const r = await extractTextFromFile(tmp('rapport.docx', zip));
  assert.equal(r.format, 'ooxml-document');
  assert.match(r.text, /Rapport annuel/);
});

test('XLSX — shared strings are resolved, not returned by index', async () => {
  const zip = makeZip({
    'xl/sharedStrings.xml': '<sst><si><t>Designation</t></si><si><t>Montant</t></si></sst>',
    'xl/worksheets/sheet1.xml':
      '<worksheet><sheetData>'
      + '<row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row>'
      + '<row><c t="s"><v>0</v></c><c><v>120</v></c></row>'
      + '</sheetData></worksheet>',
  });
  const r = await extractTextFromFile(tmp('compta.xlsx', zip));
  assert.equal(r.format, 'ooxml-spreadsheet');
  assert.match(r.text, /Designation/, 'shared string must be resolved');
  assert.match(r.text, /Montant/);
  assert.match(r.text, /120/);
  assert.doesNotMatch(r.text, /^0\t1$/m, 'indices must never appear in place of text');
});

test('ODS — spreadsheet rows are extracted with newlines, not glued together', async () => {
  const zip = makeZip({
    mimetype: 'application/vnd.oasis.opendocument.spreadsheet',
    'content.xml':
      '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">'
      + '<office:body><office:spreadsheet>'
      + '<table:table table:name="Feuille1">'
      + '<table:table-row>'
      + '<table:table-cell><text:p>Article</text:p></table:table-cell>'
      + '<table:table-cell><text:p>Prix unitaire</text:p></table:table-cell>'
      + '<table:table-cell><text:p>Quantite</text:p></table:table-cell>'
      + '</table:table-row>'
      + '<table:table-row>'
      + '<table:table-cell><text:p>Serveur 1U</text:p></table:table-cell>'
      + '<table:table-cell><text:p>1200,00</text:p></table:table-cell>'
      + '<table:table-cell><text:p>3</text:p></table:table-cell>'
      + '</table:table-row>'
      + '</table:table>'
      + '</office:spreadsheet></office:body>'
      + '</office:document-content>',
  });
  const r = await extractTextFromFile(tmp('inventaire.ods', zip));
  assert.equal(r.format, 'opendocument');
  assert.match(r.text, /Article/);
  assert.match(r.text, /Prix unitaire/);
  assert.match(r.text, /Serveur 1U/);
  assert.match(r.text, /1200,00/);
  assert.doesNotMatch(r.text, /binary/i);
  assert.doesNotMatch(r.text, /ArticlePrix/);
  assert.doesNotMatch(r.text, /Serveur 1U1200/);
  assert.ok(r.text.includes('\n'), 'spreadsheet rows must produce newlines');
});

test('PPTX — slides are extracted in numerical order (slide1 before slide2 before slide10)', async () => {
  const zip = makeZip({
    'ppt/slides/slide10.xml':
      '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
      + '<p:cSld><p:spTree><p:sp><p:txBody>'
      + '<a:p><a:r><a:t>Slide 10 : Conclusion et perspectives</a:t></a:r></a:p>'
      + '</p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
    'ppt/slides/slide1.xml':
      '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
      + '<p:cSld><p:spTree><p:sp><p:txBody>'
      + '<a:p><a:r><a:t>Slide 1 : Titre de la presentation</a:t></a:r></a:p>'
      + '<a:p><a:r><a:t>Auteur : Equipe SHAPER</a:t></a:r></a:p>'
      + '</p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
    'ppt/slides/slide2.xml':
      '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
      + '<p:cSld><p:spTree><p:sp><p:txBody>'
      + '<a:p><a:r><a:t>Slide 2 : Architecture systeme</a:t></a:r></a:p>'
      + '</p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
  });
  const r = await extractTextFromFile(tmp('presentation.pptx', zip));
  assert.equal(r.format, 'ooxml-presentation');
  assert.match(r.text, /Slide 1 : Titre de la presentation/);
  assert.match(r.text, /Slide 2 : Architecture systeme/);
  assert.match(r.text, /Slide 10 : Conclusion et perspectives/);
  assert.doesNotMatch(r.text, /binary/i);

  const idx1 = r.text.indexOf('Slide 1 :');
  const idx2 = r.text.indexOf('Slide 2 :');
  const idx10 = r.text.indexOf('Slide 10 :');
  assert.ok(idx1 !== -1 && idx2 !== -1 && idx10 !== -1, 'All slides must be present');
  assert.ok(idx1 < idx2, 'Slide 1 must appear before Slide 2');
  assert.ok(idx2 < idx10, 'Slide 2 must appear before Slide 10 (numerical sort)');
});

test('unreadable office archive — explicit refusal, no text fabricated', async () => {
  const r = await extractTextFromFile(tmp('casse.docx', Buffer.from('ceci n est pas un zip')));
  assert.match(r.text, /Unreadable/i);
  assert.doesNotMatch(r.text, /Rapport|Facture/);

  const rOds = await extractTextFromFile(tmp('casse.ods', Buffer.from('ceci n est pas un zip ods')));
  assert.match(rOds.text, /Unreadable/i);
  assert.doesNotMatch(rOds.text, /Article|Prix|Tableur/);

  const rPptx = await extractTextFromFile(tmp('casse.pptx', Buffer.from('ceci n est pas un zip pptx')));
  assert.match(rPptx.text, /Unreadable/i);
  assert.doesNotMatch(rPptx.text, /Slide|Presentation/);

  const rEmptyPptx = await extractTextFromFile(tmp('vide.pptx', makeZip({ 'ppt/presentation.xml': '<p:presentation/>' })));
  assert.match(rEmptyPptx.text, /Unreadable/i);
});

