/**
 * @file access-evidence.js
 * @package @shaper/pkg-vault
 * @description Vault's evidence of reads and refusals (DECISIONS-20261011 §H).
 *
 * A secret is returned only after the proof of its read is committed to the
 * Vault's outbox (mariadb-store.js readSecretWithEvidence): outbox unwritable,
 * no secret (503). Logger down but the outbox durable: the read succeeds and
 * its evidence is pending until the relay delivers it.
 *
 * A refusal is recorded with a typed reason — the requester's identity when
 * it proved one, the universe, its incarnation, the action, an opaque resource
 * id, the result, the instant and the request id; never a secret, a token, a
 * full body or a secret's path:
 *   - an authenticated refusal (the requester proved who it is: a valid
 *     bootstrap whose audience is not granted, a revoked identity presenting
 *     its own bootstrap, a validly signed credential Vault no longer holds
 *     current) is committed individually the first time in a window
 *     (VAULT_REQUEST_REFUSED), and its repeats in that window are counted;
 *   - an unauthenticated refusal (no or a wrong admin token, an unknown
 *     bootstrap, a malformed, forged or expired credential) is only counted.
 * Counts are flushed per window as bounded aggregates
 * (VAULT_REFUSALS_AGGREGATED), at most `maxKeys` distinct keys, the rest
 * folded into one overflow key. So a refusal that repeats — Vault's own relay
 * presenting a credential that was revoked under it, a unit retrying a
 * refused bootstrap — writes at most two rows per window, never one row per
 * attempt: no relay-induced loop. A successful identity check is not
 * recorded at all.
 *
 * Counts not yet flushed are lost if the process dies: at most one window of
 * unauthenticated noise, declared here.
 *
 * Intent: software/packages/pkg-vault/INTENT.md#access-evidence
 */
import { createHmac, hkdfSync, randomUUID } from 'node:crypto';
import { appendOutbox } from '../pkg-db/outbox.js';
import { withTransaction } from '../pkg-db/pool.js';
import { publicEvidence } from '../pkg-logger/public-event.js';

/** The requester behind the administrative token. */
export const ADMIN_IDENTITY = 'vault:admin';
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,64}$/;

/** A request id: the caller's X-Request-Id when it is one, else a new one. */
export function requestIdOf(req) {
  const given = req?.headers?.['x-request-id'];
  return typeof given === 'string' && REQUEST_ID.test(given) ? given : randomUUID();
}

/**
 * The opaque id a secret is named by in read and refusal evidence: an HMAC of
 * its normalized key under a key derived from the master key. Stable for one
 * Vault, so an operator holding the master key can recompute it for a key they
 * know; it reveals nothing of the path to anyone else.
 * @param {Buffer} masterKey - the normalized 32-byte master key
 * @param {string} normalizedKey
 */
export function resourceId(masterKey, normalizedKey) {
  const key = Buffer.from(hkdfSync('sha256', masterKey, Buffer.alloc(0), 'shaper/vault/resource-id/v1', 32));
  return `res-${createHmac('sha256', key).update(String(normalizedKey)).digest('hex').slice(0, 32)}`;
}

/** The outbox entry of one access fact. */
export function accessEntry(event, level, data) {
  const eventId = randomUUID();
  return { eventId, entry: publicEvidence({ pod: 'vault', event, level, executionId: eventId, correlationId: data.requestId || eventId, data }) };
}

/**
 * @param {object} options
 * @param {import('mysql2/promise').Pool} options.pool
 * @param {string} options.universe
 * @param {(event: object) => void} [options.report]
 * @param {number} [options.windowMs=60000] - aggregate flush period
 * @param {number} [options.individualWindowMs=300000] - one individual record per key per window
 * @param {number} [options.maxKeys=64]
 * @param {() => number} [options.now]
 */
export function createRefusalRecorder({
  pool, universe, report = () => {}, windowMs = 60000, individualWindowMs = 300000, maxKeys = 64, now = Date.now,
}) {
  let counts = new Map();
  const individual = new Map();
  let windowStart = now();
  let timer = null;
  let flushing = null;

  const count = (fact, at) => {
    let key = [fact.action, fact.reason, fact.unit || '-', fact.incarnation || '-', fact.authenticated ? 'a' : 'u'].join('|');
    let base = fact;
    if (!counts.has(key) && counts.size >= maxKeys - 1) {
      key = 'overflow';
      base = { action: '*', reason: 'REFUSALS_OVERFLOW', authenticated: false };
    }
    const entry = counts.get(key) || { action: base.action, reason: base.reason, unit: base.unit || null,
      incarnation: base.incarnation || null, authenticated: Boolean(base.authenticated), count: 0, firstAt: at, lastAt: at };
    entry.count += 1;
    entry.lastAt = at;
    counts.set(key, entry);
  };

  async function record(fact, at) {
    const data = {
      action: fact.action, result: 'refused', reason: fact.reason, universe, at, requestId: fact.requestId,
      ...(fact.identity ? { identity: fact.identity } : {}),
      ...(fact.unit ? { unit: fact.unit } : {}),
      ...(fact.incarnation ? { incarnation: fact.incarnation } : {}),
      ...(fact.resource ? { resource: fact.resource } : {}),
    };
    const { eventId, entry } = accessEntry('VAULT_REQUEST_REFUSED', 'WARN', data);
    await withTransaction(pool, (conn) => appendOutbox(conn, entry, { eventId }));
  }

  return {
    /**
     * @param {{ action: string, reason: string, requestId: string, authenticated: boolean,
     *   identity?: string, unit?: string, incarnation?: string, resource?: string }} fact
     * @returns {Promise<'recorded'|'counted'>}
     */
    async refused(fact) {
      const at = new Date(now()).toISOString();
      if (fact.authenticated) {
        const key = [fact.action, fact.reason, fact.identity || fact.unit || '-', fact.incarnation || '-'].join('|');
        const last = individual.get(key);
        if ((last === undefined || now() - last >= individualWindowMs) && individual.size < 4096) {
          individual.set(key, now());
          try {
            await record(fact, at);
            return 'recorded';
          } catch (err) {
            individual.delete(key);
            report({ event: 'VAULT_REFUSAL_UNRECORDED', code: err?.code || 'OUTBOX_UNAVAILABLE' });
          }
        }
      }
      count(fact, at);
      return 'counted';
    },

    /** Commits the window's counts as aggregates; kept for the next window if it cannot. */
    flush() {
      if (flushing) return flushing;
      flushing = (async () => {
        const end = now();
        for (const [key, at] of individual) if (end - at >= individualWindowMs) individual.delete(key);
        if (!counts.size) { windowStart = end; return 0; }
        // The window is taken whole before the commit: refusals counted while
        // it commits go to the next window, never lost with the cleared one.
        const taken = counts;
        counts = new Map();
        const batch = [...taken.values()];
        const window = { start: new Date(windowStart).toISOString(), end: new Date(end).toISOString() };
        try {
          await withTransaction(pool, async (conn) => {
            for (const a of batch) {
              const { eventId, entry } = accessEntry('VAULT_REFUSALS_AGGREGATED', 'WARN', {
                action: a.action, reason: a.reason, result: 'refused', universe, authenticated: a.authenticated,
                count: a.count, firstAt: a.firstAt, lastAt: a.lastAt, window,
                ...(a.unit ? { unit: a.unit } : {}), ...(a.incarnation ? { incarnation: a.incarnation } : {}),
              });
              await appendOutbox(conn, entry, { eventId });
            }
          });
          windowStart = end;
          return batch.length;
        } catch (err) {
          // Kept for the next window, merged with what arrived meanwhile.
          for (const [key, a] of taken) {
            const now = counts.get(key);
            if (now) {
              now.count += a.count;
              now.firstAt = a.firstAt;
            } else if (counts.size < maxKeys) {
              counts.set(key, a);
            } else {
              const overflow = counts.get('overflow') || { action: '*', reason: 'REFUSALS_OVERFLOW', unit: null, incarnation: null,
                authenticated: false, count: 0, firstAt: a.firstAt, lastAt: a.lastAt };
              overflow.count += a.count;
              counts.set('overflow', overflow);
            }
          }
          report({ event: 'VAULT_REFUSALS_UNFLUSHED', code: err?.code || 'OUTBOX_UNAVAILABLE', keys: batch.length });
          return 0;
        }
      })().finally(() => { flushing = null; });
      return flushing;
    },

    start() {
      if (timer) return;
      timer = setInterval(() => { void this.flush(); }, windowMs);
      timer.unref?.();
    },

    async close() {
      if (timer) clearInterval(timer);
      timer = null;
      await this.flush();
    },

    pending: () => [...counts.values()].reduce((n, a) => n + a.count, 0),
  };
}
