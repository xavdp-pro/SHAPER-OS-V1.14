/**
 * univ7 — Minimal vital socle integration test.
 * vault + logger + maestro + bridge-agy (stub or live agy with AGY_API_KEY).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createVaultServer, VaultClient } from '../../../packages/vault/index.js';
import { createLoggerServer } from '../../../packages/logger/index.js';
import { MaestroScheduler, createMaestroServer } from '../../../packages/maestro/index.js';
import { AgyBridgeServer } from '../../../packages/bridge-agy/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UNIV7_ROOT = path.resolve(__dirname, '..');
const CONTEXT_FILE = path.join(UNIV7_ROOT, 'context/AGENT-CONTEXT.md');

const PORTS = { vault: 8710, logger: 8720, maestro: 8730, agy: 8740 };
const MASTER_KEY = 'univ7-pra-master-key-test-only!!';
const VAULT_TOKEN = 'univ7-vault-token-pra';

const servers = [];

function trackServer(server) {
  servers.push(server);
  return new Promise((resolve) => {
    if (server.listening) return resolve();
    server.on('listening', resolve);
  });
}

test('univ7-socle — cold boot PRA: vault → logger → maestro → agy', async (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'univ7-pra-'));
  t.after(() => {
    for (const s of servers) {
      try { s.close(); } catch { /* */ }
    }
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  const logDir = path.join(sandbox, 'logger');
  const maestroLog = path.join(sandbox, 'maestro/log');
  const vaultFile = path.join(sandbox, 'vault/vault.enc');
  const agyWs = path.join(sandbox, 'agy-ws');
  fs.mkdirSync(maestroLog, { recursive: true });

  // Layer 1: vault + logger
  const vaultServer = createVaultServer({
    port: PORTS.vault,
    host: '127.0.0.1',
    masterKey: MASTER_KEY,
    vaultToken: VAULT_TOKEN,
    storageFile: vaultFile,
  });
  await trackServer(vaultServer);

  const loggerServer = createLoggerServer({ port: PORTS.logger, host: '127.0.0.1', logDir });
  await trackServer(loggerServer);

  const vault = new VaultClient({
    vaultUrl: `http://127.0.0.1:${PORTS.vault}`,
    vaultToken: VAULT_TOKEN,
  });

  const agyKey = process.env.AGY_API_KEY || process.env.GEMINI_API_KEY || 'test-stub-key-not-real';
  await vault.setSecret('secret/agy/api-key', { provider: 'antigravity', key: agyKey });

  const stored = await vault.getSecret('secret/agy/api-key');
  assert.equal(stored.key, agyKey);

  // Layer 2: maestro
  const maestro = new MaestroScheduler({ pod: 'maestro-univ7', logDir: maestroLog });
  const maestroServer = createMaestroServer({ port: PORTS.maestro, host: '127.0.0.1', scheduler: maestro });
  await trackServer(maestroServer);

  const useStub = process.env.BRIDGE_AGY_STUB !== '0';
  const agyBridge = new AgyBridgeServer({
    port: PORTS.agy,
    workspaceBase: agyWs,
    stubMode: useStub,
  });
  const agyServer = agyBridge.createServer();
  await new Promise((r) => agyServer.listen(PORTS.agy, '127.0.0.1', r));
  servers.push(agyServer);

  maestro.registerPodMail({
    slug: 'bridge-agy-univ7',
    mailbox: 'ops@toitures.example.com',
    port: PORTS.agy,
    vaultKey: 'secret/agy/api-key',
    cadenceSeconds: 60,
  });

  // Scenario: storm damage — 3 urgent quotes overnight
  await fetch(`http://127.0.0.1:${PORTS.logger}/api/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pod: 'univ7-ops',
      event: 'QUOTE_REQUEST_URGENT',
      level: 'WARN',
      data: { count: 3, region: 'Var', type: 'storm_damage' },
    }),
  });

  const beatReport = await maestro.triggerBeat('bridge-agy-univ7', async (pod) => {
    const injectRes = await fetch(`http://127.0.0.1:${PORTS.agy}/api/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation: 'univ7-morning-brief',
        context_file: CONTEXT_FILE,
        context: 'Priority: HIGH — 3 urgent storm damage quotes overnight',
        message: 'Produce the morning ops briefing for the BTP owner.',
      }),
    });
    const injectData = await injectRes.json();
    assert.equal(injectRes.status, 200);
    assert.equal(injectData.ok, true);

    await fetch(`http://127.0.0.1:${PORTS.logger}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pod: 'univ7-ops',
        event: 'BEAT_OPS_CHECK',
        data: { run_id: injectData.run_id, mailbox: pod.mailbox },
      }),
    });

    return { ok: true, newMessages: 3 };
  });

  assert.equal(beatReport.new_messages, 3);

  const healthChecks = await Promise.all([
    fetch(`http://127.0.0.1:${PORTS.vault}/api/health`).then((r) => r.json()),
    fetch(`http://127.0.0.1:${PORTS.logger}/api/health`).then((r) => r.json()),
    fetch(`http://127.0.0.1:${PORTS.maestro}/api/health`).then((r) => r.json()),
    fetch(`http://127.0.0.1:${PORTS.agy}/api/health`).then((r) => r.json()),
  ]);

  for (const h of healthChecks) {
    assert.ok(h.status === 'ok' || h.ok === true);
  }

  const events = await (await fetch(`http://127.0.0.1:${PORTS.logger}/api/events/last?pod=univ7-ops&limit=10`)).json();
  assert.ok(events.events.length >= 2);
  assert.ok(events.events.some((e) => e.event === 'QUOTE_REQUEST_URGENT'));
  assert.ok(events.events.some((e) => e.event === 'BEAT_OPS_CHECK'));

  const pods = await (await fetch(`http://127.0.0.1:${PORTS.maestro}/api/pods`)).json();
  assert.equal(pods.pods.length, 1);
});
