import { Router } from 'express';
import { authMiddleware } from './auth.js';
import { injectMessage, parseConversationId, getConversationWorkspacePath } from '../lib/bridgeClient.js';
import { normalizeLocale } from '../lib/locale.js';
import {
  writeHumanTurn,
  writeResendTurn,
  writeTurnFailure,
  linkBridgeRun,
} from '../lib/timelineBuilder.js';
import { formatAgentModelError } from '../lib/openrouterStatus.js';
import { getClaudeModel } from '../lib/settingsStore.js';
import { notifyDemoActivity } from '../lib/demoNotifyMail.js';
import { rememberDemoRequest } from '../lib/demoActivityWatch.js';
import {
  guardConversation,
  resolveScopedConversationName,
} from '../lib/conversationAccess.js';
import { getUser } from '../lib/usersStore.js';
import { appendAttachmentPaths } from '../lib/attachmentRegistry.js';
import { resolveSessionWorkspace } from '../config.js';

const router = Router();

function conversationFromReq(req) {
  return String(req.query.conversation || req.body?.conversation || '').trim() || undefined;
}

router.post('/inject', authMiddleware, async (req, res) => {
  const message = String(req.body?.message || '').trim();
  let conversation = conversationFromReq(req);
  const attachments = Array.isArray(req.body?.attachments)
    ? req.body.attachments.filter((a) => typeof a === 'string' && a.trim())
    : [];
  const resend = req.body?.resend && typeof req.body.resend === 'object' ? req.body.resend : null;
  const turn = req.body?.turn && typeof req.body.turn === 'object' ? req.body.turn : null;
  if (!message && attachments.length === 0 && !resend) {
    return res.status(400).json({ error: 'Message or image required' });
  }
  if (message.length > 32000) return res.status(400).json({ error: 'Message too long' });

  try {
    const user = await getUser(Number(req.user?.sub));
    const scopedName = resolveScopedConversationName(user);
    if (!conversation && scopedName) {
      conversation = scopedName;
    }
    const convName = conversation || 'Interface';
    if (!(await guardConversation(req, res, convName))) return;

    const lang = normalizeLocale(req.body?.lang);
    const voiceTurn = Boolean(req.body?.voiceTurn);
    const ackText = String(req.body?.ackText || '').trim();
    const userLabel = req.user?.email || req.user?.name || String(req.user?.sub || 'user');
    rememberDemoRequest({
      conversation: convName,
      lang,
      user: userLabel,
      message,
    });
    void notifyDemoActivity({
      kind: voiceTurn ? 'request-voice' : 'request',
      lang,
      conversation: convName,
      user: userLabel,
      text: message || '(attachment only)',
      meta: {
        voiceTurn,
        ackText: ackText || undefined,
        attachments: attachments.length || undefined,
      },
    });
    // 1) Write turn into server timeline (source of truth) BEFORE the bridge.
    const path = parseConversationId(conversation || convName).path
      || String(conversation || convName);
    let injectText = message;
    let hadContext = false;
    if (resend?.humanId) {
      const prepared = await writeResendTurn(path, {
        humanId: String(resend.humanId),
        text: String(resend.text || ''),
        images: Array.isArray(resend.images) ? resend.images : undefined,
        runId: String(resend.runId || ''),
      });
      if (!prepared) return res.status(404).json({ error: 'Message not found' });
      injectText = prepared.injectText;
      hadContext = prepared.hadContext;
    } else if (turn) {
      await writeHumanTurn(path, {
        text: message,
        images: Array.isArray(turn.images) ? turn.images : [],
        humanId: String(turn.humanId || ''),
        runId: String(turn.runId || ''),
        voiceTurn,
        ackText,
      });
    }

    // 2) Inject into CLI, then link the bridge run to the stored run item.
    try {
      const parsed = parseConversationId(conversation);
      const workspaceCwd = await getConversationWorkspacePath(conversation)
        || resolveSessionWorkspace(parsed.conversation, parsed.node || '')
        || '';
      const injectWithPaths = appendAttachmentPaths(injectText, workspaceCwd, attachments);
      const result = await injectMessage(injectWithPaths, conversation, attachments, lang, {
        voiceTurn,
        ackText,
        skipRollingContext: Boolean(resend),
      });
      if (result.run_id) linkBridgeRun(path, result.run_id);
      return res.json({
        ok: true,
        hadContext: hadContext || Boolean(result.hadRollingContext),
        ...result,
      });
    } catch (err) {
      if (turn || resend) {
        try {
          await writeTurnFailure(path, err.data?.error || err.message || 'Send failed');
        } catch { /* best effort */ }
      }
      throw err;
    }
  } catch (err) {
    const payload = err.data || {};
    const model = await getClaudeModel().catch(() => null);
    const friendly = formatAgentModelError(err, { model: payload.model || model });
    const status = Number(err.status) === 402 ? 402
      : (friendly.includes('crédits') ? 402 : 502);
    res.status(status).json({
      ok: false,
      error: friendly,
      detail: err.message,
    });
  }
});

export default router;
