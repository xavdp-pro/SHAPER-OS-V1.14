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
 *                for the parent's daily renewal (SOL decision L, which replaces
 *                the all-or-nothing halt of DECISIONS-20261011 §D). Each
 *                expected identity — the composition's, named by --expect, so
 *                a record file that disappeared is `missing` — is checked
 *                against Vault: universe, unit, incarnation, epoch, grants,
 *                bootstrap digest, not revoked, not expired. A consistent one
 *                expiring within 7 days is extended by 30 days from its
 *                current expiry; a missing, expired, revoked or inconsistent
 *                one stays exactly as it is, and the run is `partial`. It
 *                creates no identity, changes no incarnation, epoch or grant,
 *                never revives a revoked identity, and needs no bootstrap or
 *                token: the records hold digests only.
 *   readback     prints the query that re-reads, from Vault's outbox, what a
 *                renewal committed — after its acknowledgement was lost, and
 *                before anything is repeated.
 *
 *   SHAPER_UNIVERSE_ID=<uuid> node unit-registration.js renew \
 *     --expect queue [--expect …] --record /records/queue.json [--record …] \
 *     [--renewal-id <uuid>] [--within-seconds 604800] [--extend-seconds 2592000]
 *   node unit-registration.js readback --renewal-id <uuid>
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

/** What one renewal answers per identity (column 2 of its rows). */
export const RENEWAL_STATES = Object.freeze(['renewed', 'current', 'missing', 'expired', 'revoked', 'inconsistent', 'unexpected']);
/** A blocked identity: left exactly as it is, and the run is partial. */
export const BLOCKED_STATES = Object.freeze(['missing', 'expired', 'revoked', 'inconsistent', 'unexpected']);

const sqlString = (v) => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
const isoOf = (v) => `DATE_FORMAT(${v}, '%Y-%m-%dT%T.%fZ')`;

/**
 * The parent's renewal as one compound statement root applies through the
 * mariadb client (`mariadb -uroot -N -B vault < statement`), SOL decision L.
 *
 * The identities are the composition's (`expected`, in order), then any
 * record of a unit outside it. In one transaction:
 *   - the universe must be known to this Vault (at least one identity row);
 *     otherwise nothing is checked, UNIT_BOOTSTRAP_RENEWAL_HALTED (ERROR,
 *     reason `universe-unknown`) is committed, and the answer is `halted`;
 *   - each recorded identity's row is locked (FOR UPDATE) and classified:
 *       due           consistent, expiring within `withinSeconds`
 *       current       consistent, expiring later
 *       inconsistent  incarnation, epoch, grants or bootstrap digest differ
 *                     (the detail names which)
 *       revoked       revoked (never revived)
 *       expired       already expired (renewing it would revive it)
 *       missing       no record for an expected unit (`no-record`), or no row
 *                     for this unit in this universe (`no-row`)
 *       unexpected    a record of a unit the composition does not declare
 *   - each due one is extended by `extendSeconds` from its current expiry,
 *     guarded on every recorded field, with its UNIT_BOOTSTRAP_RENEWED outbox
 *     row (event id `<renewalId>:<n>`, correlationId = renewalId);
 *   - when any identity is blocked, UNIT_BOOTSTRAP_RENEWAL_PARTIAL (ERROR,
 *     event id = renewalId, every identity's state) is committed with them.
 * Any SQL error — an extension that does not touch exactly its row, an
 * outbox row refused — rolls the whole transaction back (exit handler) and
 * fails the client: nothing of the run remains.
 *
 * Its answer is one row per identity, `unit <TAB> state <TAB> expiry <TAB>
 * detail` (state in RENEWAL_STATES; expiry as Vault holds it after the run,
 * or `-`; detail `-`, the differing fields, or why it is blocked), then one summary row `* <TAB> complete|partial|halted <TAB>
 * <renewed count> <TAB> <blocked count>`.
 *
 * @param {object} options
 * @param {string} options.universe
 * @param {object[]} options.records - parent records (validateRecord)
 * @param {string[]} [options.expected] - the composition's identities; default: the records' units
 * @param {string} options.renewalId - a UUID naming this run in evidence
 * @param {number} [options.withinSeconds]
 * @param {number} [options.extendSeconds]
 * @returns {string}
 */
export function renewalStatement({ universe, records, expected, renewalId, withinSeconds = RENEW_WITHIN_SECONDS, extendSeconds = RENEW_EXTEND_SECONDS }) {
  if (typeof universe !== 'string' || !UUID.test(universe)) fail('RENEWAL_INVALID', 'universe must be a UUID');
  if (typeof renewalId !== 'string' || !UUID.test(renewalId)) fail('RENEWAL_INVALID', 'renewalId must be a UUID');
  if (!Array.isArray(records)) fail('RENEWAL_INVALID', 'records must be an array');
  if (!Number.isInteger(withinSeconds) || withinSeconds < 60 || withinSeconds > 366 * 24 * 3600) fail('RENEWAL_INVALID', 'within must be 60 s to 366 days');
  if (!Number.isInteger(extendSeconds) || extendSeconds < 60 || extendSeconds > 366 * 24 * 3600) fail('RENEWAL_INVALID', 'extend must be 60 s to 366 days');
  const checked = records.map(validateRecord);
  if (new Set(checked.map((r) => r.unit)).size !== checked.length) fail('RENEWAL_INVALID', 'one record per unit');
  const wanted = expected === undefined ? checked.map((r) => r.unit) : expected;
  if (!Array.isArray(wanted) || !wanted.every((u) => typeof u === 'string' && NAME.test(u)) || new Set(wanted).size !== wanted.length) {
    fail('RENEWAL_INVALID', 'expected identities are distinct functional slugs');
  }
  const byUnit = new Map(checked.map((r) => [r.unit, r]));
  const entries = [
    ...wanted.map((unit) => ({ unit, record: byUnit.get(unit) || null, expected: true })),
    ...checked.filter((r) => !wanted.includes(r.unit)).map((r) => ({ unit: r.unit, record: r, expected: false })),
  ];
  if (!entries.length || entries.length > 64) fail('RENEWAL_INVALID', 'one to 64 identities');

  const q = sqlString;
  const where = (unit) => `universe_id = ${q(universe)} AND unit_id = ${q(unit)}`;
  const event = (eventId, name, data) => `JSON_OBJECT('pod', 'vault', 'event', '${name}', 'level', '${name === 'UNIT_BOOTSTRAP_RENEWED' ? 'INFO' : 'ERROR'}', 'executionId', ${eventId}, 'correlationId', ${q(renewalId)}, 'data', ${data}, 'sourceEventId', ${eventId})`;
  const outbox = (eventId, variable) => `INSERT INTO event_outbox (event_id, body, body_digest) VALUES (${eventId}, ${variable}, SHA2(${variable}, 256));`;
  const L = [];
  L.push(`-- The parent's bootstrap renewal ${renewalId} (pkg-vault unit-registration.js renew).`);
  L.push('-- Digests and identities only: no bootstrap, no token.');
  L.push('DELIMITER //');
  L.push('BEGIN NOT ATOMIC');
  L.push('  DECLARE known BIGINT DEFAULT 0;');
  L.push('  DECLARE renewed INT DEFAULT 0;');
  L.push('  DECLARE blocked INT DEFAULT 0;');
  entries.forEach((e, i) => {
    const [state, detail] = !e.expected ? ['unexpected', 'not-in-composition'] : e.record ? ['missing', 'no-row'] : ['missing', 'no-record'];
    L.push(`  DECLARE s${i} VARCHAR(16) DEFAULT '${state}';`);
    L.push(`  DECLARE d${i} VARCHAR(64) DEFAULT '${detail}';`);
    L.push(`  DECLARE e${i} DATETIME(3) DEFAULT NULL;`);
  });
  // Any error rolls everything back and reaches the client: nothing of the run remains.
  L.push('  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;');
  L.push('  START TRANSACTION;');
  L.push(`  SELECT COUNT(*) INTO known FROM unit_identities WHERE universe_id = ${q(universe)};`);
  L.push('  IF known = 0 THEN');
  L.push(`    SET @shaper_renewal_alert := ${event(q(renewalId), 'UNIT_BOOTSTRAP_RENEWAL_HALTED',
    `JSON_OBJECT('renewalId', ${q(renewalId)}, 'universe', ${q(universe)}, 'reason', 'universe-unknown', 'renewed', 0)`)};`);
  L.push(`    ${outbox(q(renewalId), '@shaper_renewal_alert')}`);
  L.push('    COMMIT;');
  L.push(`    SELECT '*', 'halted', 0, 'universe-unknown';`);
  L.push('  ELSE');
  entries.forEach((e, i) => {
    const r = e.record;
    if (!e.expected || !r) {
      // Read only, for the answer: nothing of it is checked or changed.
      L.push(`    SELECT bootstrap_expires_at INTO e${i} FROM unit_identities WHERE ${where(e.unit)};`);
      L.push(`    SET blocked = blocked + 1;`);
      return;
    }
    const grants = q(JSON.stringify(r.grants));
    const differs = `incarnation <> ${q(r.incarnation)} OR epoch <> ${r.epoch} OR grants <> ${grants} OR bootstrap_digest <> ${q(r.bootstrapDigest)}`;
    L.push(`    SELECT CASE
        WHEN revoked THEN 'revoked'
        WHEN ${differs} THEN 'inconsistent'
        WHEN bootstrap_expires_at <= UTC_TIMESTAMP(3) THEN 'expired'
        WHEN bootstrap_expires_at > TIMESTAMPADD(SECOND, ${withinSeconds}, UTC_TIMESTAMP(3)) THEN 'current'
        ELSE 'due' END,
      CASE
        WHEN revoked THEN 'revoked'
        WHEN ${differs} THEN CONCAT_WS(',', IF(incarnation <> ${q(r.incarnation)}, 'incarnation', NULL), IF(epoch <> ${r.epoch}, 'epoch', NULL),
          IF(grants <> ${grants}, 'grants', NULL), IF(bootstrap_digest <> ${q(r.bootstrapDigest)}, 'digest', NULL))
        WHEN bootstrap_expires_at <= UTC_TIMESTAMP(3) THEN 'expired'
        ELSE '' END,
      bootstrap_expires_at
    INTO s${i}, d${i}, e${i} FROM unit_identities WHERE ${where(e.unit)} FOR UPDATE;`);
    L.push(`    IF s${i} = 'due' THEN`);
    L.push(`      UPDATE unit_identities SET bootstrap_expires_at = TIMESTAMPADD(SECOND, ${extendSeconds}, bootstrap_expires_at)
        WHERE ${where(e.unit)} AND incarnation = ${q(r.incarnation)} AND epoch = ${r.epoch} AND grants = ${grants}
          AND bootstrap_digest = ${q(r.bootstrapDigest)} AND NOT revoked AND bootstrap_expires_at = e${i};`);
    L.push(`      IF ROW_COUNT() <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'renewal: the locked identity ${e.unit} did not take its extension'; END IF;`);
    const eventId = q(`${renewalId}:${i}`);
    L.push(`      SET @shaper_renewal_proof := ${event(eventId, 'UNIT_BOOTSTRAP_RENEWED',
      `JSON_OBJECT('renewalId', ${q(renewalId)}, 'universe', ${q(universe)}, 'unit', ${q(e.unit)}, 'incarnation', ${q(r.incarnation)}, 'epoch', ${r.epoch}, 'previousExpiry', ${isoOf(`e${i}`)}, 'newExpiry', ${isoOf(`TIMESTAMPADD(SECOND, ${extendSeconds}, e${i})`)})`)};`);
    L.push(`      ${outbox(eventId, '@shaper_renewal_proof')}`);
    L.push(`      SET s${i} = 'renewed', renewed = renewed + 1;`);
    L.push(`    ELSEIF s${i} <> 'current' THEN SET blocked = blocked + 1;`);
    L.push('    END IF;');
  });
  const units = entries.map((e, i) => `JSON_OBJECT('unit', ${q(e.unit)}, 'state', s${i}, 'detail', d${i}, 'expiry', ${isoOf(`e${i}`)})`).join(',\n        ');
  L.push('    IF blocked > 0 THEN');
  L.push(`      SET @shaper_renewal_alert := ${event(q(renewalId), 'UNIT_BOOTSTRAP_RENEWAL_PARTIAL',
    `JSON_OBJECT('renewalId', ${q(renewalId)}, 'universe', ${q(universe)}, 'renewed', renewed + 0, 'blocked', blocked + 0, 'units', JSON_ARRAY(\n        ${units}))`)};`);
  L.push(`      ${outbox(q(renewalId), '@shaper_renewal_alert')}`);
  L.push('    END IF;');
  L.push('    COMMIT;');
  const rows = entries.map((e, i) => `SELECT ${q(e.unit)}, s${i},
      COALESCE((SELECT ${isoOf('bootstrap_expires_at')} FROM unit_identities WHERE ${where(e.unit)}), '-'), IF(d${i} = '', '-', d${i})`);
  rows.push(`SELECT '*', IF(blocked > 0, 'partial', 'complete'), renewed, blocked`);
  L.push(`    ${rows.join('\n    UNION ALL ')};`);
  L.push('  END IF;');
  L.push('END //');
  L.push('DELIMITER ;');
  return `${L.join('\n')}\n`;
}

/**
 * What one renewal committed, re-read from Vault's outbox — the proofs, not
 * the lost acknowledgement. Rows: `unit <TAB> renewed <TAB> newExpiry <TAB> -`
 * for each UNIT_BOOTSTRAP_RENEWED of that run, `* <TAB> partial|halted <TAB>
 * renewed <TAB> blocked` when the run committed its alert, then
 * `# <TAB> read <TAB> - <TAB> -`, which proves the query ran. No row but the
 * last: the run changed nothing (rolled back, never applied, or nothing due).
 * @param {{ renewalId: string }} options
 * @returns {string}
 */
export function renewalReadbackStatement({ renewalId }) {
  if (typeof renewalId !== 'string' || !UUID.test(renewalId)) fail('RENEWAL_INVALID', 'renewalId must be a UUID');
  const id = sqlString(renewalId);
  return `-- What renewal ${renewalId} committed, re-read from Vault's outbox.
SELECT JSON_VALUE(body, '$.data.unit'), 'renewed', JSON_VALUE(body, '$.data.newExpiry'), '-' FROM event_outbox
  WHERE event_id LIKE ${sqlString(`${renewalId}:%`)} AND JSON_VALUE(body, '$.event') = 'UNIT_BOOTSTRAP_RENEWED'
  AND JSON_VALUE(body, '$.correlationId') = ${id}
UNION ALL
SELECT '*', IF(JSON_VALUE(body, '$.event') = 'UNIT_BOOTSTRAP_RENEWAL_PARTIAL', 'partial', 'halted'),
  COALESCE(JSON_VALUE(body, '$.data.renewed'), '0'), COALESCE(JSON_VALUE(body, '$.data.blocked'), '-') FROM event_outbox
  WHERE event_id = ${id} AND JSON_VALUE(body, '$.event') IN ('UNIT_BOOTSTRAP_RENEWAL_PARTIAL', 'UNIT_BOOTSTRAP_RENEWAL_HALTED')
UNION ALL
SELECT '#', 'read', '-', '-';
`;
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
    const files = [], expected = [];
    let withinSeconds = RENEW_WITHIN_SECONDS, extendSeconds = RENEW_EXTEND_SECONDS, renewalId = randomUUID();
    for (let i = 0; i < rest.length; i += 2) {
      const [flag, value] = [rest[i], rest[i + 1]];
      if (value === undefined) fail('RENEWAL_INVALID', `${flag} needs a value`);
      if (flag === '--record') files.push(value);
      else if (flag === '--expect') expected.push(value);
      else if (flag === '--renewal-id') renewalId = value;
      else if (flag === '--within-seconds') withinSeconds = Number(value);
      else if (flag === '--extend-seconds') extendSeconds = Number(value);
      else fail('RENEWAL_INVALID', `unknown option ${flag}`);
    }
    // A record that cannot be trusted is an input that cannot be verified:
    // the whole run halts (decision L), it is never read as "missing".
    const records = files.map((file) => {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.mode & 0o077) fail('RECORD_UNTRUSTED', `${file} must be a private regular file`);
      let record;
      try { record = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fail('RECORD_INVALID', `${file} is not JSON`); }
      if (record?.unit !== path.basename(file, '.json')) fail('RECORD_INVALID', `${file} records another unit`);
      return record;
    });
    process.stdout.write(renewalStatement({ universe: env.SHAPER_UNIVERSE_ID, records, expected: expected.length ? expected : undefined,
      renewalId, withinSeconds, extendSeconds }));
    return;
  }
  if (command === 'readback') {
    if (rest[0] !== '--renewal-id' || rest.length !== 2) fail('RENEWAL_INVALID', 'readback takes --renewal-id <uuid>');
    process.stdout.write(renewalReadbackStatement({ renewalId: rest[1] }));
    return;
  }
  fail('USAGE', 'usage: unit-registration.js public-key | register --unit <slug> --incarnation <id> --grant <audience>=<scope> --bootstrap-file <path> [--ttl-seconds <n>] | renew --expect <slug>… --record <file>… [--renewal-id <uuid>] [--within-seconds <n>] [--extend-seconds <n>] | readback --renewal-id <uuid>');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    cli(process.argv.slice(2), process.env);
  } catch (err) {
    console.error(`[unit-registration] ${err.code || 'ERROR'}: ${err.message}`);
    process.exit(1);
  }
}
