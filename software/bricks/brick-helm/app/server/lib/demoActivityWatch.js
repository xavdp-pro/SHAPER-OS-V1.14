import { notifyDemoActivity, demoNotifyEnabled } from './demoNotifyMail.js';

/** Track pending user turns so response mails can include lang/user context. */
const pendingByConversation = new Map();

function cursorBridgeAuth() {
  const raw = process.env.AGENT_PLUGINS || '';
  for (const part of raw.split(',')) {
    const [id, url, token] = part.split('|').map((s) => String(s || '').trim());
    if (id === 'cursor' && url) {
      return { url: url.replace(/\/$/, ''), token: token || process.env.CLI_BRIDGE_TOKEN || '' };
    }
  }
  return {
    url: (process.env.CLI_BRIDGE_URL || 'http://127.0.0.1:4310').replace(/\/$/, ''),
    token: process.env.CLI_BRIDGE_TOKEN || '',
  };
}

export function rememberDemoRequest({ conversation, lang, user, message, model }) {
  const key = String(conversation || 'Interface').trim() || 'Interface';
  pendingByConversation.set(key, {
    lang: lang || '?',
    user: user || 'anonymous',
    message: String(message || '').slice(0, 500),
    model: model || '',
    at: Date.now(),
  });
}

/** Whether a bridge response should be mailed as a prime dump (shorter body). */
export function isPrimeResponseNotify(pendingMessage, responseText) {
  const text = String(responseText || '');
  const pending = String(pendingMessage || '');
  return text.length > 4000
    || /Session start|Démarrage de session|Operator briefing/i.test(pending);
}

export function parseBridgeSseDataLine(chunk) {
  const dataLine = String(chunk || '').split('\n').find((l) => l.startsWith('data:'));
  if (!dataLine) return null;
  try {
    return JSON.parse(dataLine.slice(5).trim());
  } catch {
    return null;
  }
}

/**
 * Keep a long-lived SSE connection to the cursor bridge and email each
 * response_complete (demo awareness).
 */
export function startDemoActivityWatcher() {
  if (!demoNotifyEnabled()) {
    console.log('[demo-notify] disabled (no SMTP or DEMO_NOTIFY=0)');
    return;
  }
  console.log('[demo-notify] watching bridge SSE for agent replies →', process.env.DEMO_NOTIFY_TO || 'admin@example.com');
  void loop();
}

async function loop() {
  while (true) {
    try {
      await watchOnce();
    } catch (err) {
      console.warn('[demo-notify] SSE watch error:', err.message);
    }
    await sleep(2500);
  }
}

async function watchOnce() {
  const { url, token } = cursorBridgeAuth();
  if (!token) throw new Error('cursor bridge token missing');
  const upstream = await fetch(`${url}/api/events`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!upstream.ok) {
    throw new Error(`bridge SSE HTTP ${upstream.status}`);
  }
  const reader = upstream.body?.getReader();
  if (!reader) throw new Error('no SSE body');
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      handleSseChunk(chunk);
    }
  }
}

function handleSseChunk(chunk) {
  const evt = parseBridgeSseDataLine(chunk);
  if (!evt) return;
  if (evt?.type !== 'response_complete') return;
  const conversation = String(evt.conversation || 'Interface').trim() || 'Interface';
  const text = String(evt.text || '').trim();
  if (!text) return;
  const pending = pendingByConversation.get(conversation) || {};
  const looksPrime = isPrimeResponseNotify(pending.message, text);
  void notifyDemoActivity({
    kind: looksPrime ? 'prime-response' : 'response',
    lang: pending.lang || '?',
    conversation,
    user: pending.user || 'anonymous',
    model: evt.model || pending.model || '',
    text: looksPrime ? text.slice(0, 600) : text,
    meta: {
      chat_id: evt.chat_id || evt.composer_id || null,
      exit: evt.exit,
    },
  });
  pendingByConversation.delete(conversation);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
