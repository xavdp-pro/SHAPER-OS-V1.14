#!/usr/bin/env node
/**
 * Level 3 — Real UI. A real browser uploads a real file via the import field,
 * and we observe the tracking modal step-by-step.
 * This is the only level that certifies what the user actually sees.
 *
 *   node scripts/test-pipeline-ui.mjs <file…> [--base URL] [--headed] [--shot folder]
 *
 * Playwright is not a direct repository dependency: we resolve it wherever installed.
 * Like the other two levels, this test ONLY touches what it created itself.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadPlaywright } from './playwright-resolver.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const BASE = (flag('base', process.env.GED_BASE || 'http://127.0.0.1:8760')).replace(/\/$/, '');
const HEADED = args.includes('--headed');
const SHOTS = flag('shot', null);
const files = args.filter((a, i) => !a.startsWith('--') && !['--base', '--shot'].includes(args[i - 1]));

if (!files.length) {
  console.error('usage: test-pipeline-ui.mjs <file…> [--base URL] [--headed] [--shot folder]');
  process.exit(2);
}

const { chromium } = loadPlaywright();

const RUN_ID = `_test-${Date.now().toString(36)}`;
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
  return ok;
};

const browser = await chromium.launch({ headless: !HEADED, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const jsErrors = [];
page.on('pageerror', e => jsErrors.push(String(e)));

console.log(`\nTarget GED : ${BASE}\nRun ID : ${RUN_ID}\n`);

// A SSE connection remains open in dev mode: networkidle would never resolve.
await page.goto(`${BASE}/`, { waitUntil: 'load' });
await page.waitForSelector('.node', { timeout: 10000 });
check('interface loaded', true);

const shot = async (name) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
};

for (const file of files) {
  const base = path.basename(file);
  const testName = `${RUN_ID}__${base}`;
  console.log(`\n── ${base}`);
  if (!fs.existsSync(file)) { check('file present', false); continue; }

  // Upload via the real import field, under a name that does not overwrite anything.
  await page.setInputFiles('#file-input', {
    name: testName,
    mimeType: 'application/octet-stream',
    buffer: fs.readFileSync(file),
  });

  const modalSeen = await page.waitForSelector('#import-overlay:not(.is-hidden)', { timeout: 8000 })
    .then(() => true).catch(() => false);
  check('tracking modal displayed', modalSeen);
  await shot(`${base}-1-modale`);

  // Advertised processing steps must progress, not jump straight to completion.
  const seenStates = new Set();
  const tStart = Date.now();
  const collector = setInterval(async () => {
    try {
      const st = await page.textContent('.imp-row .imp-state');
      if (st) seenStates.add(st.trim());
    } catch { /* modal might disappear */ }
  }, 120);

  const done = await page.waitForFunction(
    () => { const b = document.getElementById('imp-close'); return b && !b.disabled; },
    { timeout: 60000 },
  ).then(() => true).catch(() => false);
  clearInterval(collector);

  const elapsed = Date.now() - tStart;
  check('processing completed', done, `${elapsed} ms`);

  // A file processed in tens of milliseconds traverses its steps faster
  // than polling can observe: this is an observation, not a defect.
  // We only require intermediate visible steps if processing took long enough.
  if (elapsed < 600) {
    console.log(`  ℹ️  steps unobservable — processing too fast (${elapsed} ms). `
      + 'Rerun with a larger file to test live tracking.');
  } else {
    // A single intermediate observed step proves live progress reporting:
    // the final state arrives after stopping the collector.
    check('live processing step visible', seenStates.size >= 1, [...seenStates].join(' → '));
  }
  const finalState = await page.textContent('.imp-row .imp-state').catch(() => '');
  const rowClass = await page.getAttribute('.imp-row', 'class').catch(() => '');
  check('final state reported', Boolean(finalState.trim()), finalState.trim());
  check('no silent failure', !rowClass.includes('is-error'), rowClass);
  await shot(`${base}-2-termine`);

  await page.click('#imp-close');
  await page.waitForTimeout(900);

  // Analysis panel must open for the imported file.
  const insp = await page.textContent('#insp-body').catch(() => '');
  check('analysis panel opened on file', insp.includes(testName) || insp.includes(base), '');
  check('summary present', /Résumé|Propriétés/.test(insp));
  await shot(`${base}-3-analyse`);

  // API cleanup, strictly bounded to what this test created.
  const del = await page.evaluate(async ({ b, p }) => {
    const r = await fetch(`${b}/api/fs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'delete', path: p }),
    });
    return r.ok;
  }, { b: BASE, p: testName });
  check('test file cleanup', del);
}

check('no JavaScript errors', jsErrors.length === 0, jsErrors.join(' | '));
await browser.close();
console.log(`\n${failures ? `❌ ${failures} check(s) failed` : '✅ user journey validated'}\n`);
process.exit(failures ? 1 : 0);
