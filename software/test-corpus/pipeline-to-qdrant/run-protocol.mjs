#!/usr/bin/env node
/**
 * Validation protocol: document pipeline → Qdrant.
 * See PROTOCOL.md. Writes LAST-RUN.md. Exit 0 only if every gate passes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { QdrantRagEngine } from '../../packages/pkg-rag/index.js';
import { extractTextFromFile as extractNative } from '../../packages/pkg-rag/lib/extractor.js';
import { getTransformerPipeline } from '../../packages/pkg-rag/lib/embedder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES = path.join(__dirname, 'fixtures');
const IMAGE = process.env.PIPELINE_IMAGE || 'localhost/shaper-pipeline:latest';
const QDRANT_URL = process.env.QDRANT_URL || 'http://127.0.0.1:6333';
const QDRANT_CONTAINER = 'shaper-protocol-qdrant';
const QDRANT_IMAGE = process.env.QDRANT_IMAGE || 'docker.io/qdrant/qdrant:v1.13.2';
const CACHE_DIR = path.join(__dirname, '.extract-cache');
const FRESH = process.argv.includes('--fresh');

const manifest = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'manifest.json'), 'utf8'));

const gates = [];
function record(id, ok, detail) {
  gates.push({ id, ok: Boolean(ok), detail: String(detail) });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${id} — ${detail}`);
}

function hasNeedle(text, needle) {
  if (!text) return false;
  return text.replace(/\s+/g, ' ').toLowerCase().includes(String(needle).toLowerCase());
}

async function qdrantReady() {
  try {
    const res = await fetch(`${QDRANT_URL}/readyz`, { signal: AbortSignal.timeout(3000) });
    const body = await res.text();
    return res.ok && /ready/i.test(body);
  } catch {
    return false;
  }
}

function ensureQdrant() {
  const running = spawnSync('podman', ['inspect', '-f', '{{.State.Running}}', QDRANT_CONTAINER], {
    encoding: 'utf8',
  });
  if (running.status === 0 && String(running.stdout).trim() === 'true') return;

  execFileSync('podman', [
    'run', '-d', '--name', QDRANT_CONTAINER, '--replace', '--cgroups=disabled',
    '-p', '127.0.0.1:6333:6333',
    QDRANT_IMAGE,
  ], { stdio: 'inherit' });
}

function extractViaPipeline(absPdf, fixtureId) {
  const cachePath = path.join(CACHE_DIR, `${fixtureId}.json`);
  if (!FRESH && fs.existsSync(cachePath)) {
    console.log(`[pipeline] ${fixtureId} from cache ${cachePath}`);
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  }
  const out = execFileSync('podman', [
    'run', '--rm', '--cgroups=disabled',
    '-v', `${__dirname}:/work:Z`,
    '-v', `${FIXTURES}:/fixtures:ro,Z`,
    '-w', '/work',
    IMAGE,
    'node', 'extract-one.mjs', `/fixtures/${path.basename(absPdf)}`,
  ], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  const jsonStart = out.indexOf('{');
  if (jsonStart < 0) throw new Error(`pipeline produced no JSON: ${out.slice(0, 400)}`);
  const parsed = JSON.parse(out.slice(jsonStart));
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(parsed));
  return parsed;
}

async function withRetry(fn, label, attempts = 6) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      console.warn(`[retry] ${label} ${i + 1}/${attempts}: ${err.message}`);
      if (!(await qdrantReady())) {
        console.warn('[retry] restarting Qdrant container');
        ensureQdrant();
      }
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw last;
}

function writeReport({ embeddingBackend, extracts, indexResults, queryResults }) {
  const passed = gates.filter((g) => g.ok).length;
  const failed = gates.filter((g) => !g.ok).length;
  const lines = [
    `# Pipeline → Qdrant protocol — last run`,
    ``,
    `> Date: ${new Date().toISOString()}`,
    `> Qdrant: \`${QDRANT_URL}\``,
    `> Pipeline image: \`${IMAGE}\``,
    `> Embedding backend: **${embeddingBackend}**`,
    `> Gates: **${passed} passed**, **${failed} failed**`,
    ``,
    `## Gates`,
    ``,
    `| Gate | Result | Detail |`,
    `| :--- | :---: | :--- |`,
  ];
  for (const g of gates) {
    lines.push(`| \`${g.id}\` | ${g.ok ? 'PASS' : 'FAIL'} | ${g.detail.replace(/\|/g, '\\|')} |`);
  }
  lines.push('', '## Extracts', '');
  for (const e of extracts) {
    lines.push(`### ${e.id}`);
    lines.push(`- Kind: ${e.kind}`);
    lines.push(`- Native needles: ${(e.nativeNeedles || []).join(', ') || '(none)'}`);
    lines.push(`- Pipeline witnesses: ${(e.pipeline?.witnesses || []).join(', ') || 'n/a'}`);
    lines.push(`- Pipeline time: ${e.pipeline?.processingTimeMs ?? 'n/a'} ms`);
    lines.push(`- Pipeline text length: ${e.pipeline?.text?.length ?? 0}`);
    lines.push('');
  }
  lines.push('## Index', '');
  for (const i of indexResults) {
    lines.push(`- \`${i.id}\` → collection \`${i.collection}\` fileId=${i.fileId} chunks=${i.chunksCount} ok=${i.ok}`);
  }
  lines.push('', '## Queries', '');
  for (const q of queryResults) {
    const hitPreview = (q.hits || []).slice(0, 3).map((h) => {
      const snippet = String(h.text || '').replace(/\s+/g, ' ').slice(0, 120);
      return `score=${Number(h.score).toFixed(3)} file=${h.filename || h.fileId} “${snippet}”`;
    });
    lines.push(`- \`${q.fixtureId}\` query “${q.q}” expect \`${q.expectNeedle}\` → ${q.ok ? 'PASS' : 'FAIL'}`);
    for (const h of hitPreview) lines.push(`  - ${h}`);
  }
  lines.push('', '---', '*Generated by `run-protocol.mjs`. Vision skipped.*', '');
  fs.writeFileSync(path.join(__dirname, 'LAST-RUN.md'), lines.join('\n'), 'utf8');
}

async function main() {
  const extracts = [];
  const indexResults = [];
  const queryResults = [];

  if (!(await qdrantReady())) {
    console.log('[P0] Qdrant not ready — starting container…');
    ensureQdrant();
    for (let i = 0; i < 20; i++) {
      if (await qdrantReady()) break;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const p0 = await qdrantReady();
  record('P0-qdrant', p0, p0 ? `${QDRANT_URL} ready` : `${QDRANT_URL} not ready`);
  if (!p0) {
    writeReport({ embeddingBackend: 'n/a', extracts, indexResults, queryResults });
    process.exit(1);
  }

  const pipe = await getTransformerPipeline();
  const embeddingBackend = pipe ? 'Xenova/all-MiniLM-L6-v2' : 'local-hash-ngram (MiniLM absent — state, not dummy zeros)';
  record('P0-embedder', true, embeddingBackend);

  for (const fx of manifest.fixtures) {
    const abs = path.join(FIXTURES, fx.file);
    const native = await extractNative(abs);
    const nativeHits = fx.needles.filter((n) => hasNeedle(native.text, n));
    const nativeMiss = fx.needles.filter((n) => !hasNeedle(native.text, n));

    if (fx.kind === 'raster') {
      record(
        `P1-native-empty-${fx.id}`,
        nativeMiss.length === fx.needles.length,
        nativeHits.length
          ? `host extractor unexpectedly found: ${nativeHits.join(', ')}`
          : `host extractor missed all raster needles (expected; no text layer)`,
      );
    } else {
      record(
        `P1-native-${fx.id}`,
        nativeMiss.length === 0,
        nativeMiss.length
          ? `missing needles: ${nativeMiss.join(', ')}`
          : `all needles present (${nativeHits.join(', ')})`,
      );
    }

    console.log(`[pipeline] ${fx.id} via ${IMAGE}…`);
    const pipeline = extractViaPipeline(abs, fx.id);
    const pipeHits = fx.needles.filter((n) => hasNeedle(pipeline.text, n));
    const pipeMiss = fx.needles.filter((n) => !hasNeedle(pipeline.text, n));
    const ocrExpected = fx.kind === 'raster';
    const ocrOk = !ocrExpected || (pipeline.witnesses || []).includes('ocr');
    record(
      `P2-pipeline-${fx.id}`,
      pipeMiss.length === 0 && ocrOk,
      [
        pipeMiss.length ? `missing: ${pipeMiss.join(', ')}` : `needles: ${pipeHits.join(', ')}`,
        `witnesses=${(pipeline.witnesses || []).join('+') || 'none'}`,
        `${pipeline.processingTimeMs}ms`,
      ].join(' | '),
    );

    extracts.push({
      id: fx.id,
      kind: fx.kind,
      nativeNeedles: nativeHits,
      pipeline,
    });
    fx._pipelineText = pipeline.text;
    fx._filename = pipeline.filename || fx.file;
  }

  const engine = new QdrantRagEngine({
    qdrantUrl: QDRANT_URL,
    defaultCollection: manifest.collection,
    memoryCollection: manifest.isolationCollection,
  });
  await withRetry(() => engine.init(), 'qdrant.init');

  // Production-shaped upsert: chunk + embed + file_id payload (same shape as
  // QdrantRagEngine.indexDocument). Text comes from the pipeline, not the host
  // RAG extractor — that is the whole point of this protocol.
  const { chunkText } = await import('../../packages/pkg-rag/lib/chunker.js');
  const { generateEmbedding } = await import('../../packages/pkg-rag/lib/embedder.js');
  const crypto = await import('node:crypto');
  for (const fx of manifest.fixtures) {
    if (!fx._pipelineText || !String(fx._pipelineText).trim()) {
      indexResults.push({ id: fx.id, ok: false, chunksCount: 0, collection: manifest.collection, error: 'empty pipeline text' });
      record(`P3-index-${fx.id}`, false, 'empty pipeline text');
      continue;
    }
    const chunks = chunkText(fx._pipelineText, { maxChunkSize: 800, overlap: 120 });
    const points = [];
    for (const chunk of chunks) {
      points.push({
        id: crypto.randomUUID(),
        vector: await generateEmbedding(chunk.text),
        payload: {
          file_id: fx.id,
          filename: fx._filename,
          fixture_id: fx.id,
          kind: fx.kind,
          chunk_index: chunk.chunkIndex,
          total_chunks: chunks.length,
          text: chunk.text,
          indexed_at: Date.now(),
          protocol: 'pipeline-to-qdrant',
        },
      });
    }
    await withRetry(
      () => engine.client.deletePointsByFileId(manifest.collection, fx.id).catch(() => {}),
      `qdrant.delete:${fx.id}`,
    );
    await withRetry(() => engine.client.upsertPoints(manifest.collection, points), `qdrant.upsert:${fx.id}`);
    indexResults.push({
      id: fx.id,
      ok: true,
      fileId: fx.id,
      chunksCount: chunks.length,
      collection: manifest.collection,
    });
    record(
      `P3-index-${fx.id}`,
      chunks.length > 0,
      `${chunks.length} chunks → ${manifest.collection}`,
    );
  }

  const count = await withRetry(() => engine.client.countPoints(manifest.collection), 'qdrant.count');
  record('P3-count', count > 0, `${count} points in ${manifest.collection}`);

  for (const fx of manifest.fixtures) {
    for (const q of fx.queries) {
      const hits = await withRetry(
        () => engine.search(q.q, { collection: manifest.collection, limit: 5 }),
        `qdrant.search:${fx.id}`,
      );
      const joined = hits.slice(0, 3).map((h) => h.text).join('\n');
      const ok = hasNeedle(joined, q.expectNeedle);
      queryResults.push({ fixtureId: fx.id, q: q.q, expectNeedle: q.expectNeedle, hits, ok });
      record(
        `P4-query-${fx.id}`,
        ok,
        ok
          ? `top-3 contains ${q.expectNeedle} (best score ${hits[0] ? Number(hits[0].score).toFixed(3) : 'n/a'})`
          : `needle ${q.expectNeedle} absent from top-3`,
      );
    }
  }

  const otherCount = await engine.client.countPoints(manifest.isolationCollection);
  const leakHits = await engine.search('F-2024-00892 TraceMonkey ADM-2024-7841-K', {
    collection: manifest.isolationCollection,
    limit: 5,
  });
  const leaked = leakHits.some((h) =>
    hasNeedle(h.text, 'F-2024-00892') || hasNeedle(h.text, 'TraceMonkey') || hasNeedle(h.text, 'ADM-2024-7841-K'),
  );
  record(
    'P5-isolation',
    otherCount === 0 && !leaked,
    `other collection points=${otherCount} leakedNeedles=${leaked}`,
  );

  writeReport({ embeddingBackend, extracts, indexResults, queryResults });

  const failed = gates.filter((g) => !g.ok);
  if (failed.length) {
    console.error(`\n${failed.length} gate(s) failed. See LAST-RUN.md`);
    process.exit(1);
  }
  console.log(`\nAll ${gates.length} gates passed. Report: software/test-corpus/pipeline-to-qdrant/LAST-RUN.md`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
