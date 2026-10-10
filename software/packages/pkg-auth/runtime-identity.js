/** Runtime credential renewal and current-authority checks; no durable tokens. */
import fs from 'node:fs';
import { createPublicKey } from 'node:crypto';
import { assertIdentityBoundary, createUnitAuthorizer, verifyCredential, CredentialError } from './unit-credentials.js';

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
    if (!response.ok) throw new CredentialError(json.code || 'IDENTITY_UNAVAILABLE', response.status);
    return json;
  } catch (err) {
    if (err instanceof CredentialError) throw err;
    throw new CredentialError('IDENTITY_UNAVAILABLE', 503);
  }
}

export function runtimeAuthorizer(env = process.env, fetchImpl = fetch) {
  if (!env.VAULT_URL) throw new CredentialError('IDENTITY_VAULT_REQUIRED', 503);
  return createUnitAuthorizer({ publicKey: keyFromFile(env.UNIT_AUTH_PUBLIC_KEY_FILE),
    universe: env.SHAPER_UNIVERSE_ID, audience: env.SHAPER_UNIT_SLUG,
    checkCurrent: async (token, claims) => (await request(env.VAULT_URL,
      '/api/identity/check', token, { audience: claims.audience }, fetchImpl)).active === true,
  });
}

export function runtimeCredentialClient(env = process.env, fetchImpl = fetch) {
  const publicKey = keyFromFile(env.UNIT_AUTH_PUBLIC_KEY_FILE);
  assertIdentityBoundary({ universe: env.SHAPER_UNIVERSE_ID, audience: env.SHAPER_UNIT_SLUG });
  if (!env.VAULT_URL || !env.UNIT_BOOTSTRAP_TOKEN_FILE || !env.SHAPER_UNIT_INCARNATION) {
    throw new CredentialError('IDENTITY_CLIENT_CONFIG_REQUIRED', 503);
  }
  bootstrapFromFile(env.UNIT_BOOTSTRAP_TOKEN_FILE);
  const cache = new Map(), pending = new Map();
  return {
    async headers(audience) {
      const old = cache.get(audience);
      if (old && old.claims.expiresAt * 1000 - Date.now() > 30000) return { Authorization: `Bearer ${old.token}` };
      if (!pending.has(audience)) {
        const renewal = (async () => {
          const bootstrap = bootstrapFromFile(env.UNIT_BOOTSTRAP_TOKEN_FILE);
          const result = await request(env.VAULT_URL, '/api/identity/issue', bootstrap,
            { unit: env.SHAPER_UNIT_SLUG, incarnation: env.SHAPER_UNIT_INCARNATION, audience }, fetchImpl);
          const claims = verifyCredential(result.token, publicKey, { universe: env.SHAPER_UNIVERSE_ID, audience });
          if (claims.unit !== env.SHAPER_UNIT_SLUG || claims.incarnation !== env.SHAPER_UNIT_INCARNATION) {
            throw new CredentialError('IDENTITY_RENEWAL_MISMATCH', 403);
          }
          cache.set(audience, { token: result.token, claims });
          return { Authorization: `Bearer ${result.token}` };
        })().finally(() => pending.delete(audience));
        pending.set(audience, renewal);
      }
      return pending.get(audience);
    },
  };
}
