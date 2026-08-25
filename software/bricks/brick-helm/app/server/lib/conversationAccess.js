import { getUser } from './usersStore.js';
import { capitalizeSlug } from './demoGuests.js';
import { conversationKey, cliNodes } from './bridgeClient.js';
import { config, resolveSessionWorkspace } from '../config.js';

/**
 * Resolve the single conversation name a non-admin user is bound to.
 * Admins / unbound users → null (no restriction).
 */
export function resolveScopedConversationName(user) {
  if (!user || user.role === 'admin') return null;
  const preferred = String(user.preferredConversation || '').trim();
  if (preferred) return preferred;
  const slug = String(user.demoSlug || '').trim();
  if (slug) return capitalizeSlug(slug);
  return null;
}

/** Match full path (node/user/Name) or bare name against a scoped conversation name. */
export function conversationMatchesScope(pathOrName, scopedName) {
  if (!scopedName) return true;
  const raw = String(pathOrName || '').trim();
  if (!raw) return false;
  if (raw === scopedName) return true;
  if (raw.endsWith(`/${scopedName}`)) return true;
  const parts = raw.split(/[/:]/).filter(Boolean);
  return parts[parts.length - 1] === scopedName;
}

export function filterConversationsByScope(conversations, scopedName) {
  if (!scopedName) return conversations;
  return (conversations || []).filter((c) => (
    conversationMatchesScope(c.path || c.id || c.name, scopedName)
  ));
}

/** Ensure scoped users always see their conversation even if bridge has not registered it yet. */
export function ensureScopedConversationListed(conversations, scopedName, nodes = []) {
  if (!scopedName) return conversations;
  const list = Array.isArray(conversations) ? [...conversations] : [];
  if (list.some((c) => conversationMatchesScope(c.path || c.id || c.name, scopedName))) {
    return list;
  }
  const node = nodes[0] || cliNodes()?.[0] || { name: 'cursor', user: config.cli?.defaultUser || 'zaza' };
  const user = node.user || config.cli?.defaultUser || 'zaza';
  const path = conversationKey(node.name, user, scopedName);
  const cwd = resolveSessionWorkspace(scopedName, node.name);
  list.unshift({
    id: path,
    path,
    name: scopedName,
    title: scopedName,
    node: node.name,
    user,
    cwd,
    port: 4200,
    scoped: true,
  });
  return list;
}

/**
 * Load DB user and enforce conversation access.
 * @returns {{ user, scopedName }}
 */
export async function assertConversationAccess(req, conversation) {
  // Never synthesize a user from token claims: on a DB outage that would drop
  // conversation scoping and let one demo guest reach another's timeline.
  // MariaDB confirms the identity, or access is refused.
  const user = await getUser(Number(req.user?.sub)).catch(() => null);
  if (!user || user.status !== 'active') {
    const err = new Error('Session invalide');
    err.status = 401;
    throw err;
  }
  const scopedName = resolveScopedConversationName(user);
  if (scopedName && !conversationMatchesScope(conversation, scopedName)) {
    const err = new Error('Accès refusé à cette conversation');
    err.status = 403;
    throw err;
  }
  return { user, scopedName };
}

/** Express-friendly: run assert and send response on failure. Returns null if denied. */
export async function guardConversation(req, res, conversation) {
  try {
    return await assertConversationAccess(req, conversation);
  } catch (err) {
    const status = Number(err.status) || 500;
    res.status(status).json({ ok: false, error: err.message || 'Accès refusé' });
    return null;
  }
}
