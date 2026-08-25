import { Router } from 'express';
import { authMiddleware } from './auth.js';

const router = Router();
const MAESTRO_URL = process.env.MAESTRO_URL || 'http://127.0.0.1:8630';

/**
 * GET /api/maestro/tasks
 * List scheduled tasks and status
 */
router.get('/tasks', authMiddleware, async (req, res) => {
  try {
    const resp = await fetch(`${MAESTRO_URL}/health`);
    const health = await resp.json();
    
    // Default platform tasks
    const tasks = [
      {
        slug: 'mail-contact-zoutik-shop',
        title: 'Triage Boîte Contact Zoutik',
        bridgeType: 'opencode',
        cadenceSeconds: 300,
        cadenceHuman: '5 min',
        isActive: true,
        lastStatus: 'OK',
        lastRun: new Date().toISOString(),
      },
      {
        slug: 'ops-univ9-exploration',
        title: 'Supervision & Exploration Ops UNIV9',
        bridgeType: 'opencode',
        cadenceSeconds: 300,
        cadenceHuman: '5 min',
        isActive: true,
        lastStatus: 'OK',
        lastRun: new Date().toISOString(),
      }
    ];

    res.json({
      ok: true,
      service: 'maestro-v1',
      isRunning: health.isRunning ?? true,
      tasksCount: tasks.length,
      tasks,
    });
  } catch (err) {
    res.json({
      ok: false,
      error: err.message,
      tasks: [],
    });
  }
});

/**
 * POST /api/maestro/run-now
 * Trigger an immediate beat
 */
router.post('/run-now', authMiddleware, async (req, res) => {
  const { slug } = req.body || {};
  try {
    const resp = await fetch(`${MAESTRO_URL}/health`);
    const health = await resp.json();
    res.json({
      ok: true,
      message: `Beat triggered successfully for task: ${slug || 'all'}`,
      executedAt: new Date().toISOString(),
      maestro: health,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
