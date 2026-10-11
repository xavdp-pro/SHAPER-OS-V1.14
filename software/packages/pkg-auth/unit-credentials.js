/** Short-lived, audience-bound SHAPER unit credentials. No implicit grants. */
import { createHash, createPublicKey, randomUUID, sign, verify } from 'node:crypto';

export const MAX_CREDENTIAL_SECONDS = 300;
/**
 * The functional-slug grammar every base package applies to a unit name and an
 * audience (pkg-db, the unit runtime and Vault's registration check the same
 * pattern): a lowercase letter, then at most 31 lowercase letters, digits,
 * underscores or hyphens, not ending with a hyphen. `brick-voice` is a unit
 * name as it is — never an alias of `brick_voice` (Rule 4, one name).
 */
export const UNIT_NAME_PATTERN = /^[a-z](?:[a-z0-9_-]{0,30}[a-z0-9_])?$/;
const NAME = UNIT_NAME_PATTERN;
/** @param {unknown} value */
export const isUnitName = (value) => typeof value === 'string' && UNIT_NAME_PATTERN.test(value);
const ID = /^[A-Za-z0-9._:-]{1,190}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (value, pattern) => typeof value === 'string' && pattern.test(value);

export function assertIdentityBoundary({ universe, audience }) {
  if (!text(universe, UUID) || !text(audience, NAME)) throw new CredentialError('IDENTITY_POLICY_MISSING', 503);
}

export class CredentialError extends Error {
  constructor(code, status = 401) { super(code); this.name = 'CredentialError'; this.code = code; this.status = status; }
}

export function publicKeyId(publicKey) {
  const key = publicKey.type === 'public' ? publicKey : createPublicKey(publicKey);
  if (key.asymmetricKeyType !== 'ed25519') throw new CredentialError('IDENTITY_KEY_INVALID', 500);
  return createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex');
}

function validateClaims(c) {
  if (!c || c.kind !== 'shaper.unit.credential' || c.version !== 1 || !text(c.universe, UUID)
      || !text(c.unit, NAME) || !text(c.incarnation, ID) || !text(c.audience, NAME)
      || !text(c.credentialId, ID) || !text(c.revocationRef, ID) || !text(c.keyId, /^[0-9a-f]{64}$/)
      || !Number.isSafeInteger(c.epoch) || c.epoch < 1
      || !Number.isSafeInteger(c.issuedAt) || !Number.isSafeInteger(c.expiresAt)
      || c.expiresAt <= c.issuedAt || c.expiresAt - c.issuedAt > MAX_CREDENTIAL_SECONDS
      || !Array.isArray(c.scopes) || !c.scopes.length || c.scopes.length > 32
      || !c.scopes.every((s) => typeof s === 'string' && ID.test(s) && !s.includes('*'))
      || new Set(c.scopes).size !== c.scopes.length) {
    throw new CredentialError('CREDENTIAL_INVALID');
  }
}

export function issueCredential(identity, privateKey, { now = Date.now(), ttl = MAX_CREDENTIAL_SECONDS } = {}) {
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > MAX_CREDENTIAL_SECONDS) throw new CredentialError('CREDENTIAL_TTL_INVALID', 400);
  const issuedAt = Math.floor(now / 1000);
  const claims = { ...identity, kind: 'shaper.unit.credential', version: 1,
    keyId: publicKeyId(privateKey), credentialId: randomUUID(), issuedAt, expiresAt: issuedAt + ttl };
  validateClaims(claims);
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return { token: `${payload}.${sign(null, Buffer.from(payload), privateKey).toString('base64url')}`, claims };
}

export function verifyCredential(token, publicKey, { universe, audience, scope = null, now = Date.now() } = {}) {
  assertIdentityBoundary({ universe, audience });
  if (typeof token !== 'string' || token.length > 16384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    throw new CredentialError('CREDENTIAL_INVALID');
  }
  const [payload, encodedSignature] = token.split('.');
  const bytes = Buffer.from(payload, 'base64url'), signature = Buffer.from(encodedSignature, 'base64url');
  if (bytes.toString('base64url') !== payload || signature.toString('base64url') !== encodedSignature
      || signature.length !== 64 || !verify(null, Buffer.from(payload), publicKey, signature)) {
    throw new CredentialError('CREDENTIAL_SIGNATURE_INVALID');
  }
  let claims;
  try { claims = JSON.parse(bytes.toString()); } catch { throw new CredentialError('CREDENTIAL_INVALID'); }
  validateClaims(claims);
  if (claims.keyId !== publicKeyId(publicKey) || claims.universe !== universe || claims.audience !== audience) {
    throw new CredentialError('CREDENTIAL_BOUNDARY_DENIED', 403);
  }
  const seconds = Math.floor(now / 1000);
  if (claims.issuedAt > seconds || claims.expiresAt <= seconds) throw new CredentialError('CREDENTIAL_EXPIRED');
  if (scope && !claims.scopes.includes(scope)) throw new CredentialError('CREDENTIAL_SCOPE_DENIED', 403);
  return claims;
}

/** A protected service checks both the signature and current incarnation/revocation. */
export function createUnitAuthorizer({ publicKey, universe, audience, checkCurrent, now = Date.now }) {
  if (typeof checkCurrent !== 'function') throw new CredentialError('IDENTITY_CURRENT_CHECK_REQUIRED', 503);
  assertIdentityBoundary({ universe, audience });
  publicKeyId(publicKey);
  return async (req, scope) => {
    const raw = req.headers.authorization;
    const token = typeof raw === 'string' && /^Bearer [A-Za-z0-9_.-]+$/.test(raw) ? raw.slice(7) : null;
    const claims = verifyCredential(token, publicKey, { universe, audience, scope, now: now() });
    if (await checkCurrent(token, claims) !== true) throw new CredentialError('CREDENTIAL_REVOKED', 403);
    return claims;
  };
}
