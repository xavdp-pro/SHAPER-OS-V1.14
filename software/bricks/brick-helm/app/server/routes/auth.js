import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { findUserForAuth, getUser, touchLastLogin, updateUser, findDemoInviteBySlug } from '../lib/usersStore.js';
import { verifyPassword } from '../lib/password.js';
import { capitalizeSlug } from '../lib/demoGuests.js';

const router = Router();

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name || '',
    firstName: user.firstName || user.first_name || '',
    lastName: user.lastName || user.last_name || '',
    role: user.role || 'operator',
    briefing: user.briefing || '',
    preferredConversation: user.preferredConversation || '',
    demoSlug: user.demoSlug || '',
  };
}

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name || '',
      role: user.role || 'operator',
    },
    config.jwtSecret,
    { expiresIn: '7d' },
  );
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

export function authMiddleware(req, res, next) {
  const token = req.cookies?.ca_token || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, config.jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: 'Session expired' });
  }
}

/** Require active DB role=admin (JWT role alone is not enough). */
export async function adminMiddleware(req, res, next) {
  try {
    const user = await getUser(Number(req.user?.sub));
    if (!user || user.status !== 'active' || user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    req.dbUser = user;
    next();
  } catch (err) {
    console.error('[helm-v2] admin check', err);
    res.status(500).json({ error: 'Admin verification failed' });
  }
}

router.post('/login', async (req, res) => {
  const { email, password, login: loginId } = req.body || {};
  const identifier = String(email || loginId || '').trim();
  const plain = String(password || '');

  if (!identifier || !plain) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    // No credential fallback of any kind: authentication ALWAYS goes through
    // MariaDB. The demo operator is a real seeded row (see ensureUsersSchema,
    // APP_MODE=demo only), never a hardcoded branch. Rules 0G and 18.
    const user = await findUserForAuth(identifier).catch(() => null);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.status !== 'active' || !user.password_hash) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const ok = await verifyPassword(plain, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    await touchLastLogin(user.id).catch(() => null);
    const full = await getUser(user.id).catch(() => null);
    const token = signToken(full || user);
    res.cookie('ca_token', token, cookieOptions());
    res.json({
      ok: true,
      user: publicUser(full || user),
      token,
    });
  } catch (err) {
    console.error('[helm-v2] login', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/logout', (_req, res) => {
  res.clearCookie('ca_token', { path: '/', sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  res.json({ ok: true });
});

/**
 * Personalized demo invite — public.
 * GET /api/auth/demo-invite?user=ivonne
 */
router.get('/demo-invite', async (req, res) => {
  try {
    const slug = String(req.query.user || req.query.slug || '').trim();
    if (!slug) {
      return res.status(400).json({ ok: false, error: 'User parameter required' });
    }
    const invite = await findDemoInviteBySlug(slug).catch(() => null);
    if (!invite) {
      return res.status(404).json({ ok: false, error: 'Invitation not found' });
    }
    const greetName = invite.firstName || capitalizeSlug(invite.slug);
    res.json({
      ok: true,
      user: invite.slug,
      email: invite.email,
      password: invite.password,
      firstName: invite.firstName,
      lastName: invite.lastName,
      name: invite.name,
      greetName,
      conversation: invite.conversation,
    });
  } catch (err) {
    console.error('[helm-v2] demo-invite', err);
    res.status(500).json({ ok: false, error: 'Invitation unavailable' });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    // A valid JWT is not proof of an active account: the identity is confirmed
    // against MariaDB or the session is refused. No synthesized fallback user.
    const user = await getUser(Number(req.user.sub)).catch(() => null);
    if (!user || user.status !== 'active') {
      return res.status(401).json({ error: 'Invalid session' });
    }
    res.json({ ok: true, user: publicUser(user) });
  } catch (err) {
    console.error('[helm-v2] me', err);
    res.status(500).json({ error: 'Profile unavailable' });
  }
});

/** Self-update profile fields (name, briefing). */
router.patch('/me', authMiddleware, async (req, res) => {
  try {
    const id = Number(req.user.sub);
    const patch = {};
    if (req.body?.name != null) patch.name = req.body.name;
    if (req.body?.briefing != null) patch.briefing = req.body.briefing;
    if (!Object.keys(patch).length) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    const user = await updateUser(id, patch);
    if (!user || user.status !== 'active') {
      return res.status(404).json({ error: 'User not found' });
    }
    const token = signToken(user);
    res.cookie('ca_token', token, cookieOptions());
    res.json({ ok: true, user: publicUser(user), token });
  } catch (err) {
    if (err.code === 'VALIDATION') return res.status(400).json({ error: err.message });
    console.error('[helm-v2] patch me', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
