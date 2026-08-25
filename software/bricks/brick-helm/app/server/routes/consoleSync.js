import { Router } from 'express';
import { authMiddleware } from './auth.js';
import { subscribeConsoleSync, broadcastTimelineSync, broadcastUserSync } from '../lib/consoleSyncHub.js';
import { guardConversation } from '../lib/conversationAccess.js';

const router = Router();

function operatorRoom(userId) {
  return `operator:${String(userId || '').trim()}`;
}

/** Always-on SSE for operator-wide sync (language, etc.) — works without an open conversation. */
router.get('/console-sync/operator', authMiddleware, (req, res) => {
  const userId = req.user?.sub;
  if (!userId) return res.status(401).json({ error: 'auth requise' });

  const clientId = String(req.query.clientId || req.headers['x-helm-client-id'] || '').trim();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  subscribeConsoleSync(operatorRoom(userId), clientId, res, userId);
  res.write(`data: ${JSON.stringify({ type: 'connected', scope: 'operator' })}

`);

  req.on('close', () => {
    try { res.end(); } catch { /* ignore */ }
  });
});

router.get('/console-sync', authMiddleware, async (req, res) => {
  const conversation = String(req.query.conversation || '').trim();
  if (!conversation) {
    return res.status(400).json({ error: 'conversation requise' });
  }
  if (!(await guardConversation(req, res, conversation))) return;

  const clientId = String(req.query.clientId || req.headers['x-helm-client-id'] || '').trim();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  subscribeConsoleSync(conversation, clientId, res, req.user?.sub);
  res.write(`data: ${JSON.stringify({ type: 'connected', conversation })}\n\n`);

  req.on('close', () => {
    try { res.end(); } catch { /* ignore */ }
  });
});


router.post('/console-sync/voice', authMiddleware, async (req, res) => {
  const conversation = String(req.body?.conversation || '').trim();
  if (!conversation) return res.status(400).json({ error: 'conversation requise' });
  if (!(await guardConversation(req, res, conversation))) return;
  const text = String(req.body?.text || '');
  const mode = String(req.body?.mode || '').trim();
  const clientId = String(req.body?.clientId || req.headers['x-helm-client-id'] || '').trim();
  broadcastTimelineSync(conversation, {
    type: 'voice_preview',
    conversation,
    text,
    mode,
    clientId,
  }, { excludeClientId: clientId });
  res.json({ ok: true });
});

/** Language is an operator-wide choice: mirror it to their other open pages. */
router.post('/console-sync/locale', authMiddleware, (req, res) => {
  const locale = String(req.body?.locale || '').trim().toLowerCase();
  if (!['fr', 'es', 'en'].includes(locale)) {
    return res.status(400).json({ ok: false, error: 'locale invalide' });
  }
  const clientId = String(req.body?.clientId || req.headers['x-helm-client-id'] || '').trim();
  const sent = broadcastUserSync(req.user?.sub, { type: 'locale', locale, clientId }, {
    excludeClientId: clientId,
  });
  res.json({ ok: true, sent });
});

/** Model choice is an operator-wide choice: mirror it to their other open pages. */
router.post('/console-sync/model', authMiddleware, (req, res) => {
  const modelFamily = String(req.body?.modelFamily || req.body?.family || '').trim();
  const modelLabel = String(req.body?.modelLabel || req.body?.label || '').trim();
  const modelEffort = String(req.body?.modelEffort || req.body?.effort || 'full').trim();
  const modelFast = Boolean(req.body?.modelFast || req.body?.fast);
  if (!modelFamily) {
    return res.status(400).json({ ok: false, error: 'modelFamily requis' });
  }
  const clientId = String(req.body?.clientId || req.headers['x-helm-client-id'] || '').trim();
  const sent = broadcastUserSync(req.user?.sub, {
    type: 'model_change',
    modelFamily,
    modelLabel,
    modelEffort,
    modelFast,
    clientId,
  }, {
    excludeClientId: clientId,
  });
  res.json({ ok: true, sent });
});

export default router;
