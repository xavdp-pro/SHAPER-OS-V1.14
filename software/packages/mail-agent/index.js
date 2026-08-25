/**
 * @package @shaper/mail-agent
 * Minimal IMAP inbox check — vault creds, stub mode for tests.
 */
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';
import { ingestLog } from '../logger/ingest-client.js';

function imapExchange(socket, tag, command) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\r\n');
      for (const line of lines) {
        if (line.startsWith(`${tag} OK`)) {
          socket.off('data', onData);
          return resolve(buffer);
        }
        if (line.startsWith(`${tag} NO`) || line.startsWith(`${tag} BAD`)) {
          socket.off('data', onData);
          return reject(new Error(line));
        }
      }
    };
    socket.on('data', onData);
    socket.write(`${tag} ${command}\r\n`);
  });
}

function parseUnseenStatus(response) {
  const match = response.match(/UNSEEN\s+(\d+)/i);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * @param {object} imapConfig
 * @returns {Promise<{ unseen: number }>}
 */
export async function imapCheckUnseen(imapConfig) {
  const { host, port = 993, user, pass, tls: useTls = true } = imapConfig;
  if (!host || !user || !pass) throw new Error('imap host, user and pass required');

  return new Promise((resolve, reject) => {
    const socket = useTls
      ? tls.connect({ host, port, servername: host })
      : null;

    if (!socket) return reject(new Error('TLS required for IMAP'));

    let tag = 0;
    const nextTag = () => `a${++tag}`;

    socket.setTimeout(15000, () => {
      socket.destroy();
      reject(new Error('IMAP timeout'));
    });

    socket.once('error', reject);

    (async () => {
      await imapExchange(socket, nextTag(), `LOGIN ${JSON.stringify(user)} ${JSON.stringify(pass)}`);
      const status = await imapExchange(socket, nextTag(), 'STATUS INBOX (UNSEEN)');
      await imapExchange(socket, nextTag(), 'LOGOUT');
      socket.end();
      resolve({ unseen: parseUnseenStatus(status) });
    })().catch((err) => {
      socket.destroy();
      reject(err);
    });
  });
}

/**
 * @param {string} checkpointPath
 * @returns {object}
 */
export function readCheckpoint(checkpointPath) {
  if (!checkpointPath || !fs.existsSync(checkpointPath)) {
    return { last_unseen: 0, last_check_at: null };
  }
  try {
    return JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
  } catch {
    return { last_unseen: 0, last_check_at: null };
  }
}

export function writeCheckpoint(checkpointPath, data) {
  if (!checkpointPath) return;
  fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
  fs.writeFileSync(checkpointPath, JSON.stringify({ ...data, updated_at: new Date().toISOString() }, null, 2));
}

/**
 * Check mailbox inbox — stub or live IMAP.
 *
 * @param {object} options
 * @param {import('../vault/index.js').VaultClient} options.vaultClient
 * @param {string} options.vaultKey
 * @param {string} [options.slug]
 * @param {string} [options.loggerUrl]
 * @param {string} [options.checkpointPath]
 * @param {boolean} [options.stubMode]
 */
export async function checkMailbox({
  vaultClient,
  vaultKey,
  slug = 'mail-agent',
  loggerUrl = null,
  checkpointPath = null,
  stubMode = process.env.MAIL_AGENT_STUB === '1',
  fetchImpl = fetch,
} = {}) {
  const start = Date.now();
  await ingestLog({
    loggerUrl,
    pod: slug,
    event: 'MAIL_CHECK_STARTED',
    correlationId: slug,
    data: { vault_key: vaultKey, stub: stubMode },
    fetchImpl,
  });

  if (!vaultClient || !vaultKey) {
    await ingestLog({
      loggerUrl,
      pod: slug,
      event: 'MAIL_CHECK_FAILED',
      level: 'ERROR',
      correlationId: slug,
      data: { reason: 'missing_vault' },
      fetchImpl,
    });
    return { ok: false, newMessages: 0, reason: 'missing_vault' };
  }

  let creds;
  try {
    creds = await vaultClient.getSecret(vaultKey);
  } catch (err) {
    await ingestLog({
      loggerUrl,
      pod: slug,
      event: 'MAIL_CHECK_FAILED',
      level: 'ERROR',
      correlationId: slug,
      data: { reason: 'vault_fetch_failed', error: err.message },
      fetchImpl,
    });
    return { ok: false, newMessages: 0, reason: 'vault_fetch_failed' };
  }

  let unseen = 0;
  if (stubMode) {
    const cp = readCheckpoint(checkpointPath);
    unseen = cp.last_unseen === 0 ? 2 : 0;
  } else {
    const result = await imapCheckUnseen(creds.imap);
    unseen = result.unseen;
  }

  const checkpoint = readCheckpoint(checkpointPath);
  const prevUnseen = checkpoint.last_unseen || 0;
  const newMessages = Math.max(0, unseen - prevUnseen);
  if (stubMode && unseen > 0 && prevUnseen === 0) {
    // First stub run simulates 2 new messages
  }

  writeCheckpoint(checkpointPath, {
    last_unseen: unseen,
    last_check_at: new Date().toISOString(),
    mailbox: creds.imap?.user || null,
  });

  const durationMs = Date.now() - start;
  await ingestLog({
    loggerUrl,
    pod: slug,
    event: 'MAIL_INBOX_CHECK',
    correlationId: slug,
    durationMs,
    data: { unseen, new_messages: stubMode ? (prevUnseen === 0 ? 2 : 0) : newMessages, stub: stubMode },
    fetchImpl,
  });

  const reportedNew = stubMode ? (prevUnseen === 0 ? 2 : 0) : newMessages;
  return { ok: true, newMessages: reportedNew, unseen, stub: stubMode, durationMs };
}
