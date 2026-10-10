// Intent: software/runtime/unit-mariadb/INTENT.md
/**
 * Birth and convergence of the unit's database through the root path, once the
 * engine this supervisor started answers. The order is the guarantee:
 *
 *   first birth only    remove every account but root and mariadb.sys; root by unix_socket alone
 *   always              refuse unsafe administrative accounts            (exit 8)
 *   always              refuse a retained schema of another version      (exit 7)
 *   empty database      birth the schema from the image, or from a dump
 *   always              the account exists; the password file opens it   (exit 9)
 *   always              DML-only grants converged, then verified          (exit 10)
 *
 * A refusal happens before any grant or schema statement. The operations are
 * injected (`ops`) so the order is tested without a server; the supervisor
 * supplies the real root client.
 */
import {
  EXIT, PRINCIPALS_SQL, UnitError,
  adminPredicateSql, assertGrants, createAccountSql, createDatabaseSql, decideSchema,
  firstBirthSql, grantsObservationSql, grantsSql, parseAdminPredicate, parsePrincipals,
  parseRetained, parseVersion, retainedSchemaSql, schemaVersionSql,
} from './lib.mjs';

/**
 * @param {object} args
 * @param {ReturnType<import('./lib.mjs').readConfig>} args.config
 * @param {boolean} args.fresh - the datadir was born by this start
 * @param {string} args.password - validated content of the passwd file
 * @param {object} args.ops
 * @param {(sql: string, o?: { database?: string, what?: string }) => Promise<string>} args.ops.rootSql
 * @param {() => Promise<void>} args.ops.loadSchema - the image's schema into the unit database, as root
 * @param {() => Promise<void>} args.ops.loadDump - the restore dump, as root
 * @param {() => Promise<{ ok: boolean, detail: string }>} args.ops.checkCredential
 * @param {() => void} [args.abort] - throws when a stop was requested
 * @param {(m: string) => void} [args.log]
 * @returns {Promise<{ schema: 'applied'|'restored'|'retained', version: number }>}
 */
export async function birthOrKeep({ config, fresh, password, ops, abort = () => {}, log = () => {} }) {
  const { slug } = config;

  if (fresh) {
    const principals = parsePrincipals(await ops.rootSql(PRINCIPALS_SQL, { what: 'read the accounts mariadb-install-db created' }));
    const removed = principals
      .filter((p) => !['root@localhost', 'mariadb.sys@localhost'].includes(`${p.user}@${p.host}`))
      .map((p) => `${p.user}@${p.host}`);
    await ops.rootSql(firstBirthSql(principals), { what: 'first-birth hardening' });
    log(`engine: first birth hardened — root@localhost by unix_socket only; removed [${removed.join(', ')}]; no test database`);
  }
  abort();

  let observation;
  try {
    observation = parseAdminPredicate(await ops.rootSql(adminPredicateSql(slug), { what: 'observe the administrative accounts' }));
  } catch (err) {
    if (err instanceof UnitError && err.code === 'ADMIN_AUTHENTICATION_MISMATCH') throw err;
    throw new UnitError('ADMIN_AUTHENTICATION_MISMATCH', `the administrative accounts cannot be observed: ${err.message}`, EXIT.ADMIN);
  }
  if (!observation.valid) {
    throw new UnitError(
      'ADMIN_AUTHENTICATION_MISMATCH',
      `existing accounts require a separate authorized administrative repair: ${observation.rootAccounts} root account(s); unexpected principals [${observation.unexpected.join(', ')}]; root must be root@localhost by unix_socket alone, PUBLIC must hold nothing`,
      EXIT.ADMIN,
    );
  }
  log(`admin: root@localhost by unix_socket only; principals limited to root, mariadb.sys and ${slug}`);
  abort();

  const inspect = async () => {
    const retained = parseRetained(await ops.rootSql(retainedSchemaSql(slug), { what: 'observe the retained database' }));
    const version = retained.hasMeta ? parseVersion(await ops.rootSql(schemaVersionSql(slug), { what: 'read schema_meta' })) : null;
    return { retained, version };
  };
  const before = await inspect();
  const decision = decideSchema({ retained: before.retained, version: before.version, declared: config.schemaVersion });

  let schema = 'retained';
  let version = before.version;
  if (decision === 'retained') {
    if (config.restoreDump) {
      throw new UnitError('RESTORE_REQUIRES_FRESH_DATADIR', 'UNIT_RESTORE_DUMP is honoured only by an empty unit database', EXIT.RESTORE);
    }
    log(`schema: retained ${slug} at exactly version ${version} (${before.retained.tables} tables); nothing re-applied`);
  } else {
    await ops.rootSql(createDatabaseSql(slug), { what: 'create the unit database' });
    if (config.restoreDump) {
      await ops.loadDump();
      schema = 'restored';
    } else {
      await ops.loadSchema();
      schema = 'applied';
    }
    const after = await inspect();
    if (after.version !== config.schemaVersion) {
      throw new UnitError('SCHEMA_VERSION_MISMATCH', `the ${schema} schema records version ${after.version}; this image declares exactly ${config.schemaVersion}`, EXIT.SCHEMA_VERSION);
    }
    version = after.version;
    log(`schema: ${schema} — ${slug} at version ${version} (${after.retained.tables} tables), by root`);
  }
  abort();

  await ops.rootSql(createAccountSql(slug, password), { what: 'ensure the unit account' });
  const credential = await ops.checkCredential();
  if (!credential.ok) {
    throw new UnitError(
      'CREDENTIAL_MISMATCH',
      `${config.paths.passwd} does not open ${slug}@localhost on ${slug} (${credential.detail}). Rotation is an explicit, recovery-safe procedure; it is never done at start.`,
      EXIT.CREDENTIAL,
    );
  }
  await ops.rootSql(grantsSql(slug), { what: 'converge the unit grants' });
  assertGrants(await ops.rootSql(grantsObservationSql(slug), { what: 'observe the unit grants' }), slug);
  log(`account: ${slug}@localhost opens with ${config.paths.passwd}; SELECT, INSERT, UPDATE, DELETE on ${slug}.* and nothing else`);
  return { schema, version };
}
