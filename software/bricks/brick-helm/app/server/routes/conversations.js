import { Router } from 'express';
import { authMiddleware } from './auth.js';
import {
  listConversations,
  deleteCliConversation,
  setConversationWorkspace,
  parseConversationId,
} from '../lib/bridgeClient.js';
import {
  loadTimeline,
  copyTimeline,
  purgeTimeline,
  renameTimeline,
  getConversationsMetadata,
  setConversationFolder,
  archiveConversation,
  pinConversation,
  setConversationModel,
  getConversationModel,
} from '../lib/timelineStore.js';
import { broadcastTimelineSync } from '../lib/consoleSyncHub.js';
import { exportTimeline } from '../lib/timelineExport.js';
import { getUser } from '../lib/usersStore.js';
import {
  resolveScopedConversationName,
  filterConversationsByScope,
  ensureScopedConversationListed,
  guardConversation,
} from '../lib/conversationAccess.js';
import { buildSessionCatalog } from '../lib/sessionCatalog.js';
import { browseRemoteDirectory, defaultBrowseRoots } from '../lib/remoteFs.js';

const router = Router();

function pathFromBody(req, ...keys) {
  for (const key of keys) {
    const v = req.body?.[key];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

async function scopedListForReq(req) {
  const data = await listConversations();
  const user = await getUser(Number(req.user?.sub));
  const scopedName = resolveScopedConversationName(user);
  let conversations = filterConversationsByScope(data.conversations || [], scopedName);
  conversations = ensureScopedConversationListed(conversations, scopedName, data.nodes || []);
  return { ...data, conversations };
}

router.get('/conversations', authMiddleware, async (req, res) => {
  try {
    const data = await scopedListForReq(req);
    const meta = await getConversationsMetadata();
    data.conversations = (data.conversations || []).map((c) => {
      const key = c.path || c.name || c.id;
      const info = meta[key] || meta[c.name] || meta[c.id] || {};
      return {
        ...c,
        folder: info.folder || 'Général',
        archived_at: info.archived_at || null,
        pinned: Boolean(info.pinned),
        model: info.model || null,
      };
    });
    const folderSet = new Set(['Général']);
    data.conversations.forEach((c) => {
      if (c.folder) folderSet.add(c.folder);
    });
    data.folders = Array.from(folderSet);
    res.json(data);
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

/** Catalog for conversation stepper: CLI nodes + SSH Host aliases + workspace layouts. */
router.get('/session-catalog', authMiddleware, (_req, res) => {
  try {
    res.json({ ok: true, ...buildSessionCatalog() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** Remote directory listing for workspace picker (bridge / SSH). */
router.get('/fs/browse', authMiddleware, async (req, res) => {
  const node = String(req.query.node || req.query.machine || '').trim();
  const user = String(req.query.user || '').trim();
  const dirPath = String(req.query.path || '').trim();
  try {
    const result = await browseRemoteDirectory({ node, user, path: dirPath || undefined });
    if (!result.ok) {
      return res.status(result.error?.includes('not found') || result.error?.includes('introuvable') ? 404 : 502).json(result);
    }
    res.json({
      ...result,
      roots: defaultBrowseRoots(user),
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message || 'Browse failed' });
  }
});

/** Register session on bridge (workspace bind) + return conversation entry. */
router.post('/conversations/register', authMiddleware, async (req, res) => {
  const conversation = pathFromBody(req, 'path', 'conversation');
  const workspace = String(req.body?.workspace || '').trim();
  if (!conversation) {
    return res.status(400).json({ ok: false, error: 'path is required (machine/user/session)' });
  }
  if (!workspace) {
    return res.status(400).json({ ok: false, error: 'workspace is required' });
  }
  if (!(await guardConversation(req, res, conversation))) return;
  const parsed = parseConversationId(conversation);
  if (!parsed.target) {
    return res.json({
      ok: true,
      localOnly: true,
      bridged: false,
      path: parsed.path || conversation,
      workspace,
      node: parsed.node,
      user: parsed.user,
      name: parsed.conversation,
      warning: `Node « ${parsed.node || '?'} » absent from CLI_NODES — local-only session`,
    });
  }
  try {
    const bridge = await setConversationWorkspace(conversation, workspace);
    res.json({
      ok: true,
      path: parsed.path || conversation,
      workspace,
      node: parsed.node,
      user: parsed.user,
      name: parsed.conversation,
      bridged: true,
      bridge,
    });
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: err.message || 'CLI registration failed',
      path: parsed.path || conversation,
      workspace,
    });
  }
});

/** Delete a conversation: purge timeline + unregister on CLI bridge + optional GED purge. */
router.post('/conversations/delete', authMiddleware, async (req, res) => {
  const conversation = pathFromBody(req, 'conversation', 'path');
  const purgeAttachments = req.body?.purgeAttachments === true;
  if (!conversation) {
    return res.status(400).json({ ok: false, error: 'Conversation required' });
  }
  if (!(await guardConversation(req, res, conversation))) return;
  try {
    await purgeTimeline(conversation);
    let bridge = null;
    try {
      bridge = await deleteCliConversation(conversation);
    } catch (err) {
      // Timeline already purged — still report bridge error.
    }

    let gedPurgedCount = 0;
    if (purgeAttachments) {
      try {
        const gedRes = await fetch(`http://127.0.0.1:8660/api/by-conversation/${encodeURIComponent(conversation)}`, {
          method: 'DELETE',
        });
        if (gedRes.ok) {
          const gedData = await gedRes.json();
          gedPurgedCount = gedData.deletedCount || 0;
        }
      } catch (err) {
        console.error('[conv-delete] Error purging GED:', err.message);
      }
    }

    res.json({ ok: true, conversation, bridge, purgeAttachments, gedPurgedCount });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** Set conversation folder. */
router.post('/conversations/folder', authMiddleware, async (req, res) => {
  const conversation = pathFromBody(req, 'conversation', 'path');
  const folder = String(req.body?.folder || 'Général').trim() || 'Général';
  if (!conversation) return res.status(400).json({ ok: false, error: 'Conversation required' });
  if (!(await guardConversation(req, res, conversation))) return;
  try {
    const result = await setConversationFolder(conversation, folder);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** Set model for a specific conversation and broadcast to open views. */
router.post('/conversations/model', authMiddleware, async (req, res) => {
  const conversation = pathFromBody(req, 'conversation', 'path', 'id');
  if (!conversation) return res.status(400).json({ ok: false, error: 'Conversation required' });
  if (!(await guardConversation(req, res, conversation))) return;
  const model = String(req.body?.model || req.body?.modelFamily || req.body?.family || '').trim();
  const modelLabel = String(req.body?.modelLabel || req.body?.label || '').trim();
  const modelEffort = String(req.body?.modelEffort || req.body?.effort || 'full').trim();
  const modelFast = Boolean(req.body?.modelFast || req.body?.fast);
  const clientId = String(req.body?.clientId || req.headers['x-helm-client-id'] || '').trim();

  try {
    const result = await setConversationModel(conversation, model);
    broadcastTimelineSync(conversation, {
      type: 'conversation_model_change',
      conversation,
      model,
      modelLabel,
      modelEffort,
      modelFast,
      clientId,
    }, { excludeClientId: clientId });
    res.json({ ok: true, conversation, model: result.model, modelLabel, modelEffort, modelFast });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** Archive or unarchive a conversation. */
router.post('/conversations/archive', authMiddleware, async (req, res) => {
  const conversation = pathFromBody(req, 'conversation', 'path');
  const isArchived = req.body?.archived !== false;
  if (!conversation) return res.status(400).json({ ok: false, error: 'Conversation required' });
  if (!(await guardConversation(req, res, conversation))) return;
  try {
    const result = await archiveConversation(conversation, isArchived);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** Pin or unpin a conversation. */
router.post('/conversations/pin', authMiddleware, async (req, res) => {
  const conversation = pathFromBody(req, 'conversation', 'path');
  const isPinned = req.body?.pinned !== false;
  if (!conversation) return res.status(400).json({ ok: false, error: 'Conversation required' });
  if (!(await guardConversation(req, res, conversation))) return;
  try {
    const result = await pinConversation(conversation, isPinned);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** Export a conversation (markdown, text or json). */
router.post('/conversations/export', authMiddleware, async (req, res) => {
  const conversation = pathFromBody(req, 'conversation', 'source', 'path');
  if (!conversation) {
    return res.status(400).json({ ok: false, error: 'Conversation required' });
  }
  if (!(await guardConversation(req, res, conversation))) return;
  const format = String(req.body?.format || 'markdown').toLowerCase();
  const stored = await loadTimeline(conversation);
  const items = Array.isArray(req.body?.items) ? req.body.items : stored.items;
  const updated_at = stored.updated_at;
  if (format === 'json') {
    return res.json({
      ok: true,
      conversation,
      updated_at,
      items,
      item_count: items.length,
    });
  }
  const exported = exportTimeline(items, {
    format: format === 'text' ? 'text' : 'markdown',
    title: conversation,
  });
  res.json({
    ok: true,
    conversation,
    updated_at,
    ...exported,
  });
});

/** Copy timeline from source conversation to target. */
router.post('/conversations/copy', authMiddleware, async (req, res) => {
  const source = pathFromBody(req, 'source', 'from', 'conversation');
  const target = pathFromBody(req, 'target', 'to');
  if (!source) return res.status(400).json({ ok: false, error: 'Source required' });
  if (!target) return res.status(400).json({ ok: false, error: 'Target required' });
  if (source === target) {
    return res.status(400).json({ ok: false, error: 'Source and target must differ' });
  }
  if (!(await guardConversation(req, res, source))) return;
  if (!(await guardConversation(req, res, target))) return;

  const mode = req.body?.mode === 'append' ? 'append' : 'replace';
  const src = await loadTimeline(source);
  const saved = await copyTimeline(source, target, { mode });
  const includeExport = req.body?.export !== false;
  const payload = {
    ok: true,
    source,
    target,
    mode,
    item_count: saved.items.length,
    copied_from_count: src.items.length,
    updated_at: saved.updated_at,
  };
  if (includeExport) {
    const exported = exportTimeline(saved.items, { format: 'markdown', title: target });
    payload.markdown = exported.markdown;
    payload.text = exported.text;
  }
  res.json(payload);
});

/** Rename a conversation (moves its timeline to a new name). */
router.post('/conversations/rename', authMiddleware, async (req, res) => {
  const source = pathFromBody(req, 'source', 'from', 'oldPath', 'conversation');
  const target = pathFromBody(req, 'target', 'to', 'newPath', 'newName');
  if (!source) return res.status(400).json({ ok: false, error: 'Source required' });
  if (!target) return res.status(400).json({ ok: false, error: 'Target required' });
  if (source === target) {
    return res.json({ ok: true, source, target });
  }
  if (!(await guardConversation(req, res, source))) return;
  if (!(await guardConversation(req, res, target))) return;

  try {
    const result = await renameTimeline(source, target);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** Backward-compat alias — same data. */
router.get('/instances', authMiddleware, async (req, res) => {
  try {
    const data = await scopedListForReq(req);
    res.json({
      ok: true,
      instances: data.conversations.map((c) => ({
        workspace_name: c.id,
        conversation: c.name,
        host: c.node,
        port: c.port,
      })),
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

export default router;
