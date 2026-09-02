#!/usr/bin/env node
// Intent: software/universes/_maker-template/INTENT.md
//
// The maker's loop. It listens on NOTHING — this file opens no server, on
// purpose and forever: what holds power has no inbound door. It asks its
// governor what should exist on its host, runs a frozen recipe with typed
// arguments, reports what happened, and goes back to asking.
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/** The row's params reach the recipe as `SHAPER_PARAM_<KEY>` variables, on
 *  an environment BUILT for the run — never `process.env` handed down. What
 *  the recipe's environment holds, and nothing else:
 *    - the host's few words a CLI needs to run at all (PATH, HOME, locale);
 *    - the maker's own configuration, `SHAPER_*` (matrices dir, evidence
 *      dir, verifier image…), which is the operator's and not the row's;
 *    - the row's params, allow-listed by the governor and held here to the
 *      same key grammar, because a maker holding root does not trust a
 *      ledger row it cannot read.
 *  An inherited environment was the open door: a governor (or whoever
 *  writes its ledger) putting `LD_PRELOAD` or `BASH_ENV` on a row would
 *  have reached a shell running as root. A key the grammar refuses is not
 *  dropped in silence — the run is refused and the row hears why. */
const INHERITED = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR'];
const OWN_PREFIX = 'SHAPER_';
const PARAM_PREFIX = 'SHAPER_PARAM_';
const PARAM_KEY = /^[a-z][a-z0-9_]{0,31}$/;
const SCALAR = new Set(['string', 'number', 'boolean']);

export function recipeEnvironment(params = {}, base = process.env) {
  const env = {};
  for (const key of INHERITED) if (base[key] !== undefined) env[key] = base[key];
  for (const [key, value] of Object.entries(base)) {
    // The operator's SHAPER_* reach the recipe; a SHAPER_PARAM_* found in
    // the process environment does not — a param is the row's word only.
    if (key.startsWith(OWN_PREFIX) && !key.startsWith(PARAM_PREFIX)) env[key] = value;
  }
  const refused = [];
  for (const [key, value] of Object.entries(params || {})) {
    if (!PARAM_KEY.test(key) || !SCALAR.has(typeof value)) { refused.push(key); continue; }
    env[`${PARAM_PREFIX}${key.toUpperCase()}`] = String(value);
  }
  return { env, refused };
}

/** Recipes are frozen scripts keyed by work kind and host kind. Arguments
 *  are passed as argv, NEVER concatenated into a shell string: data that
 *  came from a form can never become part of a command. */
export function defaultRecipeRunner({ recipesDir, hostKind }) {
  return async (work) => {
    const script = `${recipesDir}/${hostKind}-${work.kind}.sh`;
    // argv only — the recipe receives typed positions, quotes nothing.
    const args = [work.rowId, work.klass, work.matrix, work.digest, work.account, work.env];
    const { env, refused } = recipeEnvironment(work.params);
    if (refused.length) {
      // Not dropped, not sanitised: a row carrying a key the grammar refuses
      // is a row the maker does not run. The refusal rides the event.
      throw new Error(`refused to run ${work.kind}: param key(s) ${refused.map((k) => JSON.stringify(k)).join(', ')} are not words a recipe may receive`);
    }
    const { stdout } = await execFileP('bash', [script, ...args], { env, timeout: 15 * 60 * 1000 });
    // Every recipe ends with one JSON line of facts. Parsed, those facts ride
    // the event into the ledger — the stamp says whether the child ships an
    // acceptance spec, the validation says which step failed — and the
    // governor derives work from facts, never from prose. Unparseable output
    // stays what it is: a tail of text, kept for the audit — except on a
    // stamp. A reap proves its end by its exit code (exit 5 is "not
    // proven"); a birth is proven only by the facts the recipe looked at,
    // and a stamp that ended without them used to be reported STAMPED, and
    // purred. It is a failure: the tail of text rides the STAMP_FAILED.
    const lastLine = stdout.trim().split('\n').at(-1) || '';
    try { return JSON.parse(lastLine); } catch {
      // An adoption is a birth to the ledger — proven by what the recipe
      // looked at, never by its exit code.
      if (work.kind === 'stamp' || work.kind === 'adopt') {
        const err = new Error(`the ${work.kind} recipe ended without a line of facts: ${stdout.trim().slice(-400)}`);
        err.stdout = stdout.slice(-2000);
        throw err;
      }
      return { stdout: stdout.slice(-2000) };
    }
  };
}

export function startMaker({
  governorUrl,
  token,
  host = os.hostname(),          // identity is the host, asked of the host
  version = 'dev',
  lanes = 1,
  intervalMs = 5000,
  inventory = () => [],          // digests this host actually holds
  runRecipe,                     // (work) => Promise — the frozen recipe
  fetchImpl = fetch,
  log = (...a) => console.log('[maker]', ...a),
} = {}) {
  if (!governorUrl || !token || !runRecipe) {
    throw new Error('governorUrl, token and runRecipe are required');
  }
  let stopped = false;
  let inFlight = 0;

  const call = async (path, body) => {
    const res = await fetchImpl(`${governorUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    return res.json();
  };

  const reportEvent = (rowId, event, data) =>
    call(`/api/work/${encodeURIComponent(rowId)}/events`, { event, data })
      .catch((err) => log(`report failed (${event}):`, err.message));

  async function handle(work) {
    inFlight += 1;
    // A table, not branches: a new kind of work is one line here, and the
    // governor's transition table holds the matching line (no dialect).
    const EVENTS = {
      stamp: ['STAMPING', 'STAMPED', 'STAMP_FAILED'],
      reap: ['REAPING', 'REAPED', 'REAP_FAILED', 'REAP_REFUSED'],
      validate: ['VALIDATING', 'VALIDATED', 'VALIDATION_FAILED'],
      // Binding a row to a container that already exists, named by the
      // row's `instance` param (SHAPER_PARAM_INSTANCE on the recipe's
      // environment). The recipe looks, binds, reports `legacy: true` —
      // it creates nothing and never exec's inside.
      adopt: ['ADOPTING', 'ADOPTED', 'ADOPT_FAILED'],
    };
    const [begin, done, failed, refused] = EVENTS[work.kind] || [];
    if (!begin) { inFlight -= 1; return log(`unknown work kind "${work.kind}" — refused`); }
    try {
      await reportEvent(work.rowId, begin, {});
      const result = await runRecipe(work);
      await reportEvent(work.rowId, done, result || {});
    } catch (err) {
      // An unclear situation is reported and stops the job — never resolved
      // by improvisation. And a refusal is not a failure: exit 4 is the
      // recipe saying "I looked, and a robot does not do this" (a production
      // universe asked to end). Reported as a failure it used to be offered
      // again at every beat; under its own name the governor lets the row
      // rest. The exit code is the recipe's contract, so it rides the event.
      const exitCode = typeof err.code === 'number' ? err.code : null;
      const event = refused && exitCode === 4 ? refused : failed;
      await reportEvent(work.rowId, event, {
        error: String(err.message || err).slice(0, 500),
        ...(exitCode === null ? {} : { exitCode }),
      });
    } finally {
      inFlight -= 1;
    }
  }

  async function tick() {
    if (stopped || inFlight >= lanes) return;
    try {
      const out = await call('/api/makers/poll', {
        host, version, lanes, inventory: await inventory(),
      });
      if (!out.ok) {
        log('governor refused the poll:', out.error);
        return;
      }
      for (const work of out.work || []) {
        if (inFlight >= lanes) break;
        handle(work); // a lane must not block the others
      }
      if (out.preload?.length) log('preload ordered:', out.preload.join(', '));
      // A birth the governor withholds is a typed fact in the answer; on the
      // host it used to look exactly like a beat with nothing to do. The
      // journal names the row that waits, the value it waits for, and the
      // predecessor still holding it — so "no work" and "a birth waiting on
      // a reap" are never the same silence.
      if (out.withheld?.length) {
        log('withheld:', out.withheld.map((w) => `${w.rowId} waits on ${w.on} (${w.key})`).join(', '));
      }
    } catch (err) {
      // A governor out of reach is a fact to retry, never a crash: the loop
      // itself is the heartbeat, and stopping it would silence the host.
      log('poll failed:', err.message);
    }
  }

  const timer = setInterval(tick, intervalMs);
  tick();
  log(`asking ${governorUrl} for ${host} (${lanes} lane${lanes > 1 ? 's' : ''})`);
  return { stop() { stopped = true; clearInterval(timer); }, tick };
}
