import { ensureUsersSchema, query } from './db.js';
import { hashPassword } from './password.js';
import {
  allocateUniqueConversation,
  allocateUniqueDemoSlug,
  sanitizeConversationName,
  sanitizeDemoSlug,
} from './userSession.js';

let ready = false;

const USER_SELECT = `id, email, name, first_name, last_name, role, status, notes, briefing,
            demo_slug, demo_conversation, password_hash, magic_token_hash,
            (demo_password IS NOT NULL AND demo_password <> '') AS has_demo_password,
            last_login_at, created_at, updated_at`;

async function readyDb() {
  if (!ready) {
    try {
      await ensureUsersSchema();
      ready = true;
    } catch {
      // Standalone mode without external MariaDB
    }
  }
}

function mapUser(row) {
  if (!row) return null;
  const firstName = row.first_name || '';
  const lastName = row.last_name || '';
  const demoSlug = row.demo_slug || '';
  const preferredConversation = row.demo_conversation || '';
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    firstName,
    lastName,
    first_name: firstName,
    last_name: lastName,
    role: row.role,
    status: row.status,
    notes: row.notes || '',
    briefing: row.briefing || '',
    demoSlug,
    preferredConversation,
    inviteReady: Boolean(demoSlug && row.has_demo_password),
    last_login_at: row.last_login_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    has_password: Boolean(row.password_hash),
    magic_pending: Boolean(row.magic_token_hash),
  };
}

export async function listUsers() {
  await readyDb();
  const rows = await query(
    `SELECT ${USER_SELECT} FROM users ORDER BY id ASC`,
  );
  return rows.map(mapUser);
}

export async function getUser(id) {
  await readyDb();
  const rows = await query(
    `SELECT ${USER_SELECT} FROM users WHERE id = ? LIMIT 1`,
    [id],
  );
  return mapUser(rows[0]);
}

/**
 * Public demo-invite lookup by ?user=slug (returns autofill credentials).
 * Never expose admin accounts.
 */
export async function findDemoInviteBySlug(slug) {
  await readyDb();
  const key = String(slug || '').trim().toLowerCase();
  if (!key || !/^[a-z0-9][a-z0-9_-]{0,62}$/i.test(key)) return null;
  const rows = await query(
    `SELECT id, email, name, first_name, last_name, role, status,
            demo_slug, demo_password, demo_conversation
     FROM users
     WHERE demo_slug = ? AND status = 'active' AND role <> 'admin'
     LIMIT 1`,
    [key],
  );
  const row = rows[0];
  if (!row?.demo_password || !row?.email) return null;
  return {
    email: row.email,
    password: row.demo_password,
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    name: row.name || '',
    slug: row.demo_slug,
    conversation: row.demo_conversation || '',
  };
}

/** Internal row with password_hash for login (not for API responses). */
export async function findUserForAuth(identifier) {
  await readyDb();
  const raw = String(identifier || '').trim();
  if (!raw) return null;

  const email = raw.toLowerCase();
  if (email.includes('@')) {
    const rows = await query(
      `SELECT id, email, name, role, status, password_hash
       FROM users WHERE email = ? LIMIT 1`,
      [email],
    );
    return rows[0] || null;
  }

  const byName = await query(
    `SELECT id, email, name, role, status, password_hash
     FROM users WHERE LOWER(name) = LOWER(?) LIMIT 1`,
    [raw],
  );
  if (byName[0]) return byName[0];

  // Allow typing local-part of demo email without @domain
  const asEmail = `${email}@helm.local`;
  const rows = await query(
    `SELECT id, email, name, role, status, password_hash
     FROM users WHERE email = ? LIMIT 1`,
    [asEmail],
  );
  return rows[0] || null;
}

export async function touchLastLogin(id) {
  await readyDb();
  await query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [id]);
}

/**
 * Create a user with a dedicated CLI conversation (always unique).
 * Optional demoSlug + password → personalized invite ?user=<slug>.
 */
export async function createUser({
  email,
  name = '',
  firstName = '',
  lastName = '',
  role = 'operator',
  status = 'active',
  notes = '',
  briefing = '',
  password = '',
  preferredConversation = '',
  conversation = '',
  demoSlug = '',
  demo_slug: demoSlugAlt = '',
} = {}) {
  await readyDb();
  const e = String(email || '').trim().toLowerCase();
  if (!e || !e.includes('@')) {
    const err = new Error('Invalid email');
    err.code = 'VALIDATION';
    throw err;
  }
  const r = ['admin', 'operator', 'viewer'].includes(role) ? role : 'operator';
  const s = ['active', 'disabled', 'pending'].includes(status) ? status : 'active';
  const displayName = String(name || '').trim();
  const fn = String(firstName || '').trim() || displayName.split(/\s+/)[0] || '';
  const ln = String(lastName || '').trim();
  const plainPassword = String(password || '').trim();
  const passwordHash = plainPassword ? await hashPassword(plainPassword) : null;
  const brief = String(briefing || '').trim() || null;

  const conversationName = await allocateUniqueConversation({
    conversation: preferredConversation || conversation,
    firstName: fn,
    name: displayName,
    email: e,
    slug: demoSlug || demoSlugAlt,
  });

  let slug = sanitizeDemoSlug(demoSlug || demoSlugAlt);
  // Non-admin users get an invite slug by default (unique).
  if (!slug && r !== 'admin') {
    slug = await allocateUniqueDemoSlug({
      conversation: conversationName,
      firstName: fn,
      name: displayName,
      email: e,
    });
  } else if (slug) {
    slug = await allocateUniqueDemoSlug({ slug }, {});
  } else {
    slug = null;
  }

  // Invite autofill password (non-admin only).
  const demoPassword = (r !== 'admin' && plainPassword) ? plainPassword : null;

  try {
    const result = await query(
      `INSERT INTO users (
         email, name, first_name, last_name, role, status, notes, briefing,
         password_hash, demo_slug, demo_password, demo_conversation
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        e,
        displayName,
        fn || null,
        ln || null,
        r,
        s,
        String(notes || '').trim() || null,
        brief,
        passwordHash,
        slug,
        demoPassword,
        conversationName,
      ],
    );
    const insertId = result?.insertId;
    return getUser(insertId);
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') {
      const msg = String(err.message || '');
      const e2 = new Error(
        msg.includes('demo_slug') ? 'Demo slug already in use' : 'Email already in use',
      );
      e2.code = 'CONFLICT';
      throw e2;
    }
    throw err;
  }
}

export async function updateUser(id, patch = {}) {
  await readyDb();
  const current = await getUser(id);
  if (!current) return null;

  const email = patch.email != null
    ? String(patch.email).trim().toLowerCase()
    : current.email;
  const name = patch.name != null ? String(patch.name).trim() : current.name;
  const firstName = patch.firstName != null
    ? String(patch.firstName).trim()
    : (patch.first_name != null ? String(patch.first_name).trim() : current.firstName);
  const lastName = patch.lastName != null
    ? String(patch.lastName).trim()
    : (patch.last_name != null ? String(patch.last_name).trim() : current.lastName);
  const role = patch.role != null && ['admin', 'operator', 'viewer'].includes(patch.role)
    ? patch.role
    : current.role;
  const status = patch.status != null && ['active', 'disabled', 'pending'].includes(patch.status)
    ? patch.status
    : current.status;
  const notes = patch.notes != null ? String(patch.notes).trim() : current.notes;
  const briefing = patch.briefing != null
    ? String(patch.briefing).trim()
    : current.briefing;

  if (!email || !email.includes('@')) {
    const err = new Error('Invalid email');
    err.code = 'VALIDATION';
    throw err;
  }

  const password = patch.password != null ? String(patch.password).trim() : '';
  const passwordHash = password ? await hashPassword(password) : null;

  let conversation = current.preferredConversation;
  if (
    patch.preferredConversation != null
    || patch.conversation != null
    || patch.demo_conversation != null
  ) {
    const wanted = sanitizeConversationName(
      patch.preferredConversation ?? patch.conversation ?? patch.demo_conversation,
    );
    conversation = wanted
      ? await allocateUniqueConversation(
        { conversation: wanted, firstName, name, email },
        { excludeUserId: id },
      )
      : await allocateUniqueConversation(
        { firstName, name, email, slug: current.demoSlug },
        { excludeUserId: id },
      );
  } else if (!conversation) {
    conversation = await allocateUniqueConversation(
      { firstName, name, email, slug: current.demoSlug },
      { excludeUserId: id },
    );
  }

  let slug = current.demoSlug || null;
  if (patch.demoSlug != null || patch.demo_slug != null) {
    const wanted = sanitizeDemoSlug(patch.demoSlug ?? patch.demo_slug);
    slug = wanted
      ? await allocateUniqueDemoSlug({ slug: wanted }, { excludeUserId: id })
      : null;
  } else if (!slug && role !== 'admin') {
    slug = await allocateUniqueDemoSlug(
      { conversation, firstName, name, email },
      { excludeUserId: id },
    );
  }

  const sets = [
    'email = ?', 'name = ?', 'first_name = ?', 'last_name = ?',
    'role = ?', 'status = ?', 'notes = ?', 'briefing = ?',
    'demo_conversation = ?', 'demo_slug = ?',
  ];
  const params = [
    email, name, firstName || null, lastName || null,
    role, status, notes || null, briefing || null,
    conversation || null, slug,
  ];

  if (passwordHash) {
    sets.push('password_hash = ?');
    params.push(passwordHash);
    // Keep invite autofill in sync for non-admin.
    if (role !== 'admin') {
      sets.push('demo_password = ?');
      params.push(password);
    }
  }

  params.push(id);

  try {
    await query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') {
      const msg = String(err.message || '');
      const e2 = new Error(
        msg.includes('demo_slug') ? 'Demo slug already in use' : 'Email already in use',
      );
      e2.code = 'CONFLICT';
      throw e2;
    }
    throw err;
  }
  return getUser(id);
}

export async function deleteUser(id) {
  await readyDb();
  const current = await getUser(id);
  if (!current) return false;
  await query('DELETE FROM users WHERE id = ?', [id]);
  return true;
}
