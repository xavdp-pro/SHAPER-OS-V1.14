import { Router } from 'express';
import { authMiddleware, adminMiddleware } from './auth.js';
import {
  createUser, deleteUser, getUser, listUsers, updateUser,
} from '../lib/usersStore.js';

const router = Router();

// Scope admin gate to /users only — never block sibling /api/* routers.
router.use('/users', authMiddleware, adminMiddleware);

router.get('/users', async (_req, res) => {
  try {
    const users = await listUsers();
    res.json({ ok: true, users });
  } catch (err) {
    console.error('[helm-v2] list users', err);
    res.status(500).json({ error: 'Users database unavailable', detail: err.message });
  }
});

router.get('/users/:id', async (req, res) => {
  try {
    const user = await getUser(Number(req.params.id));
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users', async (req, res) => {
  try {
    const user = await createUser(req.body || {});
    res.status(201).json({ ok: true, user });
  } catch (err) {
    if (err.code === 'VALIDATION') return res.status(400).json({ error: err.message });
    if (err.code === 'CONFLICT') return res.status(409).json({ error: err.message });
    console.error('[helm-v2] create user', err);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/users/:id', async (req, res) => {
  try {
    const user = await updateUser(Number(req.params.id), req.body || {});
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true, user });
  } catch (err) {
    if (err.code === 'VALIDATION') return res.status(400).json({ error: err.message });
    if (err.code === 'CONFLICT') return res.status(409).json({ error: err.message });
    console.error('[helm-v2] update user', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    const ok = await deleteUser(Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[helm-v2] delete user', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
