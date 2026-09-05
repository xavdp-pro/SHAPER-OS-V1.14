/**
 * Snapshot operator-configured context where its file actually exists.
 * A path in maestro's container is not a path in a remote bridge's container.
 * This module reads configuration, never a filename inferred from user material.
 * Intent: software/packages/pkg-agent-runtime/INTENT.md
 */
import fs from 'node:fs';

export function readTaskContext({ contextPath = null, contextText = null } = {}) {
  const parts = [];
  if (contextPath) {
    if (typeof contextPath !== 'string') throw new Error('contextPath must be a file path');
    const text = fs.readFileSync(contextPath, 'utf8');
    if (!text.trim()) throw new Error(`Declared context file is empty: ${contextPath}`);
    parts.push(text);
  }
  if (contextText != null) {
    if (typeof contextText !== 'string') throw new Error('contextText must be text');
    if (contextText.trim()) parts.push(contextText);
  }
  return parts.length ? parts.join('\n\n') : null;
}
