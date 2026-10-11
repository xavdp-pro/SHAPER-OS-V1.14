// Intent: software/runtime/unit-mariadb/INTENT.md
/**
 * The supervisor's operations on its own MariaDB, as birth.mjs uses them: the
 * root path (the local client, as OS root, by unix_socket), the schema and
 * dump loads, and the application's own credential, checked through a client
 * option file private to root and removed at once — never on a command line.
 *
 * A module of its own so the birth order is proven against a real server
 * (test/birth.live.mjs) with exactly the code the container runs.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EXIT, STATE_DIR, UnitError, redact, rootClientArgs, run } from './lib.mjs';

export const ENGINE_PATH = '/usr/sbin:/usr/bin:/sbin:/bin';

/**
 * @param {object} options
 * @param {ReturnType<import('./lib.mjs').readConfig>} options.config
 * @param {string} options.password - the validated passwd file content
 * @param {Record<string, string>} [options.env] - the clients' environment
 * @param {string} [options.stateDir] - root-only directory for the transient option file
 * @param {string[]} [options.secrets] - values redacted from every message
 * @param {(m: string) => void} [options.log]
 */
export function createDatabaseOps({
  config, password, env = { PATH: ENGINE_PATH, HOME: '/root', LANG: 'C.UTF-8' }, stateDir = STATE_DIR, secrets = [], log = () => {},
}) {
  const rootSql = async (sql, { database = null, what = 'statement' } = {}) => {
    const result = await run('mariadb', rootClientArgs(config.paths.socket, { database }), { input: sql, env, timeoutMs: 3600000 });
    if (result.code !== 0) {
      throw new UnitError('ROOT_PATH_FAILED', `${what}: ${redact(result.stderr.trim() || `exit ${result.code}`, secrets)}`, EXIT.ENGINE);
    }
    return result.stdout;
  };
  const load = async (input, what, code, exitCode) => {
    const result = await run('mariadb', rootClientArgs(config.paths.socket, what === 'schema' ? { database: config.slug } : {}), {
      input, env, timeoutMs: 3600000,
    });
    if (result.code !== 0) {
      throw new UnitError(code, `the ${what} did not load: ${redact(result.stderr.trim().split('\n').slice(-3).join(' / '), secrets)}`, exitCode);
    }
  };
  return {
    rootSql,
    loadSchema: () => load(fs.readFileSync(config.schemaFile), 'schema', 'SCHEMA_APPLY_FAILED', EXIT.SCHEMA_APPLY),
    loadDump: async () => {
      const stat = fs.lstatSync(config.restoreDump);
      if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o077)) {
        throw new UnitError('RESTORE_FAILED', `${config.restoreDump} must be a regular file owned by root and private to it`, EXIT.RESTORE);
      }
      const dump = fs.readFileSync(config.restoreDump);
      log(`restore: loading ${config.restoreDump} (${dump.length} bytes, sha256 ${crypto.createHash('sha256').update(dump).digest('hex').slice(0, 16)}…) through the root path into a fresh datadir`);
      await load(dump, 'dump', 'RESTORE_FAILED', EXIT.RESTORE);
    },
    /**
     * The application's own credential. `database: false` proves only that the
     * password file authenticates the account (USAGE suffices, so it holds
     * before any grant); `database: true` proves the account opens its own
     * database, which needs the grants.
     * @param {{ database?: boolean }} [options]
     * @returns {Promise<{ ok: boolean, detail: string }>}
     */
    checkCredential: async ({ database = true } = {}) => {
      const file = path.join(stateDir, `.client-${crypto.randomBytes(6).toString('hex')}.cnf`);
      const fd = fs.openSync(file, 'wx', 0o600);
      try {
        fs.writeSync(fd, `[client]\nuser=${config.slug}\npassword=${password}\nsocket=${config.paths.socket}\n`);
      } finally {
        fs.closeSync(fd);
      }
      try {
        const result = await run('mariadb', [`--defaults-file=${file}`, '--batch', '--skip-column-names', '-e',
          "SELECT CONCAT(CURRENT_USER(), '|', IFNULL(DATABASE(), ''))", ...(database ? [config.slug] : [])], { env, timeoutMs: 30000 });
        const answer = result.stdout.trim();
        const ok = result.code === 0 && answer === `${config.slug}@localhost|${database ? config.slug : ''}`;
        return { ok, detail: redact(result.stderr.trim() || answer, [...secrets, password]) };
      } finally {
        fs.rmSync(file, { force: true });
      }
    },
  };
}
