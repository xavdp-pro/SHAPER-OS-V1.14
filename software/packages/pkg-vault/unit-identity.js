/** Vault-owned unit control state, backed by Vault's private MariaDB. */
import { createPrivateKey, createPublicKey, createHash, hkdfSync, timingSafeEqual } from 'node:crypto';
import { grantedScopes, issueCredential, isUnitName, PROFILE_NAME_PATTERN, verifyCredential, CredentialError } from '../pkg-auth/unit-credentials.js';
import { appendOutbox } from '../pkg-db/outbox.js';
import { withTransaction } from '../pkg-db/pool.js';

const hash = (value) => createHash('sha256').update(value).digest('hex');

/** RFC 8410 PKCS#8 Ed25519 seed, domain-separated from encryption and key checks. */
export function deriveSigningKey(masterKey, universe) {
  const seed = Buffer.from(hkdfSync('sha256', masterKey, universe, 'shaper/vault/unit-signing/v1', 32));
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
  return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

/** Hours an expired credential's row is kept after its expiry. */
export const EXPIRED_CREDENTIAL_GRACE_HOURS = 24;

/**
 * Removes credential rows expired for more than 24 hours (DECISIONS-20261011
 * §C, the universe's dataLifecycle). Never a unit's current identity, epoch or
 * revocation: unit_identities is not touched, and a credential row marked
 * revoked is kept. A token past its expiry is refused before any lookup, so
 * its row proves nothing once the grace has passed. Bounded per call.
 * @param {import('mysql2/promise').Pool} pool
 * @param {{ graceHours?: number, limit?: number }} [options]
 * @returns {Promise<{ removed: number }>}
 */
export async function pruneExpiredCredentials(pool, { graceHours = EXPIRED_CREDENTIAL_GRACE_HOURS, limit = 1000 } = {}) {
  if (!Number.isInteger(graceHours) || graceHours < 1 || !Number.isInteger(limit) || limit < 1 || limit > 10000) {
    throw new CredentialError('CREDENTIAL_PRUNE_INVALID', 500);
  }
  const [result] = await pool.query(`DELETE FROM unit_credentials
    WHERE expires_at < TIMESTAMPADD(HOUR, -?, UTC_TIMESTAMP(3)) AND NOT revoked
    ORDER BY expires_at LIMIT ?`, [graceHours, limit]);
  return { removed: Number(result.affectedRows) || 0 };
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

  /**
   * Issues one credential for one audience and, when the parent registered
   * that audience with rights profiles, one profile (pkg-auth PROFILES.md): the
   * credential carries exactly that profile's scopes and its name, never the
   * other profiles' — a read credential cannot mutate. A whole audience (the
   * base's form) is issued without a profile, as before. `profile: null` is no
   * profile.
   */
  async issue({ unit, incarnation, audience, profile = null, bootstrapToken }) {
    if (!isUnitName(unit)
        || typeof incarnation !== 'string' || !/^[A-Za-z0-9._:-]{1,190}$/.test(incarnation)
        || !isUnitName(audience)
        || (profile !== null && (typeof profile !== 'string' || !PROFILE_NAME_PATTERN.test(profile)))
        || typeof bootstrapToken !== 'string' || !/^[0-9a-f]{64}$/.test(bootstrapToken)) {
      throw new CredentialError('IDENTITY_ISSUE_DENIED', 403);
    }
    // The refusal says one code to the caller; its typed reason, and whether the
    // requester proved who it is (its bootstrap matched), are for Vault's own
    // evidence (access-evidence.js), never for the answer.
    const deny = (code, reason, authenticated) => Object.assign(new CredentialError(code, 403), { reason, authenticated, unit, incarnation });
    return withTransaction(this.pool, async (conn) => {
      const [rows] = await conn.execute(`SELECT incarnation, epoch, grants, bootstrap_digest,
        UNIX_TIMESTAMP(bootstrap_expires_at) AS bootstrap_expiry, revoked FROM unit_identities
        WHERE universe_id = ? AND unit_id = ? FOR UPDATE`, [this.universe, unit]);
      const row = rows[0];
      if (!row) throw deny('IDENTITY_ISSUE_DENIED', 'IDENTITY_UNKNOWN', false);
      if (typeof row.bootstrap_digest !== 'string' || !/^[0-9a-f]{64}$/.test(row.bootstrap_digest)
          || !timingSafeEqual(Buffer.from(hash(bootstrapToken)), Buffer.from(row.bootstrap_digest))) {
        throw deny('IDENTITY_ISSUE_DENIED', 'BOOTSTRAP_MISMATCH', false);
      }
      if (row.revoked) throw deny('IDENTITY_ISSUE_DENIED', 'IDENTITY_REVOKED', true);
      if (row.incarnation !== incarnation) throw deny('IDENTITY_ISSUE_DENIED', 'INCARNATION_NOT_CURRENT', true);
      if (Number(row.bootstrap_expiry) <= this.now() / 1000) throw deny('IDENTITY_ISSUE_DENIED', 'BOOTSTRAP_EXPIRED', true);
      const grants = typeof row.grants === 'string' ? JSON.parse(row.grants) : row.grants;
      const granted = grantedScopes(grants, audience, profile);
      if (granted.denied === 'AUDIENCE_NOT_GRANTED') throw deny('IDENTITY_AUDIENCE_DENIED', granted.denied, true);
      if (granted.denied) throw deny('IDENTITY_PROFILE_DENIED', granted.denied, true);
      const result = issueCredential({ universe: this.universe, unit, incarnation, audience,
        ...(profile !== null ? { profile } : {}), scopes: granted.scopes,
        epoch: Number(row.epoch), revocationRef: `${unit}:${row.epoch}` }, this.privateKey, { now: this.now(), ttl: this.ttl });
      const c = result.claims;
      await conn.execute(`INSERT INTO unit_credentials
        (credential_id, universe_id, unit_id, incarnation, epoch, audience, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, FROM_UNIXTIME(?))`,
      [c.credentialId, this.universe, unit, incarnation, c.epoch, audience, c.expiresAt]);
      await appendOutbox(conn, { pod: 'vault', event: 'UNIT_CREDENTIAL_ISSUED', executionId: c.credentialId,
        correlationId: c.credentialId, data: { unit, incarnation, audience, ...(profile !== null ? { profile } : {}), epoch: c.epoch } });
      return result;
    });
  }

  async check(token, audience) {
    let claims;
    try {
      claims = verifyCredential(token, this.publicKey, { universe: this.universe, audience, now: this.now() });
    } catch (err) {
      // Not a credential this Vault issued, or no longer valid: unauthenticated.
      throw Object.assign(err, { reason: err.code, authenticated: false });
    }
    const revoked = () => Object.assign(new CredentialError('CREDENTIAL_REVOKED', 403),
      { reason: 'CREDENTIAL_NOT_CURRENT', authenticated: true, unit: claims.unit, incarnation: claims.incarnation });
    const [rows] = await this.pool.execute(`SELECT i.incarnation, i.epoch, i.grants, i.revoked AS identity_revoked,
      c.revoked AS credential_revoked FROM unit_identities i JOIN unit_credentials c
      ON c.universe_id = i.universe_id AND c.unit_id = i.unit_id
      WHERE c.credential_id = ? AND c.universe_id = ? AND c.unit_id = ?`,
    [claims.credentialId, this.universe, claims.unit]);
    const row = rows[0];
    if (!row || row.identity_revoked || row.credential_revoked || row.incarnation !== claims.incarnation
        || Number(row.epoch) !== claims.epoch) throw revoked();
    // Every scope the credential carries must still be registered for its
    // profile (or its whole audience): a profile narrowed, removed or turned
    // into another form by the parent ends the credentials issued under it.
    const grants = typeof row.grants === 'string' ? JSON.parse(row.grants) : row.grants;
    const granted = grantedScopes(grants, audience, claims.profile ?? null);
    if (granted.denied || !claims.scopes.every((scope) => granted.scopes.includes(scope))) throw revoked();
    return claims;
  }
}
