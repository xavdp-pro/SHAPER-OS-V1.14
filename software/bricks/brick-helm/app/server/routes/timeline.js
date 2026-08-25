import { Router } from 'express';
import { authMiddleware } from './auth.js';
import { loadTimeline, saveTimeline, deleteTimeline } from '../lib/timelineStore.js';
import { broadcastTimelineSync } from '../lib/consoleSyncHub.js';
import { guardConversation } from '../lib/conversationAccess.js';
import { invalidateTimelineCache } from '../lib/timelineBuilder.js';
import { parseConversationId } from '../lib/bridgeClient.js';
import { sliceRecentExchanges, RECENT_EXCHANGES_LIMIT } from '../lib/timelineSlice.js';

const router = Router();

function conversationFromReq(req) {
  return String(req.query.conversation || req.body?.conversation || '').trim();
}

function resolveTimelinePath(conversation) {
  return parseConversationId(conversation).path || conversation;
}

function clientIdFromReq(req) {
  return String(req.headers['x-helm-client-id'] || req.body?.clientId || '').trim();
}

function paginationEnabled(req) {
  const raw = String(req.query.pagination ?? req.query.full ?? '').trim().toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'yes') return true;
  if (raw === '0' || raw === 'false' || raw === 'no') return false;
  return false;
}

function timelineGetPayload(data, { pagination }) {
  const items = Array.isArray(data.items) ? data.items : [];
  if (pagination) {
    return {
      ok: true,
      path: data.path,
      items,
      updated_at: data.updated_at,
      pagination: true,
      truncated: false,
      total_items: items.length,
      total_exchanges: items.filter((it) => it.type === 'human').length,
      hidden_exchanges: 0,
      hidden_items: 0,
      recent_limit: RECENT_EXCHANGES_LIMIT,
    };
  }
  const sliced = sliceRecentExchanges(items, RECENT_EXCHANGES_LIMIT);
  return {
    ok: true,
    path: data.path,
    items: sliced.visible,
    updated_at: data.updated_at,
    pagination: false,
    truncated: sliced.hiddenExchanges > 0,
    total_items: sliced.totalItems,
    total_exchanges: sliced.totalExchanges,
    hidden_exchanges: sliced.hiddenExchanges,
    hidden_items: sliced.hiddenItems,
    recent_limit: RECENT_EXCHANGES_LIMIT,
  };
}


function notifyTimelineSync(conversation, payload, req) {
  broadcastTimelineSync(conversation, {
    type: 'timeline_sync',
    conversation,
    ...payload,
  }, { excludeClientId: clientIdFromReq(req) });
}

router.get('/timeline', authMiddleware, async (req, res) => {
  const conversation = conversationFromReq(req);
  if (!conversation) return res.status(400).json({ error: 'Conversation required' });
  if (!(await guardConversation(req, res, conversation))) return;
  const data = await loadTimeline(resolveTimelinePath(conversation));
  res.json(timelineGetPayload(data, { pagination: paginationEnabled(req) }));
});

router.put('/timeline', authMiddleware, async (req, res) => {
  const conversation = conversationFromReq(req);
  if (!conversation) return res.status(400).json({ error: 'Conversation required' });
  if (!(await guardConversation(req, res, conversation))) return;
  const items = req.body?.items;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items[] required' });
  const ifUpdatedAt = req.body?.ifUpdatedAt ?? null;
  const path = resolveTimelinePath(conversation);
  const saved = await saveTimeline(path, items, { ifUpdatedAt });
  if (!saved.conflict) invalidateTimelineCache(path);
  if (saved.conflict) {
    return res.status(409).json({
      ok: false,
      conflict: true,
      path: saved.path,
      items: saved.items,
      updated_at: saved.updated_at,
    });
  }
  notifyTimelineSync(conversation, {
    updated_at: saved.updated_at,
    cleared: items.length === 0,
    item_count: items.length,
  }, req);
  res.json({ ok: true, ...saved });
});

router.delete('/timeline', authMiddleware, async (req, res) => {
  const conversation = conversationFromReq(req);
  if (!conversation) return res.status(400).json({ error: 'Conversation required' });
  if (!(await guardConversation(req, res, conversation))) return;
  const path = resolveTimelinePath(conversation);
  const saved = await deleteTimeline(path);
  invalidateTimelineCache(path);
  notifyTimelineSync(conversation, {
    updated_at: saved.updated_at,
    cleared: true,
    item_count: 0,
  }, req);
  res.json({ ok: true, path: conversation, items: [], updated_at: saved.updated_at });
});

export default router;
