/**
 * univ8 — Harmonized socle: logger central, maestro 5min, mail check + agy inject.
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
import { createAgentBeatHandler } from '../../../packages/agent/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UNIV8_ROOT = path.resolve(__dirname, '..');
const CONTEXT_FILE = path.join(UNIV8_ROOT, 'context/AGENT-CONTEXT.md');

const PORTS = { vault: 9110, logger: 9120, agy: 9140 };
const MASTER_KEY = 'univ8-harmony-master-key-test!!';
const VAULT_TOKEN = 'univ8-harmony-vault-token';

function trackServer(server, serverList) {
  serverList.push(server);
  return new Promise((resolve) => {
    if (server.listening) return resolve();
    server.on('listening', resolve);
  });
}

test('univ8-harmony — logger logs mail check + beat + inject (auto validation)', async (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'univ8-harmony-'));
  const logDir = path.join(sandbox, 'logger');
  const vaultFile = path.join(sandbox, 'vault.enc');
  const cpFile = path.join(sandbox, 'checkpoint.json');
  const agyWs = path.join(sandbox, 'agy-ws');
  const servers = [];

  t.after(() => {
    for (const s of servers) {
      try { s.close(); } catch { /* ignore */ }
    }
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  const vaultServer = createVaultServer({
    port: PORTS.vault, host: '127.0.0.1',
    masterKey: MASTER_KEY, vaultToken: VAULT_TOKEN, storageFile: vaultFile,
  });
  await trackServer(vaultServer, servers);

  const loggerServer = createLoggerServer({ port: PORTS.logger, host: '127.0.0.1', logDir });
  await trackServer(loggerServer, servers);

  const vault = new VaultClient({
    vaultUrl: `http://127.0.0.1:${PORTS.vault}`, vaultToken: VAULT_TOKEN,
  });
  await vault.setSecret('secret/mail/contact-zoutik-shop', {
    slug: 'contact-zoutik-shop',
    provider: 'ovh-zimbra',
    imap: { host: 'ssl0.ovh.net', port: 993, user: 'contact@zoutik.example.com', pass: 'test', tls: true },
    smtp: { host: 'ssl0.ovh.net', port: 465, user: 'contact@zoutik.example.com', pass: 'test' },
  });

  const agyBridge = new AgyBridgeServer({ port: PORTS.agy, workspaceBase: agyWs, stubMode: true });
  const agyServer = agyBridge.createServer();
  await new Promise((r) => agyServer.listen(PORTS.agy, '127.0.0.1', r));
  servers.push(agyServer);

  const loggerUrl = `http://127.0.0.1:${PORTS.logger}`;
  const beatHandler = createAgentBeatHandler({
    bridgeBaseUrl: `http://127.0.0.1:${PORTS.agy}`,
    vaultClient: vault,
    loggerUrl,
    checkpointPath: cpFile,
    mailStubMode: true,
  });

  const maestro = new MaestroScheduler({
    pod: 'maestro-univ8', logDir: path.join(sandbox, 'maestro'), beatHandler,
  });

  maestro.registerAgentTask({
    slug: 'mail-contact-zoutik-shop',
    kind: 'mail',
    mailbox: 'contact@zoutik.example.com',
    port: PORTS.agy,
    vaultKey: 'secret/mail/contact-zoutik-shop',
    cadenceSeconds: 300,
    contextPath: CONTEXT_FILE,
    checkpointPath: cpFile,
    beatMessage: 'Triage inbox.',
  });

  const report = await maestro.triggerBeat('mail-contact-zoutik-shop');
  assert.equal(report.new_messages, 2);

  const eventsRes = await fetch(`${loggerUrl}/api/events/last?limit=30`);
  const { events } = await eventsRes.json();

  const eventNames = events.map((e) => e.event);
  assert.ok(eventNames.includes('BEAT_STARTED'), 'maestro logs beat start');
  assert.ok(eventNames.includes('MAIL_CHECK_STARTED'), 'mail-agent logs check start');
  assert.ok(eventNames.includes('MAIL_INBOX_CHECK'), 'mail-agent logs inbox result');
  assert.ok(eventNames.includes('AGENT_BEAT_INJECT'), 'agy inject logged');
  assert.ok(eventNames.includes('BEAT_COMPLETED'), 'maestro logs beat complete');

  const mailEvents = events.filter((e) => e.pod === 'mail-contact-zoutik-shop');
  assert.ok(mailEvents.length >= 2);
});
