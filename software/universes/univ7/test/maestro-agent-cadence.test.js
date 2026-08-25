/**
 * univ7 — Maestro cadence scenario: 2 agent tasks, vault mail creds, beat while bridge healthy.
 * Simulates 5-min cadence with accelerated interval in test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createVaultServer, VaultClient } from '../../../packages/vault/index.js';
import { createLoggerServer } from '../../../packages/logger/index.js';
import { MaestroScheduler } from '../../../packages/maestro/index.js';
import { AgyBridgeServer } from '../../../packages/bridge-agy/index.js';
import { mailboxToSlug, vaultKeyForMailbox, createAgentBeatHandler } from '../../../packages/agent/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UNIV7_ROOT = path.resolve(__dirname, '..');
const CONTEXT_FILE = path.join(UNIV7_ROOT, 'context/AGENT-CONTEXT.md');

const PORTS = { vault: 8810, logger: 8820, agy: 8840 };
const MASTER_KEY = 'univ7-cadence-master-key-test!!';
const VAULT_TOKEN = 'univ7-cadence-vault-token';
const MAILBOX = 'contact@zoutik.example.com';

const servers = [];

function trackServer(server) {
  servers.push(server);
  return new Promise((resolve) => {
    if (server.listening) return resolve();
    server.on('listening', resolve);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

test('univ7-maestro — cadence 5min (accel): 2 agent tasks, vault zoutik, beat while GET ok', async (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'univ7-cadence-'));
  let maestro;
  t.after(() => {
    if (maestro) maestro.stopScheduler();
    for (const s of servers) {
      try { s.close(); } catch { /* */ }
    }
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  const logDir = path.join(sandbox, 'logger');
  const maestroLog = path.join(sandbox, 'maestro/log');
  const vaultFile = path.join(sandbox, 'vault/vault.enc');
  const agyWs = path.join(sandbox, 'agy-ws');
  const cpFile = path.join(sandbox, 'checkpoint.json');
  fs.mkdirSync(maestroLog, { recursive: true });
  fs.writeFileSync(cpFile, JSON.stringify({ last_unseen: 0 }));

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

  const mailSlug = mailboxToSlug(MAILBOX);
  const mailVaultKey = vaultKeyForMailbox(MAILBOX);
  await vault.setSecret(mailVaultKey, {
    slug: mailSlug.replace(/^mail-/, ''),
    provider: 'ovh-zimbra',
    imap: { host: 'ssl0.ovh.net', port: 993, user: MAILBOX, pass: 'vault-stored-test-only', tls: true },
    smtp: { host: 'ssl0.ovh.net', port: 465, user: MAILBOX, pass: 'vault-stored-test-only' },
  });

  const agyBridge = new AgyBridgeServer({
    port: PORTS.agy,
    workspaceBase: agyWs,
    stubMode: true,
  });
  const agyServer = agyBridge.createServer();
  await new Promise((r) => agyServer.listen(PORTS.agy, '127.0.0.1', r));
  servers.push(agyServer);

  const beatHandler = createAgentBeatHandler({
    bridgeBaseUrl: `http://127.0.0.1:${PORTS.agy}`,
    vaultClient: vault,
    loggerUrl: `http://127.0.0.1:${PORTS.logger}`,
    checkpointPath: cpFile,
    mailStubMode: true,
  });

  maestro = new MaestroScheduler({ pod: 'maestro-univ7-cadence', logDir: maestroLog, beatHandler });

  maestro.registerAgentTask({
    slug: mailSlug,
    kind: 'mail',
    bridgeType: 'agy',
    bridgeUrl: `http://127.0.0.1:${PORTS.agy}`,
    mailbox: MAILBOX,
    port: PORTS.agy,
    vaultKey: mailVaultKey,
    cadenceSeconds: 0.05,
    contextPath: CONTEXT_FILE,
    checkpointPath: cpFile,
    beatMessage: 'Check test mailbox for new messages and triage.',
  });

  maestro.registerAgentTask({
    slug: 'ops-univ7-storm-watch',
    kind: 'bridge',
    bridgeType: 'agy',
    bridgeUrl: `http://127.0.0.1:${PORTS.agy}`,
    mailbox: 'ops@toitures.example.com',
    port: PORTS.agy,
    cadenceSeconds: 0.05,
    contextPath: CONTEXT_FILE,
    contextText: 'BTP storm damage overnight — 3 urgent quotes pending.',
    beatMessage: 'Produce ops briefing for the owner.',
  });

  assert.equal(maestro.listRegisteredPods().length, 2);

  maestro.startScheduler();
  await sleep(180);
  maestro.stopScheduler();
  // Allow any in-flight beat callbacks to finish
  await sleep(50);

  // Use a fresh checkpoint so stub mode returns 2 new messages deterministically
  // (scheduler beats may have consumed the original cpFile's first-call stub)
  const cpManual = path.join(sandbox, 'checkpoint-manual.json');
  fs.writeFileSync(cpManual, JSON.stringify({ last_unseen: 0 }));

  // Patch entry checkpointPath for the manual beat
  const mailEntry = maestro.registry.get(mailSlug);
  mailEntry.checkpointPath = cpManual;

  const mailBeat = await maestro.triggerBeat(mailSlug);
  const opsBeat = await maestro.triggerBeat('ops-univ7-storm-watch');
  assert.equal(mailBeat.new_messages, 2);
  assert.equal(opsBeat.new_messages, 1);

  const events = await (await fetch(`http://127.0.0.1:${PORTS.logger}/api/events/last?limit=30`)).json();
  assert.ok(events.events.some((e) => e.event === 'MAIL_INBOX_CHECK'));
  assert.ok(events.events.some((e) => e.event === 'AGENT_BEAT_INJECT' && e.data.slug === mailSlug));

  // Scheduler already stopped above — no-op but safe to call twice
  await new Promise((r) => agyServer.close(r));

  const skipped = await maestro.triggerBeat(mailSlug);
  assert.equal(skipped.new_messages, 0);

  const logs = maestro.logger.readLastEvents(50);
  assert.ok(logs.some((e) => e.event === 'BEAT_EXECUTED'));
});
