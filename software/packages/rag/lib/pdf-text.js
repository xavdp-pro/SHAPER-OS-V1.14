/**
 * @file pdf-text.js
 * External-dependency-free PDF text extraction.
 *
 * Why this module exists: modern generators (LibreOffice, Word, most billing software)
 * encode text as subset font **glyph indices** — `<0102> Tj` — rather than literal strings
 * `(Text) Tj`. Reading raw bytes produces nothing.
 * The meaning lives inside the `ToUnicode` CMap table of EACH font: codes overlap
 * across fonts (all start at <01>), so the active font must be tracked in the content stream.
 *
 * Accepted limitations: no ObjStm support for full document tree traversal beyond objects,
 * no encrypted PDF support, no OCR on scanned PDFs. In those cases the function returns
 * empty text and the caller handles it explicitly — never fabricated text (Rule 0G).
 */
import zlib from 'node:zlib';
import crypto from 'node:crypto';

/** A PDF starts with %PDF-. Without this signature, it is not one. */
export function looksLikePdf(buffer) {
  return buffer.slice(0, 5).toString('latin1') === '%PDF-';
}

/** Decompresses a stream, or returns it as-is if not compressed. */
function inflate(raw) {
  try { return zlib.inflateSync(raw).toString('latin1'); }
  catch { return raw.toString('latin1'); }
}

/** Decompressed content of an object, if it carries a stream. */
function objectStream(body) {
  const m = /stream[\r\n]+([\s\S]*?)[\r\n]*endstream/.exec(body);
  return m ? inflate(Buffer.from(m[1], 'latin1')) : '';
}

/**
 * Top-level objects: `12 0 obj … endobj`, **plus** those living inside compressed
 * object streams (`/Type /ObjStm`). Without this second pass, fonts and ToUnicode
 * tables in modern PDFs are invisible, resulting in untranslated glyph indices.
 */
function indexObjects(raw) {
  const objects = new Map();
  for (const m of raw.matchAll(/(\d+)\s+\d+\s+obj([\s\S]*?)endobj/g)) {
    objects.set(Number(m[1]), m[2]);
  }

  // Second pass: unpack object streams.
  for (const body of [...objects.values()]) {
    if (!/\/Type\s*\/ObjStm/.test(body)) continue;
    const n = Number((/\/N\s+(\d+)/.exec(body) || [])[1] || 0);
    const first = Number((/\/First\s+(\d+)/.exec(body) || [])[1] || 0);
    if (!n || !first) continue;
    const content = objectStream(body);
    if (!content) continue;

    // Header: n pairs "number offset", then objects starting at /First.
    const header = content.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i += 1) {
      const num = header[i * 2];
      const off = header[i * 2 + 1];
      if (!Number.isFinite(num) || !Number.isFinite(off)) continue;
      const nextOff = Number.isFinite(header[(i + 1) * 2 + 1]) ? header[(i + 1) * 2 + 1] : null;
      const body2 = nextOff === null
        ? content.slice(first + off)
        : content.slice(first + off, first + nextOff);
      if (!objects.has(num)) objects.set(num, body2);
    }
  }
  return objects;
}

/**
 * Code -> character mapping table for a ToUnicode CMap.
 * Handles `beginbfchar` (single mappings) and `beginbfrange`
 * (ranges, both `<lo> <hi> <start>` and `[<a> <b> …]` forms).
 */
export function parseCMap(cmapText) {
  const map = new Map();

  /**
   * Code byte width, declared by the table itself:
   *   begincodespacerange <0000> <FFFF> endcodespacerange  → 2 bytes
   *   begincodespacerange <00> <FF>     endcodespacerange  → 1 byte
   * Guessing from keys is flawed: a 2-byte font starting at <0001> has only keys < 0xFF.
   */
  let bytes = 1;
  const csr = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(cmapText);
  if (csr) {
    const first = /<([0-9A-Fa-f]+)>/.exec(csr[1]);
    if (first) bytes = Math.max(1, Math.min(2, Math.ceil(first[1].length / 2)));
  }
  const toChars = (hex) => {
    const clean = hex.replace(/\s+/g, '');
    let out = '';
    for (let i = 0; i + 3 < clean.length + 1; i += 4) {
      const code = parseInt(clean.substr(i, 4), 16);
      if (Number.isFinite(code) && code !== 0) out += String.fromCharCode(code);
    }
    return out;
  };

  for (const block of cmapText.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(parseInt(pair[1], 16), toChars(pair[2]));
    }
  }

  for (const block of cmapText.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    // <lo> <hi> <start destination>
    for (const r of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const lo = parseInt(r[1], 16);
      const hi = parseInt(r[2], 16);
      const start = parseInt(r[3], 16);
      for (let c = lo; c <= hi && c - lo < 65536; c += 1) {
        map.set(c, String.fromCharCode(start + (c - lo)));
      }
    }
    // <lo> <hi> [ <c1> <c2> … ]
    for (const r of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g)) {
      const lo = parseInt(r[1], 16);
      const dests = [...r[3].matchAll(/<([0-9A-Fa-f]+)>/g)].map(d => toChars(d[1]));
      dests.forEach((ch, i) => map.set(lo + i, ch));
    }
  }
  map.codeBytes = bytes;
  return map;
}

/**
 * Maps each font name (`F1`, `TT2`…) to its ToUnicode table.
 * Resource dictionaries may live in object streams: search both raw file
 * and unpacked object bodies to resolve all fonts in modern PDFs.
 */
function buildFontMaps(raw, objects) {
  const searchSpace = raw + '\n' + [...objects.values()].join('\n');
  const nameToObj = new Map();
  for (const m of searchSpace.matchAll(/\/([A-Za-z][A-Za-z0-9]*)\s+(\d+)\s+0\s+R/g)) {
    const body = objects.get(Number(m[2])) || '';
    if (/\/Type\s*\/Font/.test(body)) nameToObj.set(m[1], Number(m[2]));
  }

  const fonts = new Map();
  for (const [name, objNum] of nameToObj) {
    const fontBody = objects.get(objNum) || '';
    const tu = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(fontBody);
    if (!tu) continue;
    const cmapText = objectStream(objects.get(Number(tu[1])) || '');
    if (cmapText) fonts.set(name, parseCMap(cmapText));
  }
  return fonts;
}

/** Decodes a literal PDF string `(…)` with escape sequences. */
function decodeLiteral(s) {
  return s
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
    .replace(/\\([()\\])/g, '$1');
}

/** Decodes a hex string via the active font's ToUnicode table. */
function decodeHex(hex, cmap) {
  const clean = hex.replace(/[^0-9A-Fa-f]/g, '');
  // Byte width comes from the table, not guesswork on keys.
  const declared = cmap?.codeBytes ?? null;
  const step = declared ? declared * 2 : (clean.length % 4 === 0 ? 4 : 2);
  let out = '';
  for (let i = 0; i + step <= clean.length; i += step) {
    const code = parseInt(clean.substr(i, step), 16);
    if (cmap && cmap.has(code)) out += cmap.get(code);
    else if (!cmap && code >= 32 && code < 0x3000) out += String.fromCharCode(code);
  }
  return out;
}

/**
 * Extracts text from a PDF buffer.
 * @param {Buffer} buffer
 * @returns {{text: string, method: 'tounicode'|'literal'|'none', fonts: number}}
 */
export function extractPdfText(buffer) {
  const raw = buffer.toString('latin1');
  const objects = indexObjects(raw);
  const fonts = buildFontMaps(raw, objects);

  const out = [];
  let usedCMap = false;
  let usedLiteral = false;

  const streamRe = /stream[\r\n]+([\s\S]*?)[\r\n]*endstream/g;
  // A PDF saved incrementally contains successive versions of streams.
  // Reading all of them duplicates text. Process each identical stream content once.
  const seenStreams = new Set();
  let sm;
  while ((sm = streamRe.exec(raw)) !== null) {
    const content = inflate(Buffer.from(sm[1], 'latin1'));
    if (!/(Tj|TJ)/.test(content)) continue;
    // Hash of complete stream content to avoid false deduplication collisions.
    const fingerprint = crypto.createHash('sha1').update(content).digest('hex');
    if (seenStreams.has(fingerprint)) continue;
    seenStreams.add(fingerprint);

    let cmap = null;
    // Single pass in sequence order: active font changes mid-stream.
    const opRe = /\/([A-Za-z][A-Za-z0-9]*)\s+[\d.]+\s+Tf|\((?:\\.|[^\\)])*\)\s*Tj|<[0-9A-Fa-f\s]*>\s*Tj|\[[\s\S]*?\]\s*TJ|\bT\*|\bTd|\bTD|\bET/g;
    let op;
    while ((op = opRe.exec(content)) !== null) {
      const tok = op[0];

      if (op[1]) { cmap = fonts.get(op[1]) || null; continue; }
      if (/^(T\*|Td|TD|ET)$/.test(tok)) { out.push('\n'); continue; }

      if (tok.startsWith('(')) {
        const lit = /\(((?:\\.|[^\\)])*)\)/.exec(tok);
        if (lit) { out.push(decodeLiteral(lit[1])); usedLiteral = true; }
        continue;
      }

      if (tok.startsWith('<')) {
        const hex = /<([0-9A-Fa-f\s]*)>/.exec(tok);
        if (hex) { out.push(decodeHex(hex[1], cmap)); if (cmap) usedCMap = true; }
        continue;
      }

      if (tok.startsWith('[')) {
        for (const piece of tok.matchAll(/<([0-9A-Fa-f\s]*)>|\(((?:\\.|[^\\)])*)\)/g)) {
          if (piece[1] !== undefined) { out.push(decodeHex(piece[1], cmap)); if (cmap) usedCMap = true; }
          else { out.push(decodeLiteral(piece[2])); usedLiteral = true; }
        }
        out.push(' ');
      }
    }
    out.push('\n');
  }

  const text = out.join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/g, '');

  return {
    text,
    method: usedCMap ? 'tounicode' : usedLiteral ? 'literal' : 'none',
    fonts: fonts.size,
  };
}

