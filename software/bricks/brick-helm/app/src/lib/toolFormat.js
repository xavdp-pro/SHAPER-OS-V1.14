/** Normalizes tool name (Shell → shell). */
import { enrichMarkdownMedia } from './richContent.js';

export function normalizeToolName(tool) {
  const raw = String(tool || 'tool');
  return raw.charAt(0).toLowerCase() + raw.slice(1);
}

export function parseToolInput(input) {
  if (!input) return {};
  if (typeof input === 'object') return input;
  try {
    return JSON.parse(input);
  } catch {
    return { raw: String(input) };
  }
}

export function toolCommand(args) {
  return args.command || args.cmd || args.script || args.commandLine || '';
}

export function toolCwd(args) {
  return args.workingDirectory || args.cwd || args.working_directory || '';
}

export function toolFilePath(args) {
  return args.path || args.file || args.filepath || args.target || '';
}

/** True for shell / bash / terminal-style tools (or args that clearly carry a command). */
export function isShellTool(tool, input) {
  const name = normalizeToolName(tool);
  if (/^(shell|bash|terminal|runCommand|run_command|exec|command)$/i.test(name)) return true;
  return Boolean(toolCommand(parseToolInput(input)));
}

/** One-line summary for the header (IDE style). */
export function toolHeaderPreview(tool, input, extra = {}) {
  const name = normalizeToolName(tool);
  const args = parseToolInput(input);
  const cmd = extra.command || toolCommand(args);
  const cwd = extra.cwd || toolCwd(args);
  const path = toolFilePath(args);

  if (isShellTool(tool, input) && cmd) {
    const short = cmd.length > 56 ? `${cmd.slice(0, 56)}…` : cmd;
    return cwd ? `$ ${short}  ·  ${cwd}` : `$ ${short}`;
  }
  if ((name === 'read' || name === 'edit' || name === 'write') && path) {
    return `${name} ${path}`;
  }
  if (name === 'grep' && cmd) return `grep ${cmd}`;
  if (path) return `${name} ${path}`;
  return name;
}

function pickString(...values) {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '';
}

/** Format Cursor glob/grep structured payloads into readable text. */
function formatStructuredToolPayload(node) {
  if (!node || typeof node !== 'object') return '';

  const files = node.files ?? node.paths ?? node.filePaths ?? node.matches;
  if (Array.isArray(files) && files.length) {
    if (typeof files[0] === 'string') {
      return files.join('\n');
    }
    if (typeof files[0] === 'object' && files[0] != null) {
      return files.map((m) => {
        if (typeof m === 'string') return m;
        const path = m.path || m.file || m.filePath || m.uri || '';
        const line = m.line ?? m.lineText ?? m.content ?? m.text ?? '';
        const lineNo = m.lineNumber ?? m.line_number ?? m.ln;
        if (path && line) {
          return lineNo != null ? `${path}:${lineNo}: ${line}` : `${path}: ${line}`;
        }
        if (path) return String(path);
        return JSON.stringify(m);
      }).join('\n');
    }
  }

  if (typeof node.totalFiles === 'number' && node.totalFiles === 0) {
    return '(aucun fichier)';
  }

  const wrote = pickString(node.path, node.filePath);
  if (wrote && /wrote|created|updated/i.test(String(node.message || node.status || ''))) {
    return String(node.message || `Wrote contents to ${wrote}`);
  }

  return '';
}

function digToolText(node, depth = 0) {
  if (!node || depth > 8) return '';
  if (typeof node === 'string') return node.trim() ? node : '';
  if (typeof node !== 'object') return '';

  const structured = formatStructuredToolPayload(node);
  if (structured) return structured;

  const direct = pickString(
    node.stdout,
    node.stderr,
    node.interleavedOutput,
    node.output,
    node.content,
    node.text,
    node.message,
  );
  if (direct) return direct;

  if (Array.isArray(node.content)) {
    const joined = node.content
      .map((p) => (typeof p === 'string' ? p : digToolText(p, depth + 1)))
      .filter(Boolean)
      .join('\n');
    if (joined) return joined;
  }

  // Cursor shapes: result.success.stdout, result.failure, …
  for (const key of ['result', 'success', 'failure', 'value', 'data', 'payload', 'output']) {
    if (node[key] != null) {
      const nested = digToolText(node[key], depth + 1);
      if (nested) return nested;
    }
  }

  if (node.stdout != null || node.stderr != null) {
    const parts = [digToolText(node.stdout, depth + 1), digToolText(node.stderr, depth + 1)]
      .filter(Boolean);
    if (parts.length) return parts.join('\n');
  }

  return '';
}

/** Human hint when tool completed but no stdout was captured (glob/grep args). */
export function formatToolInputSummary(tool, input) {
  const name = normalizeToolName(tool);
  const args = parseToolInput(input);
  const path = toolFilePath(args);
  const pattern = args.pattern || args.globPattern || args.glob || args.query;
  const dir = args.targetDirectory || args.path || toolCwd(args);

  if (name === 'glob') {
    const pat = pattern || '**/*';
    return dir ? `glob ${pat}  ·  ${dir}` : `glob ${pat}`;
  }
  if (name === 'grep') {
    const pat = pattern || '?';
    return dir ? `grep /${pat}/  ·  ${dir}` : `grep /${pat}/`;
  }
  if (name === 'read' || name === 'edit' || name === 'write') {
    return path ? `${name} ${path}` : name;
  }
  const cmd = toolCommand(args);
  if (cmd) return cmd.length > 120 ? `${cmd.slice(0, 120)}…` : cmd;
  if (path) return `${name} ${path}`;
  return '';
}

/** Extracts text output from a completed tool_call node. */
export function extractToolOutput(node) {
  return digToolText(node);
}

/**
 * Prefer human stdout over raw tool_call JSON dumps.
 * Stored timelines often saved the whole `{ args, result: { success: { stdout }}}` blob.
 */
export function formatToolResultForDisplay(result, { tool = '', input = '' } = {}) {
  const raw = String(result || '');
  if (!raw.trim()) {
    return formatToolInputSummary(tool, input) || '';
  }

  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const obj = JSON.parse(trimmed);
      const dug = digToolText(obj);
      if (dug) return enrichMarkdownMedia(dug);
      // Args/metadata only — do not show JSON on mobile/chat.
      if (obj && typeof obj === 'object' && (obj.args || obj.parsingResult)) {
        return formatToolInputSummary(tool, input) || '';
      }
    } catch {
      /* keep raw prose */
    }
  }
  return enrichMarkdownMedia(raw);
}

/**
 * Human-readable tool result for the timeline.
 * Never dump raw tool_call JSON into the Terminal panel.
 */
export function toolResultFromEvent(event) {
  const tool = event.tool || '';
  const input = event.input || '';
  if (event.result != null) {
    if (typeof event.result === 'string') {
      return formatToolResultForDisplay(event.result, { tool, input }) || digToolText(
        (() => { try { return JSON.parse(event.result); } catch { return null; } })(),
      ) || formatToolInputSummary(tool, input);
    }
    return digToolText(event.result) || formatToolInputSummary(tool, input);
  }
  const tc = event.tool_call;
  if (!tc) return formatToolInputSummary(tool, input);
  const key = Object.keys(tc).find((k) => k.endsWith('ToolCall')) || Object.keys(tc)[0];
  const node = key ? tc[key] : null;
  return extractToolOutput(node) || extractToolOutput(tc) || formatToolInputSummary(tool, input);
}
