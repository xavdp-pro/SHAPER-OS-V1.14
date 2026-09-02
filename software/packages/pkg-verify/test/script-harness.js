import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Shared by the tests that run software/scripts/*.sh against a throwaway
// layout. Not a test file itself: `npm test` only picks up *.test.js.

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
export const SCRIPTS = path.join(REPO, 'software/scripts');
export const BASH = execFileSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).trim();

export function scratch(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * A PATH holding only the tools the scripts need, plus whatever `extra` adds
 * as executables. Built from scratch so that a client installed on the host
 * (a real mariadb-dump, say) cannot be found by accident: the test decides
 * which client exists, the host does not. `omit` removes a tool the scripts
 * normally rely on, to watch what they do when a step after the archive
 * cannot run.
 */
export function shimPath(tmp, name, extra = {}, { omit = [] } = {}) {
  const bin = path.join(tmp, `bin-${name}`);
  fs.mkdirSync(bin, { recursive: true });
  for (const tool of ['bash', 'sh', 'tar', 'gzip', 'du', 'cut', 'sha256sum', 'awk', 'find', 'date', 'mkdir', 'rm', 'mv', 'dirname', 'basename', 'ls', 'head', 'openssl', 'cat']) {
    if (omit.includes(tool)) continue;
    const real = execFileSync('bash', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).trim();
    fs.symlinkSync(real, path.join(bin, tool));
  }
  for (const [tool, body] of Object.entries(extra)) {
    fs.writeFileSync(path.join(bin, tool), `#!${BASH}\n${body}\n`, { mode: 0o755 });
  }
  return bin;
}

/**
 * A recorder standing in for mariadb-dump/mysqldump: writes argv and the
 * MYSQL_PWD it received, then behaves as told. What is under test is how the
 * script calls the client — which name, where the password travels, what
 * happens when it fails — not what MariaDB answers.
 */
export function dumpRecorder(logFile, { exit = 0, output = '-- dump\nCREATE TABLE t (id INT);\n' } = {}) {
  return [
    `printf '%s\\n' "$@" > "${logFile}.argv"`,
    `printf '%s' "\${MYSQL_PWD-<unset>}" > "${logFile}.pwd"`,
    `printf '%s' '${output}'`,
    `exit ${exit}`,
  ].join('\n');
}

/** A throwaway SHAPER_DIR: the script under test copied into scripts/, a vault, a .env. */
export function shaperDir(tmp, name, script) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'data/vault'), { recursive: true });
  fs.copyFileSync(path.join(SCRIPTS, script), path.join(dir, 'scripts', script));
  fs.writeFileSync(path.join(dir, 'data/vault/vault.enc'), 'ciphertext');
  fs.writeFileSync(path.join(dir, '.env'), 'VAULT_MASTER_KEY=the-key-that-opens-the-coffer\n');
  fs.writeFileSync(path.join(dir, 'topology.json'), '{}');
  return dir;
}

export function run(script, args, env, cwd) {
  const r = spawnSync(BASH, [script, ...args], { cwd, env, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

/** The script's code with comment lines removed — a comment that quotes the old defect is not the defect. */
export const nonComment = (file) => fs.readFileSync(path.join(SCRIPTS, file), 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
