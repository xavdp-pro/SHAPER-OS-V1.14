import { query } from './db.js';

/** Sanitize a CLI conversation name (bridge last segment). */
export function sanitizeConversationName(raw) {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[/:\\]+/g, '-')
    .replace(/[^a-zA-Z0-9._\-\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.\-]+|[.\-]+$/g, '')
    .slice(0, 80);
  if (!cleaned) return '';
  // Prefer Title case for single token (Ivonne, Xavier, Demo).
  if (!cleaned.includes('-') && !cleaned.includes('.')) {
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  return cleaned;
}

/** URL slug for ?user=… invite links. */
export function sanitizeDemoSlug(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 64);
}

/** Derive a base conversation label from profile fields. */
export function suggestConversationBase({
  conversation,
  firstName,
  name,
  email,
  slug,
} = {}) {
  const fromExplicit = sanitizeConversationName(conversation);
  if (fromExplicit) return fromExplicit;

  const fromFirst = sanitizeConversationName(firstName);
  if (fromFirst) return fromFirst;

  const fromName = sanitizeConversationName(String(name || '').trim().split(/\s+/)[0]);
  if (fromName) return fromName;

  const fromSlug = sanitizeConversationName(slug);
  if (fromSlug) return fromSlug;

  const local = String(email || '').split('@')[0] || '';
  const fromEmail = sanitizeConversationName(local);
  if (fromEmail) return fromEmail;

  return 'User';
}

export function suggestDemoSlug({ slug, conversation, firstName, name, email } = {}) {
  const fromExplicit = sanitizeDemoSlug(slug);
  if (fromExplicit) return fromExplicit;

  const fromConv = sanitizeDemoSlug(conversation);
  if (fromConv) return fromConv;

  const fromFirst = sanitizeDemoSlug(firstName);
  if (fromFirst) return fromFirst;

  const fromName = sanitizeDemoSlug(String(name || '').trim().split(/\s+/)[0]);
  if (fromName) return fromName;

  const local = String(email || '').split('@')[0] || '';
  return sanitizeDemoSlug(local) || 'user';
}

async function listTakenConversations(excludeUserId = null) {
  const rows = excludeUserId
    ? await query(
      `SELECT id, demo_conversation AS v FROM users
       WHERE demo_conversation IS NOT NULL AND demo_conversation <> '' AND id <> ?`,
      [excludeUserId],
    )
    : await query(
      `SELECT id, demo_conversation AS v FROM users
       WHERE demo_conversation IS NOT NULL AND demo_conversation <> ''`,
    );
  return new Set(rows.map((r) => String(r.v).toLowerCase()));
}

async function listTakenSlugs(excludeUserId = null) {
  const rows = excludeUserId
    ? await query(
      `SELECT id, demo_slug AS v FROM users
       WHERE demo_slug IS NOT NULL AND demo_slug <> '' AND id <> ?`,
      [excludeUserId],
    )
    : await query(
      `SELECT id, demo_slug AS v FROM users
       WHERE demo_slug IS NOT NULL AND demo_slug <> ''`,
    );
  return new Set(rows.map((r) => String(r.v).toLowerCase()));
}

/**
 * Allocate a unique conversation name for a user.
 * Never reuses another user's demo_conversation.
 */
export async function allocateUniqueConversation(input = {}, { excludeUserId = null } = {}) {
  const base = suggestConversationBase(input) || 'User';
  const taken = await listTakenConversations(excludeUserId);
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; i < 500; i += 1) {
    const candidate = sanitizeConversationName(`${base}${i}`) || `${base}${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  const fallback = sanitizeConversationName(`${base}-${Date.now().toString(36)}`);
  return fallback || `User-${Date.now().toString(36)}`;
}

/** Allocate a unique invite slug (?user=slug). */
export async function allocateUniqueDemoSlug(input = {}, { excludeUserId = null } = {}) {
  const base = suggestDemoSlug(input) || 'user';
  const taken = await listTakenSlugs(excludeUserId);
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; i < 500; i += 1) {
    const candidate = sanitizeDemoSlug(`${base}${i}`) || `${base}${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return sanitizeDemoSlug(`${base}-${Date.now().toString(36)}`) || `user-${Date.now().toString(36)}`;
}

/**
 * Backfill: every user without demo_conversation gets a unique one.
 * Optionally assigns a demo_slug when missing (for invite links).
 */
export async function ensureAllUsersHaveConversations() {
  const rows = await query(
    `SELECT id, email, name, first_name, demo_slug, demo_conversation
     FROM users ORDER BY id ASC`,
  );
  for (const row of rows) {
    const hasConv = String(row.demo_conversation || '').trim();
    if (hasConv) continue;
    const conversation = await allocateUniqueConversation({
      firstName: row.first_name,
      name: row.name,
      email: row.email,
      slug: row.demo_slug,
    }, { excludeUserId: row.id });
    await query('UPDATE users SET demo_conversation = ? WHERE id = ?', [
      conversation,
      row.id,
    ]);
  }
}
