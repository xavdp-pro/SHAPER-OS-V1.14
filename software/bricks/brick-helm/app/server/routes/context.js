import { Router } from 'express';
import { authMiddleware } from './auth.js';
import { guardConversation, resolveScopedConversationName } from '../lib/conversationAccess.js';
import { parseConversationId } from '../lib/bridgeClient.js';
import { resolveSessionWorkspace } from '../config.js';
import { normalizeLocale } from '../lib/locale.js';
import { getContextBootstrapState } from '../lib/contextSession.js';
import { orchestrateContextRemember } from '../lib/contextRemember.js';

const router = Router();

function workspaceFor(conversation) {
  const parsed = parseConversationId(conversation);
  return resolveSessionWorkspace(parsed.conversation, parsed.node || '');
}

router.get('/context/status', authMiddleware, async (req, res) => {
  let conversation = String(req.query.conversation || '').trim();
  if (!conversation) {
    conversation = resolveScopedConversationName(req.user) || '';
  }
  if (!conversation) return res.status(400).json({ error: 'Conversation required' });
  if (!(await guardConversation(req, res, conversation))) return;

  const workspaceCwd = workspaceFor(conversation);
  const state = getContextBootstrapState(conversation, workspaceCwd);
  res.json({
    ok: true,
    conversation,
    workspace: workspaceCwd || null,
    ...state,
  });
});

router.post('/context/remember', authMiddleware, async (req, res) => {
  let conversation = String(req.body?.conversation || '').trim();
  if (!conversation) {
    conversation = resolveScopedConversationName(req.user) || '';
  }
  const content = String(req.body?.content || '').trim();
  const scope = String(req.body?.scope || 'local').trim().toLowerCase();
  if (!conversation) return res.status(400).json({ error: 'Conversation required' });
  if (!content) return res.status(400).json({ error: 'Content required' });
  if (!['local', 'global'].includes(scope)) {
    return res.status(400).json({ error: 'Scope must be local or global' });
  }
  if (!(await guardConversation(req, res, conversation))) return;

  const lang = normalizeLocale(req.body?.lang);
  const hotReload = req.body?.hotReload !== false;
  const workspaceCwd = workspaceFor(conversation);

  try {
    const result = await orchestrateContextRemember({
      conversation,
      userId: Number(req.user?.sub),
      workspaceCwd,
      scope,
      content,
      locale: lang,
      hotReload,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

export default router;
