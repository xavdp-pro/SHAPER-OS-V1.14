#!/usr/bin/env node
/**
 * Level 1 — CLI. No HTTP, no container: calls the shared pipeline directly.
 * This is the fastest feedback loop for diagnosing document extraction.
 *
 *   node scripts/test-pipeline-cli.mjs <file|directory> [--json] [--ref]
 *
 *   --ref   compares against pdftotext when available (independent baseline)
 *   --json  machine-readable JSON output, for batch aggregation
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { analyzeFile } = await import(path.join(HERE, '../packages/ged-engine/lib/analyze.js'));
// analyzeFile only returns a preview truncated to 1200 characters: comparing
// identifiers against that generates false missing-token warnings.
// Comparison is performed on the FULL text via the extractor.
const { extractTextFromFile } = await import(path.join(HERE, '../packages/rag/lib/extractor.js'));

const args = process.argv.slice(2);
const target = args.find(a => !a.startsWith('--'));
const asJson = args.includes('--json');
const withRef = args.includes('--ref');
if (!target) {
  console.error('usage: test-pipeline-cli.mjs <file|directory> [--json] [--ref]');
  process.exit(2);
}

function referenceText(file) {
  if (path.extname(file).toLowerCase() !== '.pdf') return null;
  try {
    return execFileSync('pdftotext', ['-q', file, '-'], { encoding: 'utf8', timeout: 30000 });
  } catch { return null; }
}

/** What really matters: numbers, dates, and identifiers, not length. */
function significantTokens(text) {
  return new Set((text.match(/\d[\d.,/-]{2,}|\b[A-Z]{2,}\d{3,}[A-Z0-9-]*/g) || [])
    .map(t => t.replace(/[.,]$/, '')));
}

function listFiles(t) {
  const st = fs.statSync(t);
  if (st.isFile()) return [t];
  return fs.readdirSync(t, { withFileTypes: true })
    .filter(e => e.isFile() && !e.name.startsWith('.'))
    .map(e => path.join(t, e.name));
}

const rows = [];
for (const file of listFiles(target)) {
  const t0 = Date.now();
  let a = null; let error = null;
  try { a = await analyzeFile(file); } catch (err) { error = err.message; }
  const ms = Date.now() - t0;

  let fullText = '';
  try { fullText = (await extractTextFromFile(file))?.text ?? ''; } catch { /* already reported */ }
  const text = fullText || (a?.textPreview ?? '');
  const row = {
    file: path.basename(file),
    ms,
    mode: a?.mode ?? null,
    format: a?.structure?.format ?? null,
    words: a?.structure?.words ?? 0,
    chars: a?.structure?.chars ?? 0,
    error: error || a?.extractError || null,
  };

  if (withRef) {
    const ref = referenceText(file);
    if (ref !== null) {
      const full = fullText.length || (a?.structure?.chars ?? 0);
      const refLen = ref.replace(/\s+/g, ' ').trim().length;
      row.refChars = refLen;
      row.deltaPct = refLen ? Math.round(((full - refLen) / refLen) * 1000) / 10 : null;
      const want = significantTokens(ref);
      const got = significantTokens(text);
      const missing = [...want].filter(t => !got.has(t));
      row.significant = want.size;
      row.missing = missing.length;
      row.missingSample = missing.slice(0, 5);
    }
  }
  rows.push(row);
}

if (asJson) { console.log(JSON.stringify(rows, null, 2)); process.exit(0); }

const pad = (v, n) => String(v ?? '—').padEnd(n).slice(0, n);
console.log(`\n${pad('FILE', 40)} ${pad('MODE', 12)} ${pad('WORDS', 6)} ${pad('ms', 6)}${withRef ? ` ${pad('GAP', 8)} ${pad('MISSING TOKENS', 20)}` : ''}`);
console.log('─'.repeat(withRef ? 96 : 68));
for (const r of rows) {
  const gap = r.deltaPct === undefined || r.deltaPct === null ? '—' : `${r.deltaPct > 0 ? '+' : ''}${r.deltaPct}%`;
  const miss = r.missing === undefined ? '—' : (r.missing === 0 ? 'none' : `${r.missing}/${r.significant}`);
  console.log(`${pad(r.file, 40)} ${pad(r.mode, 12)} ${pad(r.words, 6)} ${pad(r.ms, 6)}${withRef ? ` ${pad(gap, 8)} ${pad(miss, 20)}` : ''}`);
  if (r.error) console.log(`  ⚠ ${r.error}`);
  if (r.missingSample?.length) console.log(`  ⚠ not found: ${r.missingSample.join(', ')}`);
}

const failures = rows.filter(r => r.error || (r.missing ?? 0) > 0);
console.log(`\n${rows.length} file(s) · ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
