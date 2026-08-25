/**
 * @file zip-read.js
 * Minimal ZIP reader, dependency-free — `zlib` is enough.
 *
 * Why: ODT, DOCX and XLSX are ZIP archives containing XML. Without a reader,
 * these formats fell into the "binary file" branch even though they are perfectly
 * readable. Adding a library for this would contradict the zero external
 * dependencies invariant of the brick.
 *
 * We only handle what is needed: stored entries (method 0) and deflated entries
 * (method 8), which cover all real-world office files.
 */
import zlib from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;

/** Finds the end of central directory record, including trailing comment. */
function findEndOfCentralDirectory(buf) {
  const min = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/**
 * Lists entries in the archive.
 * @returns {Map<string, {offset:number, method:number, compressedSize:number, size:number}>}
 */
export function listZipEntries(buf) {
  const entries = new Map();
  const eocd = findEndOfCentralDirectory(buf);
  if (eocd < 0) return entries;

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < count && p + 46 <= buf.length; i += 1) {
    if (buf.readUInt32LE(p) !== CEN_SIG) break;
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, { offset: localOffset, method, compressedSize, size });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Content of an entry, or null if missing or unsupported compression. */
export function readZipEntry(buf, entries, name) {
  const e = entries.get(name);
  if (!e) return null;
  // The local header repeats name and extra lengths, which may differ from
  // central directory: read from the local header.
  const lo = e.offset;
  if (buf.readUInt32LE(lo) !== 0x04034b50) return null;
  const nameLen = buf.readUInt16LE(lo + 26);
  const extraLen = buf.readUInt16LE(lo + 28);
  const start = lo + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + e.compressedSize);
  try {
    if (e.method === 0) return raw;
    if (e.method === 8) return zlib.inflateRawSync(raw);
  } catch { /* corrupted entry */ }
  return null;
}

/** All entries whose name matches the predicate. */
export function readMatching(buf, predicate) {
  const entries = listZipEntries(buf);
  const out = [];
  for (const name of entries.keys()) {
    if (predicate(name)) {
      const content = readZipEntry(buf, entries, name);
      if (content) out.push({ name, content });
    }
  }
  return out;
}

/** Extracts text from an XML fragment: strips tags and decodes entities. */
export function xmlToText(xml, blockTags = []) {
  let s = xml.toString('utf8');
  // Paragraph and line ends become newlines.
  for (const tag of blockTags) {
    s = s.replace(new RegExp(`</${tag}>`, 'g'), '\n');
    s = s.replace(new RegExp(`<${tag}[^>]*/>`, 'g'), '\n');
  }
  s = s.replace(/<[^>]+>/g, '');
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
}

