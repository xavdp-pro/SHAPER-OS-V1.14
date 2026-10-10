/** Vault-owned unit control state, backed by Vault's private MariaDB. */
import { createPrivateKey, createPublicKey, createHash, hkdfSync, timingSafeEqual } from 'node:crypto';
import { issueCredential, verifyCredential, CredentialError } from '../pkg-auth/unit-credentials.js';
import { appendOutbox } from '../pkg-db/outbox.js';
import { withTransaction } from '../pkg-db/pool.js';

const hash = (value) => createHash('sha256').update(value).digest('hex');

/** RFC 8410 PKCS#8 Ed25519 seed, domain-separated from encryption and key checks. */
export function deriveSigningKey(masterKey, universe) {
  const seed = Buffer.from(hkdfSync('sha256', masterKey, universe, 'shaper/vault/unit-signing/v1', 32));
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
  return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

export class VaultUnitIdentity {
  constructor({ pool, masterKey, universe, now = Date.now, ttl = 300 }) {
    if (typeof universe !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(universe)) {
      throw new CredentialError('IDENTITY_POLICY_MISSING', 503);
    }
    this.pool = pool; this.universe = universe; this.now = now;
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > 300) throw new CredentialError('CREDENTIAL_TTL_INVALID', 503);
    this.ttl = ttl;
    this.privateKey = deriveSigningKey(masterKey, universe);
    this.publicKey = createPublicKey(this.privateKey);
  }

  async issue({ unit, incarnation, audience, bootstrapToken }) {
    if (typeof unit !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/.test(unit)
        || typeof incarnation !== 'string' || !/^[A-Za-z0-9._:-]{1,190}$/.test(incarnation)
        || typeof audience !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/.test(audience)
        || typeof bootstrapToken !== 'string' || !/^[0-9a-f]{64}$/.test(bootstrapToken)) {
      throw new CredentialError('IDENTITY_ISSUE_DENIED', 403);
    }
    return withTransaction(this.pool, async (conn) => {
      const [rows] = await conn.execute(`SELECT incarnation, epoch, grants, bootstrap_digest,
        UNIX_TIMESTAMP(bootstrap_expires_at) AS bootstrap_expiry, revoked FROM unit_identities
        WHERE universe_id = ? AND unit_id = ? FOR UPDATE`, [this.universe, unit]);
      const row = rows[0];
      if (!row || row.revoked || row.incarnation !== incarnation
          || Number(row.bootstrap_expiry) <= this.now() / 1000
          || typeof row.bootstrap_digest !== 'string' || !/^[0-9a-f]{64}$/.test(row.bootstrap_digest)
          || !timingSafeEqual(Buffer.from(hash(bootstrapToken)), Buffer.from(row.bootstrap_digest))) {
        throw new CredentialError('IDENTITY_ISSUE_DENIED', 403);
      }
      const grants = typeof row.grants === 'string' ? JSON.parse(row.grants) : row.grants;
      const scopes = Object.hasOwn(grants, audience) ? grants[audience] : null;
      if (!Array.isArray(scopes) || !scopes.length) throw new CredentialError('IDENTITY_AUDIENCE_DENIED', 403);
      const result = issueCredential({ universe: this.universe, unit, incarnation, audience, scopes,
        epoch: Number(row.epoch), revocationRef: `${unit}:${row.epoch}` }, this.privateKey, { now: this.now(), ttl: this.ttl });
      const c = result.claims;
      await conn.execute(`INSERT INTO unit_credentials
        (credential_id, universe_id, unit_id, incarnation, epoch, audience, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, FROM_UNIXTIME(?))`,
      [c.credentialId, this.universe, unit, incarnation, c.epoch, audience, c.expiresAt]);
      await appendOutbox(conn, { pod: 'vault', event: 'UNIT_CREDENTIAL_ISSUED', executionId: c.credentialId,
        correlationId: c.credentialId, data: { unit, incarnation, audience, epoch: c.epoch } });
      return result;
    });
  }

  async check(token, audience) {
    const claims = verifyCredential(token, this.publicKey, { universe: this.universe, audience, now: this.now() });
    const [rows] = await this.pool.execute(`SELECT i.incarnation, i.epoch, i.grants, i.revoked AS identity_revoked,
      c.revoked AS credential_revoked FROM unit_identities i JOIN unit_credentials c
      ON c.universe_id = i.universe_id AND c.unit_id = i.unit_id
      WHERE c.credential_id = ? AND c.universe_id = ? AND c.unit_id = ?`,
    [claims.credentialId, this.universe, claims.unit]);
    const row = rows[0];
    if (!row || row.identity_revoked || row.credential_revoked || row.incarnation !== claims.incarnation
        || Number(row.epoch) !== claims.epoch) throw new CredentialError('CREDENTIAL_REVOKED', 403);
    const grants = typeof row.grants === 'string' ? JSON.parse(row.grants) : row.grants;
    if (!Object.hasOwn(grants, audience) || !Array.isArray(grants[audience])
        || !claims.scopes.every((scope) => grants[audience].includes(scope))) {
      throw new CredentialError('CREDENTIAL_REVOKED', 403);
    }
    return claims;
  }
}
