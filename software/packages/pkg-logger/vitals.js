/**
 * Vital signs — the shared shape every brick answers on `GET /api/vitals`.
 *
 * ── Why this exists, and why it is not `/api/health` ───────────────────────
 * `/api/health` answers "is a process listening". That is a useful question and
 * a cheap one, and it is **not** the question "does this brick do its job". A
 * vault holding zero secrets answers ok. A logger nobody writes to answers ok.
 * A queue whose bridge is unreachable answers ok. The two endpoints stay
 * separate because they answer different things; merging them would put the
 * cheap answer in front of the honest one.
 *
 * ── The one rule ───────────────────────────────────────────────────────────
 * **A vital sign carries evidence, not a verdict.**
 *
 *   good   { "lastEventAgeSeconds": 4, "eventsSinceStart": 812 }
 *   bad    { "logging": "ok" }
 *
 * The first can be checked by someone who does not trust the brick; the second
 * asks to be believed. Since a universe may not be the judge of its own health
 * (Rule 23 — correction, and therefore diagnosis, comes from outside), every
 * signal must be re-derivable by the reader.
 *
 * Ages rather than booleans: "last beat 320 s ago" on a 300 s cadence is a
 * fault you can see; "beating: true" hides it. Counters only grow, so a parent
 * can derive a rate by sampling twice without anyone storing history.
 */

/** Seconds since an ISO timestamp, or null when it never happened. */
export function ageSeconds(iso, now = Date.now()) {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.round((now - t) / 100) / 10 : null;
}

/**
 * Wraps a brick's own measurements in the common envelope.
 *
 * `signals` are the brick's evidence — numbers, ages, counters. `checks` are
 * the few facts a brick can establish about the world it depends on, each one
 * an object carrying how it was established and when, never a bare boolean.
 */
export function vitals({ service, startedAt, signals = {}, checks = {} }, now = Date.now()) {
  return {
    service,
    at: new Date(now).toISOString(),
    uptimeSeconds: ageSeconds(startedAt, now),
    signals,
    checks,
  };
}

/**
 * A dependency check with its evidence attached.
 *
 * `reachable` is not asserted, it is dated: a probe that succeeded four seconds
 * ago and one that succeeded four hours ago are different facts, and a reader
 * must be able to tell them apart.
 */
export function dependency({ name, url = null, lastOkAt = null, lastError = null, attempts = 0 }, now = Date.now()) {
  return {
    name,
    url,
    lastOkAgeSeconds: ageSeconds(lastOkAt, now),
    lastError: lastError || null,
    attempts,
  };
}

/**
 * Can this path be written to, right now, actually?
 *
 * Not "is it configured" — configuration is an intention. A brick that believes
 * it persists and cannot is the worst kind of failure, because it looks healthy
 * until the moment someone needs what it did not keep.
 */
export async function writable(fsModule, dirPath) {
  if (!dirPath) return { path: null, writable: false, reason: 'no path configured' };
  const probe = `${dirPath.replace(/\/$/, '')}/.vitals-probe`;
  try {
    await fsModule.promises.writeFile(probe, '');
    await fsModule.promises.unlink(probe);
    return { path: dirPath, writable: true };
  } catch (err) {
    return { path: dirPath, writable: false, reason: err.code || err.message };
  }
}

/**
 * Resolves a CLI binary and extracts its actual version by running it (Rule 34).
 */
export function cliCheck(execFileSyncFn, bin, versionArgs = ['--version'], timeout = 3000) {
  if (!bin) return { name: null, resolved: false, version: null, error: 'no binary configured' };
  try {
    const raw = execFileSyncFn(bin, versionArgs, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout,
    });
    const version = String(raw || '').trim().split('\n')[0] || 'unknown';
    return { name: bin, resolved: true, version };
  } catch (err) {
    return { name: bin, resolved: false, version: null, error: err.code || err.message };
  }
}
