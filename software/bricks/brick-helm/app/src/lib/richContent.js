/** Media types for assistant deliverables (text + voice share the same bubble). */

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;
const PDF_EXT = /\.pdf$/i;
const DOCX_EXT = /\.(docx?|odt|rtf)$/i;
const SPREADSHEET_EXT = /\.(xlsx?|csv|tsv|parquet)$/i;
const ARCHIVE_EXT = /\.(zip|tar\.gz|tgz|7z|rar)$/i;
const PRESENTATION_EXT = /\.(pptx?|odp)$/i;
const DATA_EXT = /\.(json|ya?ml|sql)$/i;

export function classifyMediaPath(raw) {
  const s = String(raw || '').trim().split('?')[0].split('#')[0];
  if (!s) return 'unknown';
  if (/^data:image\//i.test(s) || /^blob:/i.test(s)) return 'image';
  if (IMAGE_EXT.test(s)) return 'image';
  if (PDF_EXT.test(s)) return 'pdf';
  if (DOCX_EXT.test(s)) return 'docx';
  if (SPREADSHEET_EXT.test(s)) return 'spreadsheet';
  if (ARCHIVE_EXT.test(s)) return 'archive';
  if (PRESENTATION_EXT.test(s)) return 'presentation';
  if (DATA_EXT.test(s)) return 'data';
  if (/^https?:\/\//i.test(s)) return 'link';
  if (s.startsWith('/')) return 'file';
  return 'unknown';
}

export function isExternalUrl(src) {
  return /^(https?:\/\/|data:|blob:)/i.test(String(src || '').trim());
}

/** Resolve relative workspace paths against conversation cwd. */
export function resolveMediaPath(raw, cwd = '') {
  const s = String(raw || '').trim();
  if (!s || isExternalUrl(s)) return s;
  if (s.startsWith('/')) {
    const normalized = s.replace(/\\/g, '/').replace(/\/+/g, '/');
    if (normalized.includes('/../')) return null;
    return normalized;
  }
  const base = String(cwd || '').trim().replace(/\\/g, '/').replace(/\/$/, '');
  if (!base) return s;
  const joined = `${base}/${s.replace(/^\.\//, '')}`.replace(/\/+/g, '/');
  if (joined.includes('/../')) return null;
  return joined;
}

export function workspaceFileApiUrl(conversation, filePath) {
  const conv = String(conversation || '').trim();
  const path = String(filePath || '').trim();
  if (!conv || !path) return '';
  const q = new URLSearchParams({ conversation: conv, path });
  return `/api/workspace/file?${q.toString()}`;
}

export function workspacePreviewApiUrl(conversation, filePath) {
  const conv = String(conversation || '').trim();
  const path = String(filePath || '').trim();
  if (!conv || !path) return '';
  const q = new URLSearchParams({ conversation: conv, path });
  return `/api/workspace/preview?${q.toString()}`;
}

/** Turn bare absolute file paths into markdown embeds (images / pdf / docx / xlsx links). */
/** True when tool/assistant output should render as markdown (tables, mermaid, images). */
export function looksLikeRichMarkdown(text) {
  const s = String(text || '');
  if (!s.trim()) return false;
  if (/^\s*\|.*\|/m.test(s)) return true;
  if (/```mermaid/i.test(s)) return true;
  if (/!\[[^\]]*\]\([^)]+\)/.test(s)) return true;
  if (/^File:\s*\/[^\s]+\.(?:png|jpe?g|gif|webp|svg|pdf|docx?|xlsx?|csv|zip|tar\.gz)/im.test(s)) return true;
  if (/^\/[^\s]+\.(?:png|jpe?g|gif|webp|svg|pdf|docx?|xlsx?|csv|zip|tar\.gz)$/im.test(s)) return true;
  return false;
}

const ABS_PATH = '(\\/[^\\s\\])>]+)';

export function enrichMarkdownMedia(markdown) {
  let out = String(markdown || '');
  if (!out.trim()) return out;

  out = out.replace(
    new RegExp(`^File:\\s*(${ABS_PATH}\\.(?:png|jpe?g|gif|webp|svg))$`, 'gim'),
    '![Generated image]($1)',
  );
  out = out.replace(
    new RegExp(`^File:\\s*(${ABS_PATH}\\.pdf)$`, 'gim'),
    '[📄 $1]($1)',
  );
  out = out.replace(
    new RegExp(`^File:\\s*(${ABS_PATH}\\.(?:docx?|odt))$`, 'gim'),
    '[📝 $1]($1)',
  );
  out = out.replace(
    new RegExp(`^File:\\s*(${ABS_PATH}\\.(?:xlsx?|csv|tsv|parquet))$`, 'gim'),
    '[📊 $1]($1)',
  );
  out = out.replace(
    new RegExp(`^File:\\s*(${ABS_PATH}\\.(?:zip|tar\\.gz|tgz|7z))$`, 'gim'),
    '[📦 $1]($1)',
  );
  out = out.replace(
    new RegExp(`^(${ABS_PATH}\\.(?:png|jpe?g|gif|webp|svg))$`, 'gim'),
    '![]($1)',
  );
  out = out.replace(
    new RegExp(`^(${ABS_PATH}\\.pdf)$`, 'gim'),
    '[📄 $1]($1)',
  );
  out = out.replace(
    new RegExp(`^(${ABS_PATH}\\.(?:docx?|odt))$`, 'gim'),
    '[📝 $1]($1)',
  );
  out = out.replace(
    new RegExp(`^(${ABS_PATH}\\.(?:xlsx?|csv|tsv|parquet))$`, 'gim'),
    '[📊 $1]($1)',
  );
  out = out.replace(
    new RegExp(`^(${ABS_PATH}\\.(?:zip|tar\\.gz|tgz|7z))$`, 'gim'),
    '[📦 $1]($1)',
  );
  return out;
}

export const RICH_MARKDOWN_FIXTURE = `## Livrable test

| Colonne A | Colonne B |
|-----------|-----------|
| Alpha     | 42        |
| Beta      | 99        |

\`\`\`mermaid
flowchart LR
  A[Texte] --> B[Voix]
  B --> C[Même bulle]
\`\`\`

![badge](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjAiIGhlaWdodD0iNDAiPjxyZWN0IGZpbGw9IiMwZWE1ZTkiIHdpZHRoPSIxMjAiIGhlaWdodD0iNDAiIHJ4PSI4Ii8+PHRleHQgeD0iNjAiIHk9IjI2IiBmaWxsPSIjMDIyYzIyIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaWplPSIxNCIgZm9udC13ZWlnaHQ9IjYwMCIgdGV4dC1hbmNob3I9Im1pZGRsZSI+S292WjwvdGV4dD48L3N2Zz4=)

`;
