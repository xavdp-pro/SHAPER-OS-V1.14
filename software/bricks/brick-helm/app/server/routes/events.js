import { Router } from 'express';
import { authMiddleware } from './auth.js';
import { bridgeEventsUrl, bridgeApiToken, bridgeConversationName } from '../lib/bridgeClient.js';
import {
  guardConversation,
  resolveScopedConversationName,
} from '../lib/conversationAccess.js';
import { getUser } from '../lib/usersStore.js';

const router = Router();

router.get('/events', authMiddleware, async (req, res) => {
  let conversation = String(req.query.conversation || '').trim() || undefined;
  const user = await getUser(Number(req.user?.sub)).catch(() => null);
  const scopedName = resolveScopedConversationName(user);
  if (scopedName) {
    if (!conversation) conversation = scopedName;
    if (!(await guardConversation(req, res, conversation))) return;
  } else if (conversation) {
    if (!(await guardConversation(req, res, conversation))) return;
  }
  try {
    // Filter by conversation — a browser only receives its own events.
    const base = await bridgeEventsUrl(conversation);
    const name = conversation ? bridgeConversationName(conversation) : '';
    const url = name ? `${base}?conversation=${encodeURIComponent(name)}` : base;
    const token = await bridgeApiToken(conversation);
    const upstream = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: req.signal,
    });
    if (!upstream.ok) {
      return res.status(502).json({ ok: false, error: `CLI SSE HTTP ${upstream.status}` });
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const reader = upstream.body?.getReader();
    if (!reader) return res.end();
    const decoder = new TextDecoder();
    req.on('close', () => reader.cancel().catch(() => {}));

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(502).json({ ok: false, error: err.message });
    } else {
      res.end();
    }
  }
});

export default router;
