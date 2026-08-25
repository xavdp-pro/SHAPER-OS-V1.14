import path from 'node:path';
import mammoth from 'mammoth';

const DOCX_EXT = /\.docx$/i;

export function isDocxPath(filePath) {
  return DOCX_EXT.test(String(filePath || '').trim().split('?')[0].split('#')[0]);
}

/**
 * Convert a DOCX buffer to HTML for first-page chat preview.
 * @param {Buffer} buffer
 * @returns {Promise<{ html: string }>}
 */
export async function docxBufferToPreviewHtml(buffer) {
  const result = await mammoth.convertToHtml({ buffer });
  const html = String(result?.value || '').trim();
  if (!html) {
    const err = new Error('Document Word vide ou illisible');
    err.status = 422;
    throw err;
  }
  return { html };
}

export function previewTitleFromPath(absPath) {
  return path.posix.basename(String(absPath || '').trim()) || 'Document';
}
