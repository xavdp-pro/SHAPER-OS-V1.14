import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Intent: software/packages/pkg-opencode-server/INTENT.md#context-transport
// Run the real bridge HTTP server against a protocol recorder. The assertion
// inspects the exact outgoing request; no model outcome is simulated or claimed.
const here = path.dirname(fileURLToPath(import.meta.url));

async function unusedPorts() {
  const servers = [http.createServer(), http.createServer()];
  await Promise.all(servers.map((s) => new Promise((resolve) => s.listen(0, '127.0.0.1', resolve))));
  const ports = servers.map((s) => s.address().port);
  await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
  return ports;
}

test('the image bridge carries context to its backend and refuses malformed context', { timeout: 15000 }, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'shaper-context-transport-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const recorder = path.join(scratch, 'protocol-recorder.mjs');
  fs.copyFileSync(path.join(here, 'fixtures/protocol-recorder.mjs'), recorder);
  fs.chmodSync(recorder, 0o700);
  const record = path.join(scratch, 'request.json');
  const tokenFile = path.join(scratch, 'token');
  const [bridgePort, servePort] = await unusedPorts();
  const child = spawn(process.execPath, [path.join(here, '../server.mjs')], {
    env: {
      PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`,
      OPENCODE_BIN: recorder,
      OPENCODE_MODEL: 'protocol/recorder',
      OPENCODE_BRIDGE_PORT: String(bridgePort), OPENCODE_SERVE_PORT: String(servePort),
      OPENCODE_BRIDGE_BIND: '127.0.0.1',
      OPENCODE_CONFIG_DIR: path.join(scratch, 'config'),
      OPENCODE_WS_BASE: path.join(scratch, 'workspace'),
      TOKEN_FILE: tokenFile, SESSIONS_FILE: path.join(scratch, 'sessions.json'),
      SHAPER_PROTOCOL_RECORD: record,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (c) => { output += c; });
  child.stderr.on('data', (c) => { output += c; });
  const closed = new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
  t.after(async () => {
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
    try { await closed; } finally { clearTimeout(timer); }
  });
  const base = `http://127.0.0.1:${bridgePort}`;
  let headers;
  let ready = false;
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && child.exitCode === null) {
    if (fs.existsSync(tokenFile)) {
      headers = { Authorization: `Bearer ${fs.readFileSync(tokenFile, 'utf8').trim()}`, 'Content-Type': 'application/json' };
      try {
        const status = await fetch(`${base}/api/status`, { headers, signal: AbortSignal.timeout(300) });
        if ((await status.json()).ready) { ready = true; break; }
      } catch { /* startup is bounded by the deadline */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(ready, `bridge failed to become ready: ${output}`);

  const context = 'The verification marker is amber-cedar.';
  const response = await fetch(`${base}/api/inject`, {
    method: 'POST', headers,
    body: JSON.stringify({ conversation: 'transport-case', message: 'Return the configured marker.', context }),
  });
  assert.equal(response.status, 200, await response.text());
  const recorded = JSON.parse(fs.readFileSync(record, 'utf8'));
  assert.match(recorded.parts[0].text, /The verification marker is amber-cedar\./);
  assert.match(recorded.parts[0].text, /Return the configured marker\./);

  for (const invalid of [{ context: { instruction: 'not text' } }, { context_file: '/caller-only/context.md' }]) {
    const bad = await fetch(`${base}/api/inject`, {
      method: 'POST', headers,
      body: JSON.stringify({ conversation: 'rejected-case', message: 'Run', ...invalid }),
    });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).code, 'INVALID_CONTEXT');
    assert.deepEqual(JSON.parse(fs.readFileSync(record, 'utf8')), recorded, 'invalid context never reaches the backend');
  }
});
