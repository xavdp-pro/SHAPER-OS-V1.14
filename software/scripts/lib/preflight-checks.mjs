// Intent: docs/proof/proof-rule-11-in-production.md#a-variables-file-holds-only-variables
// Intent: software/RULES.md#rule-11-declared-ports-are-free
//
// The pure half of the start-line gate. preflight.mjs observes the machine
// (reads files, runs `ss`) and hands what it saw to these functions, which
// decide and never touch anything — so a test can feed them the exact text
// that broke a deployment and prove the verdict, without a machine that
// reproduces the breakage. Node built-ins only, like the gate itself.
//
// Two lessons from the first night Rule 11 ran in production (1 September
// 2026, docs/proof/proof-rule-11-in-production.md) live here:
//
//   * A variables file holds only variables. A human note slipped into
//     tokens.env (`BACKOFFICE_ADMIN = email / password`) was EXECUTED by the
//     `source` that loads the file, and the script died before it could
//     print its own failure message. The gate had a filter for keys, but the
//     filter silently dropped whatever did not match — and its pattern,
//     `^[A-Z_]+=`, dropped every honest key carrying a digit (R2_BUCKET_NAME)
//     as well. A line that is not a variable is now a halt that quotes it.
//
//   * A declared port is a claim on the whole universe. Bricks run with
//     `--network host`, so a port the manifest declares is a port nothing
//     else in the LXC may hold. A container born before Rule 11 still had
//     its apt-installed MariaDB on 3306; the podman brick crash-looped and
//     the only place the cause was visible was the brick's own journal.

/** A key a shell would export: uppercase, may carry digits after the first letter. */
export const ENV_KEY = /^[A-Z][A-Z0-9_]*$/;

/**
 * A value `source` exports as written, without running anything. Three
 * shapes: a double-quoted string (bash still expands `$(…)` and backticks
 * inside it, so those two are refused), a single-quoted string (nothing is
 * expanded), or a bare word. A bare word may not carry whitespace or a shell
 * operator: `KEY=1; rm -rf x` exports KEY=1 and RUNS the rest, `KEY=a b`
 * runs `b` with KEY=a in its environment, `KEY=a>b` creates a file. The
 * first grammar admitted every `KEY=value` line and so let a value that is
 * itself a command through both guards — the reviewer of the first fix
 * proved it with `KEY=1; echo INJECTED`. The bash side of this grammar is
 * the grep in universes/_template/deploy/podman-up.sh; the two are kept
 * identical by the test that feeds both the same lines.
 */
export const ENV_VALUE = /^("([^"`$]|\$[^(])*\$?"|'[^']*'|[^ \t;&|()<>`'"]*)$/;

/**
 * Reads an environment file line by line. Admitted: blank lines, `#`
 * comments, and `KEY=value` with a value bash exports as written. Anything
 * else is reported with its line number and its text, so the halt can quote
 * it — a halt that names nothing sends the human hunting through the file
 * the way the script did on terrain.
 *
 * @param {string} text
 * @returns {{ entries: Record<string,string>, errors: Array<{line:number, text:string, reason:string}> }}
 */
export function parseEnvFile(text) {
  const entries = {};
  const errors = [];
  const lines = String(text).split('\n');
  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    if (/^\s*(#|$)/.test(line)) return;
    const eq = line.indexOf('=');
    if (eq === -1) {
      errors.push({ line: i + 1, text: line, reason: 'no "=" — not a variable' });
      return;
    }
    const key = line.slice(0, eq);
    if (!ENV_KEY.test(key)) {
      const reason = /\s/.test(key)
        ? 'the key carries whitespace — a shell would run it as a command'
        : `"${key}" is not a KEY a shell exports ([A-Z][A-Z0-9_]*)`;
      errors.push({ line: i + 1, text: line, reason });
      return;
    }
    const value = line.slice(eq + 1);
    if (!ENV_VALUE.test(value)) {
      errors.push({
        line: i + 1,
        text: line,
        reason: 'the value would be RUN or reshaped by source, not exported as written — quote it, and keep $(…) and backticks out of it',
      });
    }
    // The entry is kept even when its value is refused: a placeholder such
    // as `<same as .env VAULT_MASTER_KEY>` is both unexportable and still
    // the documentation, and the gate owes the second verdict too — it is
    // the one that tells an agent who copied the example what to do.
    entries[key] = value;
  });
  return { entries, errors };
}

/** The port at the end of an `addr:port` token, with `*`, IPv4 and bracketed IPv6 forms. */
function portOf(token) {
  const m = /:(\d+)$/.exec(token);
  return m ? Number(m[1]) : null;
}

/**
 * Listening TCP ports as `ss -ltnH` (optionally `-p`) prints them, one socket
 * per line: `LISTEN 0 80 127.0.0.1:3306 0.0.0.0:* users:(("mariadbd",pid=1234,fd=20))`.
 * The process is known only when ss was allowed to see it; the port is
 * always known.
 *
 * @param {string} output
 * @returns {Map<number, {port:number, address:string, process:string|null}>}
 */
export function portsInUse(output) {
  const inUse = new Map();
  for (const raw of String(output).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const cols = line.split(/\s+/);
    // With the header suppressed the local address is the 4th column; a
    // header line that slipped through has no port there and is skipped.
    const local = cols[3] || '';
    const port = portOf(local);
    if (port === null) continue;
    const proc = /users:\(\("([^"]+)",pid=(\d+)/.exec(line);
    const process = proc ? `${proc[1]} (pid ${proc[2]})` : null;
    if (!inUse.has(port) || (process && !inUse.get(port).process)) {
      inUse.set(port, { port, address: local, process });
    }
  }
  return inUse;
}

/**
 * The same map, read from /proc/net/tcp and /proc/net/tcp6 when `ss` is not
 * on the machine. The kernel writes addresses in hex and the state as a hex
 * byte; 0A is LISTEN. No process is known this way.
 *
 * @param {string} procText  the concatenated contents of the /proc files
 */
export function portsInUseFromProc(procText) {
  const inUse = new Map();
  for (const raw of String(procText).split('\n')) {
    const cols = raw.trim().split(/\s+/);
    if (cols.length < 4 || !/^\d+:$/.test(cols[0])) continue;
    if (cols[3] !== '0A') continue;
    const m = /:([0-9A-Fa-f]{4})$/.exec(cols[1]);
    if (!m) continue;
    const port = parseInt(m[1], 16);
    if (!inUse.has(port)) inUse.set(port, { port, address: cols[1], process: null });
  }
  return inUse;
}

/**
 * The ports a universe manifest claims: every `bricks.<name>.port`.
 *
 * @param {object} manifest  the parsed manifest.json
 * @returns {Array<{brick:string, port:number}>}
 */
export function manifestPorts(manifest) {
  const claimed = [];
  const bricks = (manifest && manifest.bricks) || {};
  for (const [brick, spec] of Object.entries(bricks)) {
    const port = spec && spec.port;
    if (Number.isInteger(port)) claimed.push({ brick, port });
  }
  return claimed;
}

/**
 * Which declared ports are already held, and by what — the verdict the gate
 * prints. Empty means every declared port is free.
 *
 * @param {Array<{brick:string, port:number}>} declared
 * @param {Map<number, {port:number, address:string, process:string|null}>} inUse
 */
export function collisions(declared, inUse) {
  return declared
    .filter(({ port }) => inUse.has(port))
    .map(({ brick, port }) => ({ brick, port, process: inUse.get(port).process }));
}

/**
 * The container the template runs a brick in: `<slug>-<brick minus "brick-">`
 * — `univ-x-dev/manifest.json` declaring `brick-vault` runs as
 * `univ-x-dev-vault` (podman-up.sh: `podman run --name "${SLUG}-vault"`).
 */
export function ownContainerName(slug, brick) {
  return `${slug}-${brick.replace(/^brick-/, '')}`;
}

/**
 * Splits the collisions into the two cases the gate must tell apart. A port
 * held by THIS universe's own brick, left running by a previous podman-up.sh,
 * is not a defect: the deploy is idempotent by design (`--replace` on every
 * `podman run`) and replaces that container. A port held by anything else is
 * the lesson-8 halt. The first fix could not tell them apart — with
 * `--network host`, `ss -p` shows the brick's own `node` or `mariadbd`
 * exactly like a foreign one — so the second deploy of a stack (a retry after
 * a red health, an update) halted on its own vault and told the human to
 * disable "a service installed before Rule 11". The running containers,
 * as `podman ps --format '{{.Names}}'` lists them, are the missing witness.
 *
 * @param {Array<{brick:string, port:number, process:string|null}>} held
 * @param {string} slug             the universe directory's basename (or UNIV_SLUG)
 * @param {Iterable<string>} running  names of the containers podman reports running
 */
export function classifyCollisions(held, slug, running) {
  const names = new Set(running);
  const own = [];
  const foreign = [];
  for (const c of held) {
    const container = ownContainerName(slug, c.brick);
    if (names.has(container)) own.push({ ...c, container });
    else foreign.push(c);
  }
  return { own, foreign };
}
