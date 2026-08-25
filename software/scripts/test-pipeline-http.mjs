#!/usr/bin/env node
/**
 * Level 2 — HTTP contract. Talks to the GED as any caller would:
 * another brick, an agent, a mail webhook. No browser involved.
 * This level certifies that the pipeline is usable from the outside.
 *
 *   node scripts/test-pipeline-http.mjs <file…> [--base http://127.0.0.1:8760] [--folder sub/folder]
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const BASE = (flag('base', process.env.GED_BASE || 'http://127.0.0.1:8760')).replace(/\/$/, '');

/**
 * The test ALWAYS uploads to a disposable folder it owns, under a
 * timestamped name. Otherwise, uploading "INVOICE.pdf" overwrites the real
 * user file of that name — and then cleanup deletes it. That has happened.
 * The test only ever deletes what it created itself.
 */
const RUN_ID = `_test-${Date.now().toString(36)}`;
const FOLDER = flag('folder', RUN_ID);
const files = args.filter((a, i) => !a.startsWith('--') && !['--base', '--folder'].includes(args[i - 1]));

if (!files.length) {
  console.error('usage: test-pipeline-http.mjs <file…> [--base URL] [--folder path]');
  process.exit(2);
}

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
  return ok;
};

console.log(`\nTarget GED : ${BASE}\nDisposable test folder : ${FOLDER}\n`);

// 0. Is the GED responding?
try {
  const h = await fetch(`${BASE}/api/health`);
  check('GED health', h.ok, `HTTP ${h.status}`);
} catch (err) {
  check('GED health', false, err.message);
  process.exit(1);
}

for (const file of files) {
  const name = path.basename(file);
  console.log(`\n── ${name}`);

  if (!fs.existsSync(file)) { check('file present on disk', false); continue; }
  const buf = fs.readFileSync(file);

  // 1. Upload — raw body, filename in URL: this is the server contract.
  //    Prefixed name: never collides with a real document.
  const testName = `${RUN_ID}__${name}`;
  const q = new URLSearchParams({ filename: testName, folder: FOLDER });
  const up = await fetch(`${BASE}/api/upload?${q}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: buf,
  });
  const upData = await up.json().catch(() => null);
  const relPath = upData?.file?.relPath;
  if (!check('upload accepted', up.ok && Boolean(relPath), relPath || `HTTP ${up.status}`)) continue;

  // 2. Is stored file identical to original? (avoiding multipart corruption)
  const raw = await fetch(`${BASE}/api/raw?path=${encodeURIComponent(relPath)}`);
  const stored = Buffer.from(await raw.arrayBuffer());
  check('content intact after upload', stored.length === buf.length && stored.equals(buf),
    `${buf.length} bytes sent, ${stored.length} bytes read back`);

  // 3. Analysis
  const an = await fetch(`${BASE}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: relPath }),
  });
  const anData = await an.json().catch(() => null);
  const a = anData?.analysis;
  if (!check('analysis executed', an.ok && Boolean(a), a?.mode || `HTTP ${an.status}`)) continue;

  check('mode announced explicitly', ['model', 'structural'].includes(a.mode), a.mode);
  check('no hallucinated text when nothing is readable',
    a.structure.chars > 0 || /Aucun|pas pu|non extractible/i.test(a.summary),
    `${a.structure.chars} characters`);

  // 4. Is analysis persisted and readable by another caller?
  const stat = await fetch(`${BASE}/api/stat?path=${encodeURIComponent(relPath)}`);
  const statData = await stat.json().catch(() => null);
  check('analysis persisted and readable', Boolean(statData?.meta?.analysis));

  // 5. Does file listing reflect status?
  const list = await fetch(`${BASE}/api/files?folder=${encodeURIComponent(FOLDER)}`);
  const listData = await list.json().catch(() => null);
  const entry = listData?.files?.find(f => f.relPath === relPath);
  check('listing marks file as analyzed', entry?.analyzed === true);

  // 6. Cleanup — only what this test created, never anything else.
  if (!relPath.includes(RUN_ID)) {
    check('cleanup refused: path outside test perimeter', false, relPath);
  } else {
    const del = await fetch(`${BASE}/api/fs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'delete', path: relPath }),
    });
    check('cleanup', del.ok);
  }
}

// Remove disposable folder if it belongs to this test run.
if (FOLDER.includes(RUN_ID)) {
  await fetch(`${BASE}/api/fs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'delete', path: FOLDER }),
  }).catch(() => {});
}

console.log(`\n${failures ? `❌ ${failures} check(s) failed` : '✅ HTTP contract respected end-to-end'}\n`);
process.exit(failures ? 1 : 0);
