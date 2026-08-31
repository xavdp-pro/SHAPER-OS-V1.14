#!/usr/bin/env node
// Intent: software/universes/maker-template/INTENT.md
//
// The maker's loop. It listens on NOTHING — this file opens no server, on
// purpose and forever: what holds power has no inbound door. It asks its
// governor what should exist on its host, runs a frozen recipe with typed
// arguments, reports what happened, and goes back to asking.
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/** Recipes are frozen scripts keyed by work kind and host kind. Arguments
 *  are passed as argv, NEVER concatenated into a shell string: data that
 *  came from a form can never become part of a command. */
export function defaultRecipeRunner({ recipesDir, hostKind }) {
  return async (work) => {
    const script = `${recipesDir}/${hostKind}-${work.kind}.sh`;
    // argv only — the recipe receives typed positions, quotes nothing.
    const args = [work.rowId, work.klass, work.matrix, work.digest, work.account, work.env];
    const { stdout } = await execFileP('bash', [script, ...args], { timeout: 15 * 60 * 1000 });
    // Every recipe ends with one JSON line of facts. Parsed, those facts ride
    // the event into the ledger — the stamp says whether the child ships an
    // acceptance spec, the validation says which step failed — and the
    // governor derives work from facts, never from prose. Unparseable output
    // stays what it is: a tail of text, kept for the audit.
    const lastLine = stdout.trim().split('\n').at(-1) || '';
    try { return JSON.parse(lastLine); } catch { return { stdout: stdout.slice(-2000) }; }
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
      reap: ['REAPING', 'REAPED', 'REAP_FAILED'],
      validate: ['VALIDATING', 'VALIDATED', 'VALIDATION_FAILED'],
    };
    const [begin, done, failed] = EVENTS[work.kind] || [];
    if (!begin) { inFlight -= 1; return log(`unknown work kind "${work.kind}" — refused`); }
    try {
      await reportEvent(work.rowId, begin, {});
      const result = await runRecipe(work);
      await reportEvent(work.rowId, done, result || {});
    } catch (err) {
      // An unclear situation is reported and stops the job — never resolved
      // by improvisation.
      await reportEvent(work.rowId, failed, { error: String(err.message || err).slice(0, 500) });
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
