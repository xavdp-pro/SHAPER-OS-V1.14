import { loadTimeline } from './timelineStore.js';
import { buildRollingContextPrefix } from '../../src/lib/runStream.js';

/**
 * Load server timeline and build a rolling prefix for stateless CLI models.
 * @param {string} conversationPath
 * @param {{ locale?: string, maxChars?: number, excludeLastHuman?: boolean }} [opts]
 */
export async function loadRollingContextPrefix(conversationPath, opts = {}) {
  const path = String(conversationPath || '').trim();
  if (!path) return { prefix: '', hadContext: false };
  try {
    const { items } = await loadTimeline(path);
    const prefix = buildRollingContextPrefix(items || [], opts);
    return { prefix, hadContext: Boolean(prefix) };
  } catch {
    return { prefix: '', hadContext: false };
  }
}
