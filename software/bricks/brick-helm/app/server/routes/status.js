import { Router } from 'express';
import { authMiddleware } from './auth.js';
import { getRemoteStatus } from '../lib/bridgeClient.js';

const router = Router();

function conversationFromReq(req) {
  return String(req.query.conversation || req.body?.conversation || '').trim() || undefined;
}

router.get('/status', authMiddleware, async (req, res) => {
  try {
    const status = await getRemoteStatus(conversationFromReq(req));
    res.json(status);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
