import { Router } from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { authMiddleware } from './auth.js';
import {
  getConversationWorkspacePath,
  parseConversationId,
  uploadAttachment,
} from '../lib/bridgeClient.js';
import { guardConversation } from '../lib/conversationAccess.js';
import { resolveSessionWorkspace } from '../config.js';
import {
  resolveAttachmentAbs,
  upsertAttachment,
} from '../lib/attachmentRegistry.js';
import { QdrantRagEngine } from '../lib/rag/index.js';

const ragEngine = new QdrantRagEngine({
  qdrantUrl: process.env.QDRANT_URL || 'http://127.0.0.1:6333',
});

const router = Router();

function conversationFromReq(req) {
  return String(req.query.conversation || req.body?.conversation || '').trim() || undefined;
}

async function workspaceFor(conversation) {
  const fromBridge = await getConversationWorkspacePath(conversation);
  if (fromBridge) return fromBridge;
  const parsed = parseConversationId(conversation);
  return resolveSessionWorkspace(parsed.conversation, parsed.node || '') || '';
}

router.post('/upload', authMiddleware, async (req, res) => {
  const conversation = conversationFromReq(req);
  const filename = String(req.body?.filename || '').trim();
  const data = req.body?.data;
  const uploadId = String(req.body?.uploadId || crypto.randomUUID()).trim();
  const kind = String(req.body?.kind || 'doc').trim();
  if (!filename) return res.status(400).json({ error: 'filename is required' });
  if (!data) return res.status(400).json({ error: 'data (base64) is required' });
  if (String(data).length > 12_000_000) {
    return res.status(400).json({ error: 'Image too large (max ~8 MB)' });
  }
  if (conversation && !(await guardConversation(req, res, conversation))) return;

  const workspaceCwd = await workspaceFor(conversation);
  if (workspaceCwd) {
    upsertAttachment(workspaceCwd, {
      id: uploadId,
      name: filename,
      status: 'uploading',
      kind,
    });
  }

  try {
    const result = await uploadAttachment(conversation, filename, data);
    const rel = String(result?.rel || `_attachments/${path.basename(filename)}`).trim();
    const abs = String(result?.abs || '').trim() || resolveAttachmentAbs(workspaceCwd, rel);
    if (workspaceCwd) {
      upsertAttachment(workspaceCwd, {
        id: uploadId,
        name: filename,
        rel,
        abs,
        status: 'ready',
        kind,
      });

      // Automatic vector indexing in Qdrant in the background
      if (abs && fs.existsSync(abs)) {
        ragEngine.indexDocument({
          filePath: abs,
          fileId: uploadId,
          metadata: {
            conversation: conversation || 'general',
            filename,
            kind,
            user: req.user?.email || 'user',
          },
        }).then((res) => {
          console.log(`[RAG-INDEX] File ${filename} successfully vectorized (${res.chunksCount} chunks in Qdrant)`);
        }).catch((err) => {
          console.warn(`[RAG-INDEX] Failed vectorizing ${filename}:`, err.message);
        });
      }
    }
    res.json({
      ok: true,
      ...result,
      uploadId,
      rel,
      abs,
      status: 'ready',
      workspace: workspaceCwd || undefined,
    });
  } catch (err) {
    if (workspaceCwd) {
      upsertAttachment(workspaceCwd, {
        id: uploadId,
        name: filename,
        status: 'error',
        kind,
        error: err.message || 'Upload failed',
      });
    }
    const payload = err.data || {};
    res.status(502).json({
      ok: false,
      uploadId,
      status: 'error',
      error: payload.error || 'Upload failed',
      detail: err.message,
    });
  }
});

export default router;
