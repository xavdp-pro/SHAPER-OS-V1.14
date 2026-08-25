import { Router } from 'express';
import { authMiddleware } from './auth.js';
import { stopCliRun } from '../lib/bridgeClient.js';
import {
  orchestrateSessionPrime,
  orchestrateSessionReset,
  orchestrateConversationClear,
} from '../lib/sessionOrchestrator.js';
import { guardConversation } from '../lib/conversationAccess.js';
import { getUser } from '../lib/usersStore.js';
import { writeStopAll } from '../lib/timelineBuilder.js';

const router = Router();

function conversationFromBody(req) {
  return String(req.body?.conversation || '').trim();
}

router.post('/session/reset', authMiddleware, async (req, res) => {
  const conversation = conversationFromBody(req);
  if (!conversation) return res.status(400).json({ error: 'Conversation required' });
  if (!(await guardConversation(req, res, conversation))) return;
  const prime = Boolean(req.body?.prime);
  try {
    const result = await orchestrateSessionReset(req, conversation, {
      prime,
      clientId: req.headers['x-helm-client-id'],
    });
    res.json(result);
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

/** Load operator briefing into CLI and ask for a short greeting (empty / new session). */
router.post('/session/prime', authMiddleware, async (req, res) => {
  const conversation = conversationFromBody(req);
  if (!conversation) return res.status(400).json({ error: 'Conversation required' });
  if (!(await guardConversation(req, res, conversation))) return;
  try {
    const result = await orchestrateSessionPrime(req, conversation, {
      clientId: req.headers['x-helm-client-id'],
    });
    res.json(result);
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

/**
 * Full clear: stop CLI (if supported), wipe timeline, reset session, reload briefing.
 * Orchestrated server-side — UI should prefer this over separate timeline + reset calls.
 */
router.post('/session/clear', authMiddleware, async (req, res) => {
  const conversation = conversationFromBody(req);
  if (!conversation) return res.status(400).json({ error: 'Conversation required' });
  if (!(await guardConversation(req, res, conversation))) return;
  try {
    const result = await orchestrateConversationClear(req, conversation, {
      clientId: req.headers['x-helm-client-id'],
    });
    res.json(result);
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.post('/session/stop', authMiddleware, async (req, res) => {
  const conversation = conversationFromBody(req);
  const all = Boolean(req.body?.all);
  if (!all && !conversation) {
    return res.status(400).json({ error: 'Conversation required (or all:true)' });
  }
  if (all) {
    const user = await getUser(Number(req.user?.sub));
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Stop all reserved for admins' });
    }
  } else if (!(await guardConversation(req, res, conversation))) {
    return;
  }
  try {
    const result = await stopCliRun(conversation || '', { all });
    // The bridge also emits run_aborted, but we immediately freeze stored runs
    // so a page reload during stop does not show stale spinners.
    await writeStopAll();
    res.json(result);
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

export default router;
