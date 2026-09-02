/**
 * @file index.js
 * @package @shaper/pkg-vault-engine
 * @description Sovereign AES-256-GCM encrypted secret engine and REST server for Podman.
 * Zero external dependencies — uses only node:crypto and node:http.
 */

import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard GCM IV length (96 bits)
const AUTH_TAG_LENGTH = 16; // Standard GCM Auth Tag (128 bits)

/**
 * Derives a 256-bit (32-byte) key from a string or raw key.
 * @param {string|Buffer} keySource 
 * @returns {Buffer}
 */
export function normalizeMasterKey(keySource) {
  if (!keySource) {
    throw new Error('Vault master key is required.');
  }
  if (Buffer.isBuffer(keySource) && keySource.length === 32) {
    return keySource;
  }
  const str = String(keySource).trim();
  // If valid 64-char hex (32 bytes)
  if (/^[0-9a-fA-F]{64}$/.test(str)) {
    return Buffer.from(str, 'hex');
  }
  // Otherwise SHA-256 derivation
  return crypto.createHash('sha256').update(str).digest();
}

/**
 * Encrypts a payload (object or string) with AES-256-GCM.
 * @param {object|string} payload 
 * @param {string|Buffer} masterKey 
 * @returns {{ iv: string, authTag: string, ciphertext: string }}
 */
export function encryptSecret(payload, masterKey) {
  const key = normalizeMasterKey(masterKey);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return {
    iv: iv.toString('hex'),
    authTag,
    ciphertext: encrypted
  };
}

/**
 * Decrypts an AES-256-GCM encrypted secret and parses JSON if applicable.
 * @param {{ iv: string, authTag: string, ciphertext: string }} record 
 * @param {string|Buffer} masterKey 
 * @returns {object|string}
 */
export function decryptSecret(record, masterKey) {
  if (!record || !record.iv || !record.authTag || !record.ciphertext) {
    throw new Error('Invalid encrypted record structure (missing iv, authTag, or ciphertext).');
  }
  const key = normalizeMasterKey(masterKey);
  const iv = Buffer.from(record.iv, 'hex');
  const authTag = Buffer.from(record.authTag, 'hex');
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(record.ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  try {
    return JSON.parse(decrypted);
  } catch {
    return decrypted;
  }
}

/**
 * Validates a Mailbox configuration object against GBS standard (MAIL-AGENT-SOCLE-SPEC §4).
 * @param {object} data 
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateMailboxSchema(data) {
  const errors = [];
  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Configuration must be a non-null object.'] };
  }

  if (!data.slug || typeof data.slug !== 'string') errors.push('Field "slug" is required (string).');
  if (!data.provider || !['ovh-zimbra', 'google', 'microsoft365', 'generic-imap'].includes(data.provider)) {
    errors.push('Field "provider" must be one of: ovh-zimbra, google, microsoft365, generic-imap.');
  }

  // IMAP validation
  if (!data.imap || typeof data.imap !== 'object') {
    errors.push('Field "imap" object is required.');
  } else {
    if (!data.imap.host) errors.push('imap.host is required.');
    if (!data.imap.port || typeof data.imap.port !== 'number') errors.push('imap.port must be an integer.');
    if (!data.imap.user) errors.push('imap.user is required.');
    if (!data.imap.pass) errors.push('imap.pass is required.');
  }

  // SMTP validation
  if (!data.smtp || typeof data.smtp !== 'object') {
    errors.push('Field "smtp" object is required.');
  } else {
    if (!data.smtp.host) errors.push('smtp.host is required.');
    if (!data.smtp.port || typeof data.smtp.port !== 'number') errors.push('smtp.port must be an integer.');
    if (!data.smtp.user) errors.push('smtp.user is required.');
    if (!data.smtp.pass) errors.push('smtp.pass is required.');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

import { vitals, ageSeconds, writable } from '../pkg-logger/vitals.js';

/**
 * Encrypted persistent storage manager.
 */
export class VaultStore {
  /**
   * @param {object} options
   * @param {string|Buffer} options.masterKey - Master encryption key
   * @param {string} [options.storageFile] - Path to persistent JSON storage file
   */
  constructor({ masterKey, storageFile = null }) {
    this.masterKey = normalizeMasterKey(masterKey);
    this.storageFile = storageFile;
    /** @type {Map<string, { iv: string, authTag: string, ciphertext: string, updatedAt: string }>} */
    this.entries = new Map();
    this.startedAt = new Date().toISOString();
    this.lastDecryptAt = null;
    this.lastWriteAt = null;
    this.init();
  }

  init() {
    if (this.storageFile && fs.existsSync(this.storageFile)) {
      try {
        // Repair stores created by older releases before reading any secret
        // metadata from them.
        fs.chmodSync(this.storageFile, 0o600);
        const raw = fs.readFileSync(this.storageFile, 'utf8');
        const data = JSON.parse(raw);
        if (data && typeof data === 'object') {
          for (const [key, val] of Object.entries(data)) {
            if (val && val.ciphertext) {
              this.entries.set(key, val);
            }
          }
        }
      } catch (err) {
        console.error(`[VaultStore] Error loading storage file: ${err.message}`);
      }
    }
  }

  persist() {
    if (!this.storageFile) return;
    try {
      const dir = path.dirname(this.storageFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = Object.fromEntries(this.entries);
      fs.writeFileSync(this.storageFile, JSON.stringify(data, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
      });
      // `mode` only applies when writeFileSync creates the file. Enforce the
      // invariant after every persistence so a pre-existing file with broader
      // permissions is repaired as well.
      fs.chmodSync(this.storageFile, 0o600);
    } catch (err) {
      console.error(`[VaultStore] Error persisting storage file: ${err.message}`);
    }
  }

  async vitals(now = Date.now()) {
    const storageCheck = await writable(fs, this.storageFile ? path.dirname(this.storageFile) : null);
    return vitals({
      service: 'brick-vault',
      startedAt: this.startedAt,
      signals: {
        secretsHeld: this.entries.size,
        lastSuccessfulDecryptAgeSeconds: ageSeconds(this.lastDecryptAt, now),
        lastWriteAgeSeconds: ageSeconds(this.lastWriteAt, now),
      },
      checks: {
        storage: storageCheck,
      },
    }, now);
  }

  /**
   * Stores a secret under a key (e.g. "secret/mail/contact-zoutik" or "mailbox-contact-zoutik").
   * @param {string} key 
   * @param {object|string} payload 
   */
  setSecret(key, payload) {
    if (!key) throw new Error('Secret key is required.');
    
    // Normalize key
    const normalizedKey = key.startsWith('/') ? key.slice(1) : key;
    
    // If it is a mail secret, optional validation
    if (normalizedKey.startsWith('secret/mail/') || normalizedKey.startsWith('mailbox-')) {
      const validation = validateMailboxSchema(payload);
      if (!validation.valid && typeof payload === 'object' && payload.provider) {
        throw new Error(`Mailbox schema validation failed: ${validation.errors.join(', ')}`);
      }
    }

    const encrypted = encryptSecret(payload, this.masterKey);
    this.entries.set(normalizedKey, {
      ...encrypted,
      updatedAt: new Date().toISOString()
    });
    this.lastWriteAt = new Date().toISOString();
    this.persist();
    return true;
  }

  /**
   * Retrieves and decrypts a secret.
   * @param {string} key 
   * @returns {object|string|null}
   */
  getSecret(key) {
    if (!key) return null;
    const normalizedKey = key.startsWith('/') ? key.slice(1) : key;
    const record = this.entries.get(normalizedKey);
    if (!record) return null;
    const decrypted = decryptSecret(record, this.masterKey);
    if (decrypted !== null && decrypted !== undefined) {
      this.lastDecryptAt = new Date().toISOString();
    }
    return decrypted;
  }

  /**
   * Deletes a secret.
   * @param {string} key 
   * @returns {boolean}
   */
  deleteSecret(key) {
    if (!key) return false;
    const normalizedKey = key.startsWith('/') ? key.slice(1) : key;
    const deleted = this.entries.delete(normalizedKey);
    if (deleted) this.persist();
    return deleted;
  }

  /**
   * Lists registered keys (without sensitive metadata or content).
   * @returns {string[]}
   */
  listKeys() {
    return Array.from(this.entries.keys());
  }
}

/**
 * HTTP client for consuming a remote or local Vault server.
 */
export class VaultClient {
  /**
   * @param {object} options
   * @param {string} options.vaultUrl - Vault server URL (e.g. "http://127.0.0.1:8610")
   * @param {string} [options.vaultToken] - Authentication Bearer token
   */
  constructor({ vaultUrl = 'http://127.0.0.1:8610', vaultToken = null } = {}) {
    this.vaultUrl = vaultUrl.replace(/\/+$/, '');
    this.vaultToken = vaultToken;
  }

  async _request(endpoint, { method = 'GET', body = null } = {}) {
    const url = `${this.vaultUrl}${endpoint}`;
    const headers = { 'Accept': 'application/json' };
    if (this.vaultToken) {
      headers['Authorization'] = `Bearer ${this.vaultToken}`;
    }
    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Vault request failed [${res.status} ${res.statusText}]: ${errText}`);
    }

    return await res.json();
  }

  async health() {
    return this._request('/api/health');
  }

  async vitals() {
    return this._request('/api/vitals');
  }

  async listSecrets() {
    const res = await this._request('/api/secrets');
    return res.keys || [];
  }

  async getSecret(pathOrKey) {
    const cleanKey = pathOrKey.startsWith('/') ? pathOrKey.slice(1) : pathOrKey;
    try {
      const res = await this._request(`/api/secret/${cleanKey}`);
      return res.data;
    } catch (err) {
      if (err.message.includes('404')) return null;
      throw err;
    }
  }

  async setSecret(pathOrKey, payload) {
    const cleanKey = pathOrKey.startsWith('/') ? pathOrKey.slice(1) : pathOrKey;
    return this._request(`/api/secret/${cleanKey}`, {
      method: 'POST',
      body: { data: payload }
    });
  }

  async deleteSecret(pathOrKey) {
    const cleanKey = pathOrKey.startsWith('/') ? pathOrKey.slice(1) : pathOrKey;
    return this._request(`/api/secret/${cleanKey}`, { method: 'DELETE' });
  }
}

/**
 * Creates and starts an HTTP REST server for Vault.
 * @param {object} options
 * @param {number} [options.port=8610]
 * @param {string} [options.host='0.0.0.0']
 * @param {string|Buffer} options.masterKey
 * @param {string} [options.vaultToken]
 * @param {string} [options.storageFile]
 * @param {VaultStore} [options.vaultStore]
 * @returns {http.Server}
 */
export function createVaultServer({
  port = 8610,
  host = '0.0.0.0',
  masterKey = null,
  vaultToken = null,
  storageFile = null,
  vaultStore = null
} = {}) {
  if (!vaultStore && !(typeof masterKey === 'string' && masterKey.trim())) {
    // A vault encrypted with a key published in this repository is not encrypted.
    // There is no default and there is no "change it later" (Rule 0B, Rule 0G).
    throw new Error(
      'VAULT_MASTER_KEY is required: no master key was supplied. This repository '
      + 'ships no default key — generate one with `openssl rand -hex 32` and pass '
      + 'it in the environment. It is never written to a tracked file.',
    );
  }
  const store = vaultStore || new VaultStore({ masterKey, storageFile });

  const server = http.createServer(async (req, res) => {
    const sendJson = (statusCode, data) => {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    // Public health check
    if (req.method === 'GET' && (pathname === '/api/health' || pathname === '/health')) {
      return sendJson(200, {
        status: 'ok',
        service: 'brick-vault',
        secretsCount: store.listKeys().length,
        timestamp: new Date().toISOString()
      });
    }

    // Public vitals check
    if (req.method === 'GET' && (pathname === '/api/vitals' || pathname === '/vitals')) {
      try {
        const v = await store.vitals();
        return sendJson(200, v);
      } catch (err) {
        return sendJson(500, { error: err.message });
      }
    }

    // Bearer token authentication if configured
    if (vaultToken) {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      if (token !== vaultToken) {
        return sendJson(401, { error: 'Unauthorized: Invalid or missing VAULT_TOKEN.' });
      }
    }

    // GET /api/secrets (List keys)
    if (req.method === 'GET' && pathname === '/api/secrets') {
      return sendJson(200, {
        status: 'ok',
        keys: store.listKeys()
      });
    }

    // Routes /api/secret/*
    if (pathname.startsWith('/api/secret/')) {
      const secretKey = decodeURIComponent(pathname.replace('/api/secret/', ''));

      if (req.method === 'GET') {
        const secret = store.getSecret(secretKey);
        if (secret === null || secret === undefined) {
          return sendJson(404, { error: `Secret "${secretKey}" not found.` });
        }
        return sendJson(200, { status: 'ok', key: secretKey, data: secret });
      }

      if (req.method === 'POST' || req.method === 'PUT') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body || '{}');
            const dataToStore = parsed.data !== undefined ? parsed.data : parsed;
            store.setSecret(secretKey, dataToStore);
            return sendJson(200, { status: 'ok', message: `Secret "${secretKey}" stored successfully.` });
          } catch (err) {
            return sendJson(400, { error: `Failed to store secret: ${err.message}` });
          }
        });
        return;
      }

      if (req.method === 'DELETE') {
        const deleted = store.deleteSecret(secretKey);
        if (!deleted) {
          return sendJson(404, { error: `Secret "${secretKey}" not found.` });
        }
        return sendJson(200, { status: 'ok', message: `Secret "${secretKey}" deleted.` });
      }
    }

    // Route not found
    sendJson(404, { error: 'Not Found' });
  });

  server.listen(port, host);
  return server;
}
