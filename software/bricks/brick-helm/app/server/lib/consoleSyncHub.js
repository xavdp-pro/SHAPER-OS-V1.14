/**
 * In-memory SSE fan-out: sync timeline mutations across browser tabs/devices
 * for the same authenticated user + conversation.
 */

/** @type {Map<string, Set<{ res: import('express').Response, clientId: string }>>} */
const rooms = new Map();

const HEARTBEAT_MS = 25_000;
let heartbeatTimer = null;

function roomKey(conversation) {
  return String(conversation || '').trim();
}

function ensureHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    for (const clients of rooms.values()) {
      for (const client of clients) {
        try {
          client.res.write('data: {"type":"ping"}\n\n');
        } catch {
          /* dropped on next write */
        }
      }
    }
  }, HEARTBEAT_MS);
  if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();
}

function removeClient(conversation, res) {
  const key = roomKey(conversation);
  const set = rooms.get(key);
  if (!set) return;
  for (const c of set) {
    if (c.res === res) set.delete(c);
  }
  if (!set.size) rooms.delete(key);
}

/**
 * @param {string} conversation
 * @param {string} clientId
 * @param {import('express').Response} res
 */
export function subscribeConsoleSync(conversation, clientId, res, userId = '') {
  const key = roomKey(conversation);
  if (!key) return;
  if (!rooms.has(key)) rooms.set(key, new Set());
  rooms.get(key).add({ res, clientId: String(clientId || ''), userId: String(userId || '') });
  ensureHeartbeat();

  const onClose = () => {
    removeClient(key, res);
    res.removeListener('close', onClose);
  };
  res.on('close', onClose);
}

/**
 * @param {string} conversation
 * @param {object} payload
 * @param {{ excludeClientId?: string }} [opts]
 */
export function broadcastTimelineSync(conversation, payload, opts = {}) {
  const key = roomKey(conversation);
  const set = rooms.get(key);
  if (!set?.size) return;

  const exclude = String(opts.excludeClientId || '');
  const line = `data: ${JSON.stringify(payload)}\n\n`;

  for (const client of set) {
    if (exclude && client.clientId === exclude) continue;
    try {
      client.res.write(line);
    } catch {
      removeClient(key, client.res);
    }
  }
}

/**
 * Broadcast to every page of one operator, across conversations and rooms —
 * a language switch has to reach the other devices whatever they are showing.
 * @param {string|number} userId
 * @param {object} payload
 * @param {{ excludeClientId?: string }} [opts]
 */
export function broadcastUserSync(userId, payload, opts = {}) {
  const uid = String(userId || '');
  if (!uid) return 0;
  const exclude = String(opts.excludeClientId || '');
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  let sent = 0;
  for (const [key, set] of rooms) {
    for (const client of set) {
      if (client.userId !== uid) continue;
      if (exclude && client.clientId === exclude) continue;
      try {
        client.res.write(line);
        sent += 1;
      } catch {
        removeClient(key, client.res);
      }
    }
  }
  return sent;
}
