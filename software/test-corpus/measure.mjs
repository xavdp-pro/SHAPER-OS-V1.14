#!/usr/bin/env node
/**
 * @file measure.mjs
 * @description Reproducible benchmark measuring text extraction accuracy across the test corpus.
 * By default the extractor runs inside `localhost/shaper-pipeline:latest` so OCR is genuinely
 * exercised. Pass `--host-extractor` to measure the legacy host-only RAG extractor instead.
 *
 * Usage:
 *   node measure.mjs                 # pipeline container (default)
 *   node measure.mjs --host-extractor
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadHostExtractor() {
  const { extractTextFromFile } = await import('../packages/rag/lib/extractor.js');
  return extractTextFromFile;
}

export const CATEGORIES = [
  { dir: '00-sources', label: '00-sources (Clean vector baseline)', desc: 'Native vector PDFs' },
  { dir: '01-rasterise', label: '01-rasterise (Pure 150 DPI scans)', desc: 'Pure raster images without text layer' },
  { dir: '02-pivote', label: '02-pivote (90°/180°/270° rotations)', desc: 'Orthogonally rotated pages' },
  { dir: '03-de-travers', label: '03-de-travers (3° to 7° deskew)', desc: 'Scans tilted by 3° to 7°' },
  { dir: '04-degrade', label: '04-degrade (Photocopies & degradation)', desc: 'Low resolution, noise, contrast, fax' },
];

/**
 * Normalizes text for comparison: lowercases, collapses consecutive whitespace/newlines to a single space, trims.
 */
export function normalizeText(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Detects whether the extractor returned a fallback/unreadable notice
 * (no actual text extracted from document).
 */
export function isExtractorFallback(str) {
  if (!str) return false;
  return (
    str.startsWith('[PDF non extractible:') ||
    str.startsWith('[Document bureautique illisible:') ||
    str.startsWith('[Fichier binaire:')
  );
}

/**
 * Computes Levenshtein distance between two strings with O(min(m, n)) memory.
 */
export function levenshteinDistance(s1, s2) {
  if (s1 === s2) return 0;
  if (s1.length === 0) return s2.length;
  if (s2.length === 0) return s1.length;

  let v0 = new Int32Array(s2.length + 1);
  let v1 = new Int32Array(s2.length + 1);

  for (let i = 0; i <= s2.length; i++) {
    v0[i] = i;
  }

  for (let i = 0; i < s1.length; i++) {
    v1[0] = i + 1;
    const ch1 = s1[i];
    for (let j = 0; j < s2.length; j++) {
      const cost = ch1 === s2[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= s2.length; j++) {
      v0[j] = v1[j];
    }
  }

  return v0[s2.length];
}

/**
 * Computes normalized similarity score between 0.0 and 1.0.
 * Metric: 1 - (levenshtein_distance(E, T) / max(len(E), len(T))) on normalized text.
 */
export function computeSimilarity(extractedRaw, truthRaw) {
  const effectiveExtracted = isExtractorFallback(extractedRaw) ? '' : extractedRaw;
  const nExt = normalizeText(effectiveExtracted);
  const nTru = normalizeText(truthRaw);

  if (nExt.length === 0 && nTru.length === 0) return 1.0;
  if (nExt.length === 0 || nTru.length === 0) return 0.0;

  const maxLen = Math.max(nExt.length, nTru.length);
  const dist = levenshteinDistance(nExt, nTru);
  return Math.max(0, 1 - dist / maxLen);
}

/**
 * Computes the median of an array of numbers.
 */
export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Computes the arithmetic mean of an array of numbers.
 */
export function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Evaluates all test cases in a category.
 */
export async function evaluateCategory(catDir, {
  corpusRoot = __dirname,
  extractFn,
} = {}) {
  const extract = extractFn || await loadHostExtractor();
  const catPath = path.join(corpusRoot, catDir);
  const files = fs.readdirSync(catPath).filter((f) => f.endsWith('.pdf')).sort();
  const results = [];

  for (const file of files) {
    const pdfPath = path.join(catPath, file);
    const truthPath = pdfPath.replace(/\.pdf$/, '.verite.txt');

    if (!fs.existsSync(truthPath)) {
      throw new Error(`Ground truth file not found for ${pdfPath}`);
    }

    const truth = fs.readFileSync(truthPath, 'utf8');
    let extracted = null;
    let crashed = false;
    let crashError = null;
    let resultMeta = null;

    try {
      resultMeta = await extract(pdfPath);
      extracted = resultMeta.text;
    } catch (err) {
      crashed = true;
      crashError = err.message;
    }

    const sim = crashed ? 0.0 : computeSimilarity(extracted, truth);
    const nExt = normalizeText(isExtractorFallback(extracted) ? '' : (extracted || ''));
    const nTru = normalizeText(truth);
    const levDist = levenshteinDistance(nExt, nTru);

    results.push({
      category: catDir,
      file,
      pdfPath,
      truthPath,
      crashed,
      crashError,
      isFallback: extracted ? isExtractorFallback(extracted) : false,
      extractedRawLen: extracted ? extracted.length : 0,
      truthRawLen: truth.length,
      extractedNormLen: nExt.length,
      truthNormLen: nTru.length,
      levDist,
      similarity: sim,
      format: resultMeta?.format || 'n/a',
      pdfMethod: resultMeta?.pdfMethod || resultMeta?.pipelineVersion || 'n/a',
      witnesses: resultMeta?.witnesses || [],
    });
  }

  return results;
}

function formatPct(value) {
  return `${(value * 100).toFixed(2)} %`;
}

function buildAnalysis(categoryReports, allResults) {
  const lines = [];
  const byDir = Object.fromEntries(categoryReports.map((c) => [c.dir, c]));

  const sourcesMean = mean((byDir['00-sources']?.results || []).map((r) => r.similarity));
  lines.push(`1. **Vector documents (\`00-sources\`) — ${formatPct(sourcesMean)}**:`);
  lines.push('   - Native text extraction through the pipeline on clean vector PDFs.');

  for (const dir of ['01-rasterise', '02-pivote', '03-de-travers', '04-degrade']) {
    const cat = byDir[dir];
    if (!cat) continue;
    const catMean = mean(cat.results.map((r) => r.similarity));
    lines.push(`2. **${dir} — ${formatPct(catMean)} mean** (${cat.desc}).`);
  }

  const crashes = allResults.filter((r) => r.crashed).length;
  lines.push(`${lines.length + 1}. **Failure handling (${crashes} crashes)**:`);
  lines.push(`   - Unhandled exceptions across ${allResults.length} cases.`);

  const noise = allResults.find((r) => r.extractedRawLen > 50000);
  if (noise) {
    lines.push(`${lines.length + 1}. **Binary noise case \`${noise.file}\` (${formatPct(noise.similarity)})**:`);
    lines.push(`   - Extracted ${noise.extractedRawLen} chars of accidental PDF stream noise.`);
  }

  return lines.join('\n');
}

/**
 * Generates the full Markdown report.
 */
export function generateMarkdownReport(categoryReports, allResults, {
  extractorLabel = '`software/packages/rag/lib/extractor.js` on the host (no OCR)',
} = {}) {
  const totalCases = allResults.length;
  const totalCrashes = allResults.filter((r) => r.crashed).length;
  const allSimilarities = allResults.map((r) => r.similarity);
  const globalMean = mean(allSimilarities);
  const globalMedian = median(allSimilarities);

  const sourcesResults = allResults
    .filter((r) => r.category === '00-sources')
    .sort((a, b) => a.similarity - b.similarity);
  const worstSources = sourcesResults.slice(0, 3);

  let md = `# Measurement Report — SHAPER-OS Content Extractor

> **Evaluation Date**: ${new Date().toISOString().split('T')[0]}  
> **Extractor Measured**: ${extractorLabel}  
> **Test Corpus**: \`software/test-corpus/\` (37 cases paired with \`.verite.txt\`)  
> **Total Cases**: **${totalCases}** | **Crashes (unhandled exceptions)**: **${totalCrashes}**  
> **Overall Mean Accuracy**: **${formatPct(globalMean)}** | **Overall Median Accuracy**: **${formatPct(globalMedian)}**

---

## 1. Category Summary

| Category | Description | Cases | Mean Accuracy | Median Accuracy | Min | Max | Crashes |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
`;

  for (const cat of categoryReports) {
    const sims = cat.results.map((r) => r.similarity);
    const catMean = mean(sims);
    const catMedian = median(sims);
    const catMin = Math.min(...sims);
    const catMax = Math.max(...sims);
    const catCrashes = cat.results.filter((r) => r.crashed).length;

    md += `| \`${cat.dir}\` | ${cat.desc} | ${cat.results.length} | ${formatPct(catMean)} | ${formatPct(catMedian)} | ${formatPct(catMin)} | ${formatPct(catMax)} | ${catCrashes} |\n`;
  }

  md += `| **TOTAL** | *All 5 corpus categories* | **${totalCases}** | **${formatPct(globalMean)}** | **${formatPct(globalMedian)}** | **${formatPct(Math.min(...allSimilarities))}** | **${formatPct(Math.max(...allSimilarities))}** | **${totalCrashes}** |

---

## 2. Similarity Metric

The similarity metric is the **normalized Levenshtein distance computed on normalized text** (lowercased, consecutive whitespace and newlines collapsed to a single space, trimmed):

$$\\text{Similarity}(E, T) = 1 - \\frac{\\text{Levenshtein}(E_{\\text{norm}}, T_{\\text{norm}})}{\\max(|E_{\\text{norm}}|, |T_{\\text{norm}}|)}$$

where $E$ is the text extracted by the extractor (treated as empty if the extractor returns an unreadable fallback notice like \`[PDF non extractible...]\`) and $T$ is the ground-truth text.

---

## 3. Worst Three Cases in Clean Vector Baseline (\`00-sources\`)

The baseline category (\`00-sources\`) consists of the 4 cleanly generated native vector documents.

`;

  for (let i = 0; i < worstSources.length; i++) {
    const w = worstSources[i];
    md += `${i + 1}. **\`${w.file}\`**: **${formatPct(w.similarity)}** (Levenshtein distance: ${w.levDist}, extracted: ${w.extractedNormLen} chars, ground truth: ${w.truthNormLen} chars)\n`;
  }

  const allSourcesPerfect = sourcesResults.every((r) => r.similarity === 1.0);
  if (allSourcesPerfect) {
    md += `\n> [!NOTE]\n> **Baseline Observation**: All 4 source documents in \`00-sources\` achieve a similarity score of **100.00 %** (Levenshtein distance of 0).\n`;
  }

  md += `
---

## 4. Analysis of Results and Current Limitations

${buildAnalysis(categoryReports, allResults)}

---

## 5. Detailed Case-by-Case Breakdown

| Category | File | Extracted Size | Ground Truth Size | Extractor Status | Similarity | Crashed |
| :--- | :--- | :---: | :---: | :--- | :---: | :---: |
`;

  for (const r of allResults) {
    const status = r.crashed
      ? `💥 Exception: ${r.crashError}`
      : r.isFallback
      ? `⚠️ Unextractable (clean fallback)`
      : r.similarity === 1.0
      ? `✅ Exact extraction`
      : r.extractedRawLen > 50000
      ? `⚠️ Binary noise extracted (${r.extractedRawLen} chars)`
      : `Partial (${(r.witnesses || []).join('+') || 'unknown witnesses'})`;

    md += `| \`${r.category}\` | \`${r.file}\` | ${r.extractedRawLen} | ${r.truthRawLen} | ${status} | **${formatPct(r.similarity)}** | ${r.crashed ? 'YES' : 'No'} |\n`;
  }

  md += `
---
*Report automatically generated by \`software/test-corpus/measure.mjs\`.*
`;

  return md;
}

/**
 * Builds the podman argv used to run the benchmark inside the pipeline image.
 */
export function buildPodmanMeasureArgs({
  corpusDir = __dirname,
  image = process.env.PIPELINE_IMAGE || 'localhost/shaper-pipeline:latest',
} = {}) {
  return [
    'run', '--rm', '--cgroups=disabled',
    '-v', `${corpusDir}:/work:Z`,
    '-w', '/work',
    image,
    'node', 'measure-in-container.mjs',
  ];
}

/**
 * Runs the benchmark inside the pipeline container where Tesseract is available.
 */
export function runBenchmarkInPipelineContainer(options = {}) {
  const args = buildPodmanMeasureArgs(options);
  execFileSync('podman', args, { stdio: 'inherit' });
}

/**
 * Main benchmark orchestrator entrypoint.
 */
export async function runBenchmark({
  corpusRoot = __dirname,
  extractFn,
  extractorLabel = '`software/packages/rag/lib/extractor.js` on the host (no OCR)',
} = {}) {
  const extract = extractFn || await loadHostExtractor();
  const categoryReports = [];
  const allResults = [];

  for (const cat of CATEGORIES) {
    const results = await evaluateCategory(cat.dir, { corpusRoot, extractFn: extract });
    categoryReports.push({ ...cat, results });
    allResults.push(...results);
  }

  const markdown = generateMarkdownReport(categoryReports, allResults, { extractorLabel });
  const reportPath = path.join(corpusRoot, 'MEASUREMENT.md');
  fs.writeFileSync(reportPath, markdown, 'utf8');

  console.log(`[Measurement] Report successfully generated at: ${reportPath}`);
  console.log(`[Measurement] Total cases: ${allResults.length}`);
  console.log(`[Measurement] Overall mean accuracy: ${formatPct(mean(allResults.map((r) => r.similarity)))}`);
  console.log(`[Measurement] Crashes: ${allResults.filter((r) => r.crashed).length}`);

  return { categoryReports, allResults, markdown, reportPath };
}

// Direct execution when invoked from CLI
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const useHostExtractor = process.argv.includes('--host-extractor');
  if (useHostExtractor) {
    runBenchmark().catch((err) => {
      console.error('Error during benchmark execution:', err);
      process.exit(1);
    });
  } else {
    try {
      runBenchmarkInPipelineContainer();
    } catch (err) {
      console.error('Error during pipeline-container benchmark execution:', err);
      process.exit(1);
    }
  }
}
