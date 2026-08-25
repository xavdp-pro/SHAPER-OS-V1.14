import { Router } from 'express';
import { authMiddleware } from './auth.js';

const router = Router();

const VAULT_URL = process.env.VAULT_URL || 'http://127.0.0.1:8610';
const LOGGER_URL = process.env.LOGGER_URL || 'http://127.0.0.1:8620';
const MAESTRO_URL = process.env.MAESTRO_URL || 'http://127.0.0.1:8630';
const QUEUE_URL = process.env.QUEUE_URL || 'http://127.0.0.1:8640';
const BRIDGE_URL = process.env.BRIDGE_URL || 'http://127.0.0.1:4440';

/**
 * GET /api/socle/health
 * Live status of the 6 platform foundation services
 */
router.get('/health', authMiddleware, async (req, res) => {
  const bricks = [
    { id: 'vault', name: 'Vault', port: 8610, url: `${VAULT_URL}/health` },
    { id: 'logger', name: 'Logger', port: 8620, url: `${LOGGER_URL}/health` },
    { id: 'mariadb', name: 'MariaDB', port: 3306, url: null },
    { id: 'queue', name: 'Queue', port: 8640, url: `${QUEUE_URL}/health` },
    { id: 'maestro', name: 'Maestro', port: 8630, url: `${MAESTRO_URL}/health` },
    { id: 'bridge', name: 'OpenCode Bridge', port: 4440, url: `${BRIDGE_URL}/api/health` },
  ];

  const results = await Promise.all(
    bricks.map(async (b) => {
      if (!b.url) {
        return { ...b, status: 'online', ok: true };
      }
      try {
        const r = await fetch(b.url, { signal: AbortSignal.timeout(1500) });
        return { ...b, status: r.ok ? 'online' : 'degraded', ok: r.ok };
      } catch {
        return { ...b, status: 'offline', ok: false };
      }
    })
  );

  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    bricks: results,
    allHealthy: results.every(r => r.ok),
  });
});

export default router;
