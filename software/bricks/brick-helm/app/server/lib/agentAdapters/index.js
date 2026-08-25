import * as cursor from './cursor.js';
import * as agy from './agy.js';
import * as claude from './claude.js';
import * as opencode from './opencode.js';
import * as generic from './generic.js';

/** @type {Record<string, import('./types.js').AgentAdapter>} */
const REGISTRY = {
  cursor,
  agy,
  claude,
  opencode,
  generic,
};

/**
 * Resolve adapter for a plugin kind / id.
 * @param {string} [kindOrId]
 * @returns {import('./types.js').AgentAdapter}
 */
export function getAgentAdapter(kindOrId) {
  const key = String(kindOrId || 'generic').trim().toLowerCase();
  if (key.startsWith('agy') || key.startsWith('antigravity')) return agy;
  if (key.startsWith('cursor')) return cursor;
  if (key.startsWith('claude')) return claude;
  if (key.startsWith('opencode')) return opencode;
  return REGISTRY[key] || generic;
}

/**
 * @param {{ kind?: string, id?: string } | null | undefined} plugin
 */
export function getAdapterForPlugin(plugin) {
  return getAgentAdapter(plugin?.kind || plugin?.id || 'generic');
}

export function listAdapterKinds() {
  return Object.keys(REGISTRY);
}

export { cursor, agy, claude, opencode, generic };
