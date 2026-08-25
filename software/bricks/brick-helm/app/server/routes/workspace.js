import { Router } from 'express';
import path from 'node:path';
import { authMiddleware } from './auth.js';
import { guardConversation } from '../lib/conversationAccess.js';
import { readWorkspaceFile, listDeliverables } from '../lib/workspaceFiles.js';
import {
  docxBufferToPreviewHtml,
  isDocxPath,
  previewTitleFromPath,
} from '../lib/workspacePreview.js';

const router = Router();

router.get('/workspace/file', authMiddleware, async (req, res) => {
  const conversation = String(req.query.conversation || '').trim();
  const filePath = String(req.query.path || '').trim();
  const download = req.query.download === '1' || req.query.download === 'true';
  if (!conversation) return res.status(400).json({ ok: false, error: 'Conversation required' });
  if (!filePath) return res.status(400).json({ ok: false, error: 'Path required' });
  if (!(await guardConversation(req, res, conversation))) return;

  try {
    const { buffer, mime, path: absPath } = await readWorkspaceFile(conversation, filePath);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=120');
    res.setHeader('X-Workspace-Path', absPath);
    if (download) {
      const name = path.basename(absPath).replace(/["\\]/g, '');
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    }
    res.send(buffer);
  } catch (err) {
    const status = Number(err.status) || 502;
    res.status(status).json({ ok: false, error: err.message || 'Cannot read file' });
  }
});

/** List deliverables (docs/, assets/, data/) produced in the conversation workspace. */
router.get('/workspace/deliverables', authMiddleware, async (req, res) => {
  const conversation = String(req.query.conversation || '').trim();
  if (!conversation) return res.status(400).json({ ok: false, error: 'Conversation required' });
  if (!(await guardConversation(req, res, conversation))) return;

  try {
    const { cwd, files } = await listDeliverables(conversation);
    res.json({ ok: true, cwd, files, count: files.length });
  } catch (err) {
    const status = Number(err.status) || 502;
    res.status(status).json({ ok: false, error: err.message || 'Cannot list deliverables' });
  }
});

router.get('/workspace/preview', authMiddleware, async (req, res) => {
  const conversation = String(req.query.conversation || '').trim();
  const filePath = String(req.query.path || '').trim();
  if (!conversation) return res.status(400).json({ ok: false, error: 'Conversation required' });
  if (!filePath) return res.status(400).json({ ok: false, error: 'Path required' });
  if (!isDocxPath(filePath)) {
    return res.status(400).json({ ok: false, error: 'Preview only available for .docx files' });
  }
  if (!(await guardConversation(req, res, conversation))) return;

  try {
    const { buffer, path: absPath } = await readWorkspaceFile(conversation, filePath);
    const { html } = await docxBufferToPreviewHtml(buffer);
    res.json({
      ok: true,
      html,
      title: previewTitleFromPath(absPath),
      path: absPath,
    });
  } catch (err) {
    const status = Number(err.status) || 502;
    res.status(status).json({ ok: false, error: err.message || 'Preview unavailable' });
  }
});

export default router;
