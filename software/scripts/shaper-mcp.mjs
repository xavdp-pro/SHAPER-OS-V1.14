// ==============================================================================
// SHAPER OS — Sovereign MCP Client & System SDK (Pure Node.js / Zero External Deps)
// ==============================================================================

export const VAULT_URL = process.env.VAULT_URL || 'http://127.0.0.1:8610';
export const VAULT_TOKEN = process.env.VAULT_TOKEN || '';
export const LOGGER_URL = process.env.LOGGER_URL || 'http://127.0.0.1:8620';
export const QUEUE_URL = process.env.QUEUE_URL || 'http://127.0.0.1:8640';
export const GED_URL = process.env.GED_URL || 'http://127.0.0.1:8660';
export const MAESTRO_URL = process.env.MAESTRO_URL || 'http://127.0.0.1:8530';
export const QDRANT_URL = process.env.QDRANT_URL || 'http://127.0.0.1:6333';

/**
 * 🔐 Vault Client (AES-256-GCM Encrypted Secrets)
 */
export const vault = {
  async get(key) {
    const res = await fetch(`${VAULT_URL}/api/secret/${key}`, {
      headers: { Authorization: `Bearer ${VAULT_TOKEN}` },
    });
    if (!res.ok) throw new Error(`Vault GET /api/secret/${key} failed (${res.status})`);
    return res.json();
  },

  async set(key, value) {
    const res = await fetch(`${VAULT_URL}/api/secret/${key}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${VAULT_TOKEN}`,
      },
      body: JSON.stringify(value),
    });
    if (!res.ok) throw new Error(`Vault POST /api/secret/${key} failed (${res.status})`);
    return res.json();
  },

  async list() {
    const res = await fetch(`${VAULT_URL}/api/secrets`, {
      headers: { Authorization: `Bearer ${VAULT_TOKEN}` },
    });
    if (!res.ok) throw new Error(`Vault GET /api/secrets failed (${res.status})`);
    return res.json();
  },

  async del(key) {
    const res = await fetch(`${VAULT_URL}/api/secret/${key}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${VAULT_TOKEN}` },
    });
    return res.json();
  },
};

/**
 * 📜 Logger Client (JSONL Audit Ingestion & SSE)
 */
export const logger = {
  async log(level, message, meta = {}) {
    const res = await fetch(`${LOGGER_URL}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: message,
        level,
        meta,
        timestamp: new Date().toISOString(),
      }),
    });
    return res.json();
  },

  info: (msg, meta) => logger.log('info', msg, meta),
  warn: (msg, meta) => logger.log('warn', msg, meta),
  error: (msg, meta) => logger.log('error', msg, meta),

  async getLast(n = 20) {
    const res = await fetch(`${LOGGER_URL}/api/events/last?n=${n}`);
    return res.json();
  },
};

/**
 * 📬 Queue Client (Async Job FIFO Engine)
 */
export const queue = {
  async push(type, payload = {}) {
    const res = await fetch(`${QUEUE_URL}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, payload }),
    });
    return res.json();
  },

  async get(jobId) {
    const res = await fetch(`${QUEUE_URL}/api/jobs/${jobId}`);
    return res.json();
  },
};

/**
 * 📂 GED Client (Sovereign Document Hub)
 */
export const ged = {
  async getHealth() {
    const res = await fetch(`${GED_URL}/api/health`);
    return res.json();
  },
};

/**
 * 🎼 Maestro Client (Cluster Orchestration)
 */
export const maestro = {
  async getStatus() {
    const res = await fetch(`${MAESTRO_URL}/api/health`);
    return res.json();
  },
};
