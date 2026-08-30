import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

// Intent: docs/PREREQUISITES.md
//
// Born from an operator ruling: prerequisites lived in four documents and no
// gate enforced them — an agent could start with no registry, no tag, or a
// vault key that was documentation. The start line is now mechanical:
// preflight exits 1 and the agent does not begin; only the human present may
// overrule (SHAPER_HUMAN_OVERRIDE=1), and the override is recorded.

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '../../../scripts/preflight.mjs');

// The child is spawned asynchronously: one test hosts an HTTP registry in
// this process, and a synchronous spawn would block the loop that serves it.
async function runPreflight(env = {}, root) {
  const base = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('SHAPER_')),
  );
  const args = [SCRIPT, ...(root ? ['--root', root] : [])];
  try {
    const { stdout } = await execFileP(process.execPath, args, { env: { ...base, ...env } });
    return { code: 0, output: stdout };
  } catch (err) {
    return { code: err.code, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

test('preflight refuses to start without a registry, and says to ask', async () => {
  const r = await runPreflight({ SHAPER_IMAGE_TAG: 'v0-test' });
  assert.equal(r.code, 1, `an agent may start with no registry named:\n${r.output}`);
  assert.match(r.output, /DO NOT START/);
  assert.match(r.output, /ask the human/i);
});

test('preflight refuses a registry that does not answer from here', async () => {
  const r = await runPreflight({ SHAPER_REGISTRY: '127.0.0.1:1', SHAPER_IMAGE_TAG: 'v0-test' });
  assert.equal(r.code, 1);
  assert.match(r.output, /does not answer/);
});

test('preflight refuses an existing .env carrying the example placeholder', async () => {
  const server = http.createServer((_, res) => res.end('{}'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const reg = `127.0.0.1:${server.address().port}`;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shaper-preflight-'));
  fs.writeFileSync(path.join(root, '.env'),
    'VAULT_MASTER_KEY=<same as .env VAULT_MASTER_KEY>\nVAULT_TOKEN=abc\n');
  const r = await runPreflight({ SHAPER_REGISTRY: reg, SHAPER_IMAGE_TAG: 'v0-test' }, root);
  server.close();
  assert.equal(r.code, 1, `a placeholder master key passed the start line:\n${r.output}`);
  assert.match(r.output, /placeholder/);
});

test("the human's explicit override — and only that — turns a red gate green, loudly", async () => {
  const r = await runPreflight({ SHAPER_HUMAN_OVERRIDE: '1' });
  assert.equal(r.code, 0, `the override did not let the human proceed:\n${r.output}`);
  assert.match(r.output, /OVERRIDDEN on the human's word/);
  assert.match(r.output, /Record this override/);
});
