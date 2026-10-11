// Intent: software/packages/pkg-auth/INTENT.md#secret-files
/**
 * A secret a unit consumes arrives as a private file, named by `<NAME>_FILE`
 * (SOL-DECISIONS-2 §M): the parent mounts that one file read-only, owned by
 * the consuming account, `0400` or `0600`. The value is read once, kept in
 * memory, and never placed back into any process environment.
 *
 * A value in the environment itself (`<NAME>=…`) is accepted only where the
 * caller says so — a disposable DEV store — and refused otherwise: it would sit
 * in the container's configuration, in PID 1's initial environment and in
 * every child that inherits it.
 *
 * No message, code or property of an error ever carries the value.
 */
import fs from 'node:fs';

export class SecretFileError extends Error {
  /**
   * @param {string} code - stable reason
   * @param {string} message - names the variable and the file, never the value
   */
  constructor(code, message) {
    super(message);
    this.name = 'SecretFileError';
    this.code = code;
  }
}

/**
 * Reads a private secret file: a regular file (not a symbolic link), owned by
 * the reading account, with no group or other permission bit, not empty.
 * @param {string} file
 * @param {{ name?: string, uid?: number }} [options]
 * @returns {string} the trimmed value
 */
export function secretFromFile(file, { name = 'secret', uid = process.getuid() } = {}) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (err) {
    throw new SecretFileError('SECRET_FILE_UNREADABLE', `${name}: ${file} cannot be read (${err.code || 'error'})`);
  }
  if (!stat.isFile()) throw new SecretFileError('SECRET_FILE_UNTRUSTED', `${name}: ${file} is not a regular file`);
  if (stat.uid !== uid) throw new SecretFileError('SECRET_FILE_UNTRUSTED', `${name}: ${file} belongs to uid ${stat.uid}, not to its reader (${uid})`);
  if (stat.mode & 0o077) {
    throw new SecretFileError('SECRET_FILE_UNTRUSTED', `${name}: ${file} has mode ${(stat.mode & 0o777).toString(8)}; a secret file is 0400 or 0600`);
  }
  let value;
  try {
    value = fs.readFileSync(file, 'utf8').trim();
  } catch (err) {
    throw new SecretFileError('SECRET_FILE_UNREADABLE', `${name}: ${file} cannot be read (${err.code || 'error'})`);
  }
  if (!value) throw new SecretFileError('SECRET_FILE_EMPTY', `${name}: ${file} is empty`);
  return value;
}

/**
 * The secret `<name>`: from the file `<name>_FILE` names, or — only when
 * `allowEnvValue` — from `<name>` itself. Both set is ambiguous and refused.
 * @param {Record<string, string|undefined>} env
 * @param {string} name
 * @param {{ allowEnvValue?: boolean, uid?: number }} [options]
 * @returns {string|null} null when neither is set
 */
export function readSecret(env, name, { allowEnvValue = false, uid } = {}) {
  const file = env[`${name}_FILE`];
  const value = env[name];
  if (file && value) {
    throw new SecretFileError('SECRET_AMBIGUOUS', `${name} and ${name}_FILE are both set; a secret has one source`);
  }
  if (file) return secretFromFile(file, { name, ...(uid === undefined ? {} : { uid }) });
  if (value) {
    if (!allowEnvValue) {
      throw new SecretFileError('SECRET_IN_ENVIRONMENT', `${name} is set in the environment; give its file in ${name}_FILE instead (the environment is DEV scaffolding only)`);
    }
    return value.trim() || null;
  }
  return null;
}

/**
 * The first of several names that is set (an alias pair such as
 * QUEUE_BRIDGE_TOKEN, then BRIDGE_AUTH_TOKEN), each by file or value as
 * readSecret decides.
 * @param {Record<string, string|undefined>} env
 * @param {string[]} names
 * @param {{ allowEnvValue?: boolean, uid?: number }} [options]
 * @returns {string|null}
 */
export function readFirstSecret(env, names, options = {}) {
  for (const name of names) {
    const value = readSecret(env, name, options);
    if (value) return value;
  }
  return null;
}
