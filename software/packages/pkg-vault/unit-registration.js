#!/usr/bin/env node
/**
 * @file unit-registration.js
 * @package @shaper/pkg-vault
 * @description The parent's two steps that let units hold Vault-signed
 * credentials, as a library and a command. The parent — the universe's
 * construction path, holding the master key and administering Vault's MariaDB
 * through root — runs them; no unit runs them.
 *
 *   public-key   prints Vault's Ed25519 signing public key (PEM, not a secret),
 *                derived from the master key and the universe, for the parent
 *                to pin as each consumer's UNIT_AUTH_PUBLIC_KEY_FILE.
 *   register     writes a fresh bootstrap token to a 0600 file for the unit and
 *                prints the one SQL statement root applies to Vault's database
 *                (`mariadb vault < statement`): the incarnation, its exact
 *                audience → scope grants, the token's SHA-256 and its expiry.
 *                The token itself never reaches SQL, the terminal or a log.
 *
 *   VAULT_MASTER_KEY_FILE=… SHAPER_UNIVERSE_ID=<uuid> node unit-registration.js public-key
 *   SHAPER_UNIVERSE_ID=<uuid> node unit-registration.js register \
 *     --unit queue --incarnation queue-1 --grant logger=logger:ingest \
 *     --bootstrap-file /apps/queue/etc/identity/bootstrap [--ttl-seconds 2592000]
 *
 *   renew        prints the one transaction root applies to Vault's database
 *                to extend, by 30 days, the bootstrap of each recorded
 *                identity that expires within 7 days (the parent's daily
 *                renewal, DECISIONS-20261011 §D). It checks every record
 *                against Vault first — universe, unit, incarnation, epoch,
 *                grants, bootstrap digest, not revoked, not expired — and
 *                when one does not match, changes nothing and commits an
 *                alert instead. It creates no identity, changes no
 *                incarnation, epoch or grant, never revives a revoked
 *                identity, and needs no bootstrap or token: the records hold
 *                digests only.
 *
 *   SHAPER_UNIVERSE_ID=<uuid> node unit-registration.js renew \
 *     --record /records/queue.json [--record …] [--within-seconds 604800] [--extend-seconds 2592000]
 *
 * Re-registering the same live incarnation redelivers a bootstrap and keeps
 * the epoch; a new incarnation, or the re-registration of a revoked one, bumps
 * the epoch, so credentials issued before stop being current at once.
 *
 * Intent: software/packages/pkg-vault/INTENT.md#parent-registration
 */
import { createHash, createPublicKey, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeMasterKey } from './index.js';
import { deriveSigningKey } from './unit-identity.js';
import { UNIT_NAME_PATTERN } from '../pkg-auth/unit-credentials.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NAME = UNIT_NAME_PATTERN;
const ID = /^[A-Za-z0-9._:-]{1,190}$/;
export const DEFAULT_BOOTSTRAP_TTL_SECONDS = 30 * 24 * 3600;
/** A bootstrap expiring within this is renewed (DECISIONS-20261011 §D). */
export const RENEW_WITHIN_SECONDS = 7 * 24 * 3600;
/** By how much a renewal extends it. */
export const RENEW_EXTEND_SECONDS = 30 * 24 * 3600;

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

/** Vault's signing public key for one universe, as the PEM consumers pin. */
export function signingPublicKeyPem({ masterKey, universe }) {
  if (typeof universe !== 'string' || !UUID.test(universe)) fail('IDENTITY_POLICY_MISSING', 'SHAPER_UNIVERSE_ID must be a UUID');
  return createPublicKey(deriveSigningKey(normalizeMasterKey(masterKey), universe)).export({ type: 'spki', format: 'pem' });
}

/**
 * The registration of one unit incarnation, as one statement root applies.
 * Every value is validated against the grammar Vault itself enforces, so the
 * literal SQL carries no injection surface and no secret.
 *
 * @param {object} options
 * @param {string} options.universe
 * @param {string} options.unit
 * @param {string} options.incarnation
 * @param {Record<string, string[]>} options.grants - audience → exact scopes
 * @param {string} options.bootstrapToken - 64 hex characters; only its digest is used
 * @param {number} [options.ttlSeconds]
 * @returns {{ sql: string, params: unknown[], text: string }}
 */
export function registrationStatement({ universe, unit, incarnation, grants, bootstrapToken, ttlSeconds = DEFAULT_BOOTSTRAP_TTL_SECONDS }) {
  if (typeof universe !== 'string' || !UUID.test(universe)) fail('REGISTRATION_INVALID', 'universe must be a UUID');
  if (typeof unit !== 'string' || !NAME.test(unit)) fail('REGISTRATION_INVALID', 'unit must be a functional slug');
  if (typeof incarnation !== 'string' || !ID.test(incarnation)) fail('REGISTRATION_INVALID', 'incarnation must match [A-Za-z0-9._:-]{1,190}');
  if (!grants || typeof grants !== 'object' || Array.isArray(grants) || !Object.keys(grants).length) {
    fail('REGISTRATION_INVALID', 'at least one audience grant is required');
  }
  for (const [audience, scopes] of Object.entries(grants)) {
    if (!NAME.test(audience) || !Array.isArray(scopes) || !scopes.length
        || !scopes.every((s) => typeof s === 'string' && ID.test(s) && !s.includes('*'))) {
      fail('REGISTRATION_INVALID', 'grants map an audience slug to exact, non-wildcard scopes');
    }
  }
  if (typeof bootstrapToken !== 'string' || !/^[0-9a-f]{64}$/.test(bootstrapToken)) fail('REGISTRATION_INVALID', 'bootstrap token must be 64 hex characters');
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 366 * 24 * 3600) fail('REGISTRATION_INVALID', 'ttl must be 60 s to 366 days');
  const digest = createHash('sha256').update(bootstrapToken).digest('hex');
  const grantsJson = JSON.stringify(grants);
  // epoch is evaluated before incarnation is overwritten (left to right).
  const sql = `INSERT INTO unit_identities
  (universe_id, unit_id, incarnation, epoch, grants, bootstrap_digest, bootstrap_expires_at, revoked)
  VALUES (?, ?, ?, 1, ?, ?, TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)), FALSE)
  ON DUPLICATE KEY UPDATE epoch = IF(incarnation = VALUES(incarnation) AND NOT revoked, epoch, epoch + 1),
    incarnation = VALUES(incarnation), grants = VALUES(grants), bootstrap_digest = VALUES(bootstrap_digest),
    bootstrap_expires_at = VALUES(bootstrap_expires_at), revoked = FALSE`;
  const params = [universe, unit, incarnation, grantsJson, digest, ttlSeconds];
  const literal = (v) => (typeof v === 'number' ? String(v) : `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`);
  let i = 0;
  const text = `${sql.replace(/\?/g, () => literal(params[i++]))};\n`;
  return { sql, params, text };
}

/**
 * One parent record (podman-up.sh write_record), checked against the grammar
 * Vault enforces: every value reaches the SQL as a literal, so none may carry
 * anything but its grammar.
 * @param {object} record
 * @returns {{ unit: string, incarnation: string, epoch: number, grants: Record<string, string[]>, bootstrapDigest: string }}
 */
export function validateRecord(record) {
  const bad = (why) => fail('RECORD_INVALID', `identity record ${JSON.stringify(record?.unit ?? null)}: ${why}`);
  if (!record || typeof record !== 'object' || Array.isArray(record)) bad('not an object');
  const { unit, incarnation, epoch, grants, bootstrapDigest } = record;
  if (typeof unit !== 'string' || !NAME.test(unit)) bad('unit is not a functional slug');
  if (typeof incarnation !== 'string' || !ID.test(incarnation)) bad('incarnation is outside its grammar');
  if (!Number.isSafeInteger(epoch) || epoch < 1) bad('epoch is not a positive integer');
  if (typeof bootstrapDigest !== 'string' || !/^[0-9a-f]{64}$/.test(bootstrapDigest)) bad('bootstrapDigest is not a SHA-256');
  if (!grants || typeof grants !== 'object' || Array.isArray(grants) || !Object.keys(grants).length
      || !Object.entries(grants).every(([a, scopes]) => NAME.test(a) && Array.isArray(scopes) && scopes.length
        && scopes.every((s) => typeof s === 'string' && ID.test(s) && !s.includes('*')))) {
    bad('grants are not audience → exact scopes');
  }
  return { unit, incarnation, epoch, grants, bootstrapDigest };
}

/**
 * The parent's renewal as one compound statement root applies through the
 * mariadb client (`mariadb -uroot -N -B vault < statement`). In one
 * transaction, each recorded identity's row is locked and classified:
 *   due       consistent, expiring within `withinSeconds`
 *   current   consistent, expiring later
 *   mismatch  incarnation, epoch, grants or bootstrap digest differ
 *   revoked   revoked (never revived)
 *   expired   already expired (renewing it would revive it)
 *   missing   no row for that unit in this universe
 * When every record is due or current, the due ones are extended by
 * `extendSeconds` from their present expiry, each with an
 * UNIT_BOOTSTRAP_RENEWED outbox row committed in the same transaction (the
 * proof). Otherwise nothing changes, and UNIT_BOOTSTRAP_RENEWAL_HALTED (level
 * ERROR, each unit's state) is committed instead — the alert reaches Logger
 * through Vault's relay. Its answer is one row per record:
 * `unit <TAB> renewed|current|held|<inconsistency> <TAB> expiry`.
 *
 * @param {object} options
 * @param {string} options.universe
 * @param {object[]} options.records - parent records (validateRecord)
 * @param {string} options.renewalId - a UUID naming this run in evidence
 * @param {number} [options.withinSeconds]
 * @param {number} [options.extendSeconds]
 * @returns {string}
 */
export function renewalStatement({ universe, records, renewalId, withinSeconds = RENEW_WITHIN_SECONDS, extendSeconds = RENEW_EXTEND_SECONDS }) {
  if (typeof universe !== 'string' || !UUID.test(universe)) fail('RENEWAL_INVALID', 'universe must be a UUID');
  if (typeof renewalId !== 'string' || !UUID.test(renewalId)) fail('RENEWAL_INVALID', 'renewalId must be a UUID');
  if (!Array.isArray(records) || !records.length || records.length > 64) fail('RENEWAL_INVALID', 'one to 64 identity records');
  if (!Number.isInteger(withinSeconds) || withinSeconds < 60 || withinSeconds > 366 * 24 * 3600) fail('RENEWAL_INVALID', 'within must be 60 s to 366 days');
  if (!Number.isInteger(extendSeconds) || extendSeconds < 60 || extendSeconds > 366 * 24 * 3600) fail('RENEWAL_INVALID', 'extend must be 60 s to 366 days');
  const checked = records.map(validateRecord);
  if (new Set(checked.map((r) => r.unit)).size !== checked.length) fail('RENEWAL_INVALID', 'one record per unit');
  const q = (v) => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
  const at = (v) => `DATE_FORMAT(${v}, '%Y-%m-%dT%T.%fZ')`;
  const where = (i) => `universe_id = ${q(universe)} AND unit_id = ${q(checked[i].unit)}`;
  const lines = [];
  lines.push(`-- The parent's bootstrap renewal ${renewalId} (pkg-vault unit-registration.js renew).`);
  lines.push('-- Digests and identities only: no bootstrap, no token.');
  lines.push('DELIMITER //');
  lines.push('BEGIN NOT ATOMIC');
  lines.push('  DECLARE halted INT DEFAULT 0;');
  checked.forEach((_, i) => {
    lines.push(`  DECLARE s${i} VARCHAR(16) DEFAULT 'missing';`);
    lines.push(`  DECLARE e${i} DATETIME(3) DEFAULT NULL;`);
  });
  lines.push('  START TRANSACTION;');
  checked.forEach((r, i) => {
    lines.push(`  SELECT CASE
      WHEN revoked THEN 'revoked'
      WHEN incarnation <> ${q(r.incarnation)} OR epoch <> ${r.epoch} OR grants <> ${q(JSON.stringify(r.grants))}
        OR bootstrap_digest <> ${q(r.bootstrapDigest)} THEN 'mismatch'
      WHEN bootstrap_expires_at <= UTC_TIMESTAMP(3) THEN 'expired'
      WHEN bootstrap_expires_at > TIMESTAMPADD(SECOND, ${withinSeconds}, UTC_TIMESTAMP(3)) THEN 'current'
      ELSE 'due' END, bootstrap_expires_at
    INTO s${i}, e${i} FROM unit_identities WHERE ${where(i)} FOR UPDATE;`);
    lines.push(`  IF s${i} NOT IN ('due', 'current') THEN SET halted = halted + 1; END IF;`);
  });
  const event = (eventId, name, level, data) => `JSON_OBJECT('pod', 'vault', 'event', '${name}', 'level', '${level}', 'executionId', ${eventId}, 'correlationId', ${q(renewalId)}, 'data', ${data}, 'sourceEventId', ${eventId})`;
  lines.push('  IF halted > 0 THEN');
  lines.push('    ROLLBACK;');
  const states = checked.map((r, i) => `JSON_OBJECT('unit', ${q(r.unit)}, 'state', s${i})`).join(', ');
  lines.push(`    SET @shaper_renewal_alert := ${event(q(renewalId), 'UNIT_BOOTSTRAP_RENEWAL_HALTED', 'ERROR',
    `JSON_OBJECT('renewalId', ${q(renewalId)}, 'universe', ${q(universe)}, 'halted', halted, 'units', JSON_ARRAY(${states}))`)};`);
  lines.push(`    INSERT INTO event_outbox (event_id, body, body_digest) VALUES (${q(renewalId)}, @shaper_renewal_alert, SHA2(@shaper_renewal_alert, 256));`);
  lines.push('  ELSE');
  checked.forEach((r, i) => {
    const eventId = q(`${renewalId}:${i}`);
    lines.push(`    IF s${i} = 'due' THEN`);
    lines.push(`      UPDATE unit_identities SET bootstrap_expires_at = TIMESTAMPADD(SECOND, ${extendSeconds}, bootstrap_expires_at)
        WHERE ${where(i)} AND incarnation = ${q(r.incarnation)} AND epoch = ${r.epoch} AND bootstrap_digest = ${q(r.bootstrapDigest)} AND NOT revoked;`);
    lines.push(`      SET @shaper_renewal_proof := ${event(eventId, 'UNIT_BOOTSTRAP_RENEWED', 'INFO',
      `JSON_OBJECT('renewalId', ${q(renewalId)}, 'universe', ${q(universe)}, 'unit', ${q(r.unit)}, 'incarnation', ${q(r.incarnation)}, 'epoch', ${r.epoch}, 'previousExpiry', ${at(`e${i}`)}, 'newExpiry', ${at(`TIMESTAMPADD(SECOND, ${extendSeconds}, e${i})`)})`)};`);
    lines.push(`      INSERT INTO event_outbox (event_id, body, body_digest) VALUES (${eventId}, @shaper_renewal_proof, SHA2(@shaper_renewal_proof, 256));`);
    lines.push('    END IF;');
  });
  lines.push('    COMMIT;');
  lines.push('  END IF;');
  const answer = checked.map((r, i) => `SELECT ${q(r.unit)}, IF(s${i} = 'due' AND halted = 0, 'renewed', IF(s${i} IN ('due', 'current') AND halted > 0, 'held', s${i})),
    COALESCE((SELECT ${at('bootstrap_expires_at')} FROM unit_identities WHERE ${where(i)}), '-')`).join('\n  UNION ALL ');
  lines.push(`  ${answer};`);
  lines.push('END //');
  lines.push('DELIMITER ;');
  return `${lines.join('\n')}\n`;
}

/** A fresh bootstrap token, written owner-only; refuses to overwrite one. */
export function writeBootstrapToken(file) {
  const token = randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, token, { mode: 0o600, flag: 'wx' });
  return token;
}

function parseGrants(values) {
  const grants = {};
  for (const value of values) {
    const [audience, scope] = value.split('=');
    if (!audience || !scope) fail('REGISTRATION_INVALID', `--grant takes audience=scope; got ${value}`);
    (grants[audience] ||= []).push(scope);
  }
  return grants;
}

function cli(argv, env) {
  const [command, ...rest] = argv;
  if (command === 'public-key') {
    const file = env.VAULT_MASTER_KEY_FILE;
    if (!file) fail('VAULT_MASTER_KEY_FILE_REQUIRED', 'VAULT_MASTER_KEY_FILE is required');
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.mode & 0o077) fail('VAULT_KEY_FILE_UNTRUSTED', 'the master-key file must be a private regular file');
    process.stdout.write(signingPublicKeyPem({ masterKey: fs.readFileSync(file, 'utf8').trim(), universe: env.SHAPER_UNIVERSE_ID }));
    return;
  }
  if (command === 'register') {
    const options = { grants: [] };
    for (let i = 0; i < rest.length; i += 2) {
      const [flag, value] = [rest[i], rest[i + 1]];
      if (value === undefined) fail('REGISTRATION_INVALID', `${flag} needs a value`);
      if (flag === '--unit') options.unit = value;
      else if (flag === '--incarnation') options.incarnation = value;
      else if (flag === '--grant') options.grants.push(value);
      else if (flag === '--bootstrap-file') options.bootstrapFile = value;
      else if (flag === '--ttl-seconds') options.ttlSeconds = Number(value);
      else fail('REGISTRATION_INVALID', `unknown option ${flag}`);
    }
    if (!options.bootstrapFile) fail('REGISTRATION_INVALID', '--bootstrap-file is required');
    const grants = parseGrants(options.grants);
    // Validate everything before the token file exists.
    registrationStatement({ universe: env.SHAPER_UNIVERSE_ID, unit: options.unit, incarnation: options.incarnation,
      grants, bootstrapToken: '0'.repeat(64), ttlSeconds: options.ttlSeconds });
    const bootstrapToken = writeBootstrapToken(options.bootstrapFile);
    process.stdout.write(registrationStatement({ universe: env.SHAPER_UNIVERSE_ID, unit: options.unit,
      incarnation: options.incarnation, grants, bootstrapToken, ttlSeconds: options.ttlSeconds }).text);
    return;
  }
  if (command === 'renew') {
    const files = [];
    let withinSeconds = RENEW_WITHIN_SECONDS, extendSeconds = RENEW_EXTEND_SECONDS;
    for (let i = 0; i < rest.length; i += 2) {
      const [flag, value] = [rest[i], rest[i + 1]];
      if (value === undefined) fail('RENEWAL_INVALID', `${flag} needs a value`);
      if (flag === '--record') files.push(value);
      else if (flag === '--within-seconds') withinSeconds = Number(value);
      else if (flag === '--extend-seconds') extendSeconds = Number(value);
      else fail('RENEWAL_INVALID', `unknown option ${flag}`);
    }
    const records = files.map((file) => {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.mode & 0o077) fail('RECORD_UNTRUSTED', `${file} must be a private regular file`);
      try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fail('RECORD_INVALID', `${file} is not JSON`); }
    });
    process.stdout.write(renewalStatement({ universe: env.SHAPER_UNIVERSE_ID, records, renewalId: randomUUID(), withinSeconds, extendSeconds }));
    return;
  }
  fail('USAGE', 'usage: unit-registration.js public-key | register --unit <slug> --incarnation <id> --grant <audience>=<scope> --bootstrap-file <path> [--ttl-seconds <n>] | renew --record <file>… [--within-seconds <n>] [--extend-seconds <n>]');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    cli(process.argv.slice(2), process.env);
  } catch (err) {
    console.error(`[unit-registration] ${err.code || 'ERROR'}: ${err.message}`);
    process.exit(1);
  }
}
