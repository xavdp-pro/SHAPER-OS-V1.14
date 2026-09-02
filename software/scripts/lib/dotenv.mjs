// Intent: README.md#quick-start
// Intent: software/packages/pkg-vault/INTENT.md
/**
 * Reads a .env file as DEFAULTS into process.env — one parser for every
 * script that opens the vault (bootstrap, read, patch).
 *
 * Rule 0J names software/.env as the place the operator's keys live, and the
 * repository carries no dotenv (zero dependencies, Rule 5). Until the
 * 2 September audit nothing read that file: the vault bootstrap took
 * VAULT_MASTER_KEY from process.env only and halted on "VAULT_MASTER_KEY is
 * required" with the key sitting in the file the documentation had just told
 * the operator to create. The first correction gave each of the three vault
 * scripts its own ~15-line copy of this parser, and the copies had already
 * diverged by the time they were reviewed (one traced provenance, one printed
 * a second halt line). A lesson that lives in three places is three lessons
 * that drift; it lives here once.
 *
 * Precedence: what the operator exported in the shell WINS over the file,
 * the same precedence deploy/podman-up.sh gives (V1.13.5) and the storage file
 * was given (V1.13.1) — an explicit choice always beats a packaged default.
 *
 * The grammar is deliberately narrow: `KEY=value`, `# comment`, blank. A line
 * this parser cannot read is a halt naming the line, never a silent skip — a
 * skipped key surfaces an hour later as "missing key" with no cause attached.
 * Surrounding quotes are stripped; there are no inline comments and no
 * interpolation, because a value nobody can read back verbatim is a value
 * nobody can audit. Every caller parses BEFORE it writes anything, so the halt
 * can truthfully say nothing was written.
 *
 * @param {string} file  The .env to read; a missing file is simply "no defaults".
 * @param {string} tag   The caller's log prefix, e.g. "[bootstrap-vault]".
 * @returns {Set<string>} The keys the FILE supplied (not the shell) — so a
 *   halt about one of them can name the file rather than "the environment".
 */
import fs from 'node:fs';

export function loadDotEnv(file, tag) {
  const fromFile = new Set();
  if (!fs.existsSync(file)) return fromFile;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      console.error(`${tag} HALT — ${file}:${index + 1} is not KEY=value: "${raw}"`);
      console.error(`${tag} A .env holds KEY=value lines, # comments and blank lines, nothing else. Nothing was written.`);
      process.exit(1);
    }
    const [, key, rawValue] = match;
    const quoted = rawValue.trim().match(/^(["'])(.*)\1$/);
    const value = quoted ? quoted[2] : rawValue.trim();
    // The operator's export wins; the file only fills what the shell left unset.
    if (process.env[key] !== undefined && process.env[key] !== '') return;
    process.env[key] = value;
    fromFile.add(key);
  });
  return fromFile;
}
