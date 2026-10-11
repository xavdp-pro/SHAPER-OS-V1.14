/** Runtime credential renewal and current-authority checks; no durable tokens. */
import fs from 'node:fs';
import { createPublicKey } from 'node:crypto';
import { assertIdentityBoundary, createUnitAuthorizer, verifyCredential, CredentialError, PROFILE_NAME_PATTERN } from './unit-credentials.js';

function bootstrapFromFile(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.mode & 0o077 || stat.uid !== process.getuid()) {
    throw new CredentialError('IDENTITY_BOOTSTRAP_FILE_UNTRUSTED', 503);
  }
  const token = fs.readFileSync(file, 'utf8').trim();
  if (!/^[0-9a-f]{64}$/.test(token)) throw new CredentialError('IDENTITY_BOOTSTRAP_INVALID', 503);
  return token;
}

function keyFromFile(file) {
  if (!file) throw new CredentialError('IDENTITY_PUBLIC_KEY_REQUIRED', 503);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.mode & 0o022 || ![0, process.getuid()].includes(stat.uid)) {
    throw new CredentialError('IDENTITY_PUBLIC_KEY_UNTRUSTED', 503);
  }
  return createPublicKey(fs.readFileSync(file));
}

async function request(vaultUrl, path, token, body, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(`${vaultUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(3000),
    });
    const json = await response.json();
    // Vault's refusal (401, 403) is the caller's; anything else Vault answers
    // — a 5xx, a 404, an unexpected status — leaves the authority unverified:
    // 503, never passed through (DECISIONS-20261011 §E).
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new CredentialError(json.code || 'CREDENTIAL_REVOKED', response.status);
      throw new CredentialError('IDENTITY_UNAVAILABLE', 503);
    }
    return json;
  } catch (err) {
    if (err instanceof CredentialError) throw err;
    throw new CredentialError('IDENTITY_UNAVAILABLE', 503);
  }
}

/** Why a held session ended (PROFILES.md §7). */
export const SESSION_END_REASONS = Object.freeze(['credential_expired', 'authority_revoked', 'authority_unverifiable']);

/**
 * The receiver's authorization (PROFILES.md §6): `authorize(req, scope)`
 * verifies signature, universe, audience and scope locally, then the current
 * authority with Vault, and resolves to the claims or rejects with a
 * CredentialError whose status is 401, 403 or 503. No fallback.
 *
 * `authorize.session(req, scope, { onEnd, intervalSeconds })` authorizes the
 * same way, then holds what it opened (an audio stream): Vault re-confirms the
 * credential's authority every `intervalSeconds` (default 30, at most 60),
 * and `onEnd(reason)` is called once at the first of the credential's expiry
 * (`credential_expired`), a refusal (`authority_revoked`) or an authority
 * Vault cannot confirm (`authority_unverifiable`). It resolves to
 * `{ claims, end }`; `end()` stops holding without calling `onEnd`.
 */
export function runtimeAuthorizer(env = process.env, fetchImpl = fetch, { now = Date.now } = {}) {
  if (!env.VAULT_URL) throw new CredentialError('IDENTITY_VAULT_REQUIRED', 503);
  const checkCurrent = async (token, claims) => (await request(env.VAULT_URL,
    '/api/identity/check', token, { audience: claims.audience }, fetchImpl)).active === true;
  const authorize = createUnitAuthorizer({ publicKey: keyFromFile(env.UNIT_AUTH_PUBLIC_KEY_FILE),
    universe: env.SHAPER_UNIVERSE_ID, audience: env.SHAPER_UNIT_SLUG, checkCurrent, now });
  authorize.session = async (req, scope, { onEnd, intervalSeconds = 30 } = {}) => {
    if (typeof onEnd !== 'function' || !Number.isFinite(intervalSeconds) || intervalSeconds < 1 || intervalSeconds > 60) {
      throw new CredentialError('IDENTITY_SESSION_CONFIG_INVALID', 500);
    }
    const claims = await authorize(req, scope);
    const token = req.headers.authorization.slice(7);
    let ended = false, timer = null;
    const stop = () => { ended = true; if (timer) clearTimeout(timer); timer = null; };
    const finish = (reason) => { if (ended) return; stop(); onEnd(reason); };
    const next = () => {
      if (ended) return;
      const left = claims.expiresAt * 1000 - now();
      if (left <= 0) { finish('credential_expired'); return; }
      timer = setTimeout(async () => {
        timer = null;
        if (ended) return;
        if (claims.expiresAt * 1000 - now() <= 0) { finish('credential_expired'); return; }
        try {
          if (await checkCurrent(token, claims) !== true) { finish('authority_revoked'); return; }
        } catch (err) {
          finish(err instanceof CredentialError && err.status === 503 ? 'authority_unverifiable'
            : err instanceof CredentialError && err.code === 'CREDENTIAL_EXPIRED' ? 'credential_expired' : 'authority_revoked');
          return;
        }
        next();
      }, Math.min(intervalSeconds * 1000, left));
      timer.unref?.();
    };
    next();
    return { claims, end: stop };
  };
  return authorize;
}

/**
 * @param {Record<string, string|undefined>} [env]
 * @param {typeof fetch} [fetchImpl]
 * @param {object} [local] - Vault only: issue in-process instead of over HTTP.
 *   `issuer({ unit, incarnation, audience, bootstrapToken })` resolves to
 *   `{ token }`, and `publicKey` is the issuing key itself; the bootstrap file,
 *   incarnation, renewal and verification are exactly those of every other unit.
 */
export function runtimeCredentialClient(env = process.env, fetchImpl = fetch, { issuer = null, publicKey: localKey = null } = {}) {
  if (Boolean(issuer) !== Boolean(localKey)) throw new CredentialError('IDENTITY_CLIENT_CONFIG_REQUIRED', 503);
  const publicKey = localKey ?? keyFromFile(env.UNIT_AUTH_PUBLIC_KEY_FILE);
  assertIdentityBoundary({ universe: env.SHAPER_UNIVERSE_ID, audience: env.SHAPER_UNIT_SLUG });
  if ((!issuer && !env.VAULT_URL) || !env.UNIT_BOOTSTRAP_TOKEN_FILE || !env.SHAPER_UNIT_INCARNATION) {
    throw new CredentialError('IDENTITY_CLIENT_CONFIG_REQUIRED', 503);
  }
  bootstrapFromFile(env.UNIT_BOOTSTRAP_TOKEN_FILE);
  const cache = new Map(), pending = new Map();
  // One credential per (audience, profile) (PROFILES.md §5).
  const keyOf = (audience, profile) => `${audience}/${profile ?? ''}`;
  const options = (value) => {
    const o = typeof value === 'string' ? { profile: value } : (value ?? {});
    const profile = o.profile ?? null, minValiditySeconds = o.minValiditySeconds ?? 0;
    if ((profile !== null && (typeof profile !== 'string' || !PROFILE_NAME_PATTERN.test(profile)))
        || !Number.isInteger(minValiditySeconds) || minValiditySeconds < 0 || minValiditySeconds > 240) {
      throw new CredentialError('IDENTITY_REQUEST_INVALID', 400);
    }
    return { profile, minValiditySeconds };
  };
  return {
    /**
     * @param {string} audience
     * @param {string|{ profile?: string|null, minValiditySeconds?: number }} [want]
     * @returns {Promise<{ Authorization: string }>}
     */
    async headers(audience, want) {
      const { profile, minValiditySeconds } = options(want);
      const key = keyOf(audience, profile);
      const old = cache.get(key);
      // Renew within 30 s of expiry, or within half the lifetime of a short
      // one: a margin larger than the lifetime would renew on every call. A
      // caller about to hold a session asks for more (minValiditySeconds).
      const margin = old ? Math.max(Math.min(30, (old.claims.expiresAt - old.claims.issuedAt) / 2), minValiditySeconds) * 1000 : 0;
      if (old && old.claims.expiresAt * 1000 - Date.now() > margin) return { Authorization: `Bearer ${old.token}` };
      if (!pending.has(key)) {
        const renewal = (async () => {
          const bootstrap = bootstrapFromFile(env.UNIT_BOOTSTRAP_TOKEN_FILE);
          const ask = { unit: env.SHAPER_UNIT_SLUG, incarnation: env.SHAPER_UNIT_INCARNATION, audience,
            ...(profile !== null ? { profile } : {}) };
          const result = issuer
            ? await issuer({ ...ask, bootstrapToken: bootstrap })
            : await request(env.VAULT_URL, '/api/identity/issue', bootstrap, ask, fetchImpl);
          const claims = verifyCredential(result?.token, publicKey, { universe: env.SHAPER_UNIVERSE_ID, audience });
          if (claims.unit !== env.SHAPER_UNIT_SLUG || claims.incarnation !== env.SHAPER_UNIT_INCARNATION
              || (claims.profile ?? null) !== profile) {
            throw new CredentialError('IDENTITY_RENEWAL_MISMATCH', 403);
          }
          const entry = { token: result.token, claims };
          cache.set(key, entry);
          return entry;
        })().finally(() => pending.delete(key));
        pending.set(key, renewal);
      }
      const entry = await pending.get(key);
      if (entry.claims.expiresAt * 1000 - Date.now() < minValiditySeconds * 1000) {
        throw new CredentialError('CREDENTIAL_LIFETIME_SHORT', 503);
      }
      return { Authorization: `Bearer ${entry.token}` };
    },
    /** Forgets one cached credential (after a receiver's 401): the next call renews it. */
    invalidate(audience, profile = null) {
      cache.delete(keyOf(audience, typeof profile === 'object' && profile !== null ? profile.profile ?? null : profile));
    },
  };
}
