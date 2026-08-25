/**
 * What this universe can actually absorb.
 *
 * ── Why a measurement and not a setting ────────────────────────────────────
 * Doctrine is explicit: *a capacity plan without a measured ratio is not a
 * plan, it is intuition*. Lanes are something we choose; throughput is
 * something the machine grants. This module only ever reports the second, and
 * says "unmeasured" rather than guess.
 *
 * ── The arithmetic, and it is short ────────────────────────────────────────
 * With `c` lanes and a mean service time `W`, the most the queue can drain is
 *
 *     λ_max = c / W          (Little's law, at full occupancy)
 *
 * Compare it with the arrival rate `λ` actually observed and you get the
 * utilisation `ρ = λ / λ_max` — the single number that decides whether an
 * infrastructure is well sized.
 *
 * ── The trap ρ hides ───────────────────────────────────────────────────────
 * Waiting time does not grow with ρ, it grows with `1 / (1 − ρ)`. At ρ = 0.5
 * a job waits about as long as it runs; at ρ = 0.9 it waits nine times longer;
 * at ρ = 0.99, ninety-nine times. **A queue at 90% is not "10% from full", it
 * is already broken** — which is why the thresholds below warn long before 1.
 *
 * Two honest ways out when ρ climbs: add lanes (hardware), or shorten W (the
 * work itself). This report gives the numbers to choose between them instead of
 * arguing about it.
 */

const HOUR = 3600;

/**
 * Seconds a job spent **being worked on** — not waiting to be.
 *
 * Little's law needs service time. Measuring from creation instead would fold
 * queue wait into it, and that error grows with load: the busier the queue, the
 * longer the apparent service, the smaller the apparent capacity, the higher
 * the apparent utilisation. A measure that misleads hardest exactly when it is
 * consulted is worse than none.
 *
 * Observed before the fix: two lanes, thirty jobs waiting, utilisation reported
 * as 102 — a hundred times over capacity, from arithmetic alone.
 *
 * Jobs from before this stamp existed fall back to creation time and are
 * counted, because dropping them would bias the sample the other way; they age
 * out of the window on their own.
 */
function serviceSeconds(job) {
  const start = Date.parse(job.result?.startedAt || job.createdAt);
  const end = Date.parse(job.updatedAt || job.createdAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return (end - start) / 1000;
}

const quantile = (sorted, q) => (sorted.length
  ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
  : null);

/**
 * @param {Array}  jobs           every job the queue knows about
 * @param {number} lanes          configured concurrency
 * @param {number} now            reference instant, in ms
 * @param {number} windowSeconds  how far back arrivals are counted
 * @param {number} minSamples     below this, we refuse to publish a rate
 */
export function capacityReport(jobs = [], {
  lanes = 1,
  now = Date.now(),
  windowSeconds = HOUR,
  minSamples = 5,
} = {}) {
  const since = now - windowSeconds * 1000;

  // What counts as a sample of *this* queue's service time:
  //
  //  · it ended — a run still going tells us nothing about how long runs take;
  //  · it ended **inside the window** — capacity describes the present, and a
  //    job that finished this morning describes this morning;
  //  · it actually ran. Orphans settled after a restart measure abandonment,
  //    not work: their span covers hours of nobody watching, and leaving them
  //    in drags the mean far enough to invert the whole report.
  //
  // Both exclusions were found by saturating: the mean read 268 s for runs that
  // take about three, and utilisation came out at 56 times capacity.
  const finished = jobs
    .filter((j) => (j.status === 'COMPLETED' || j.status === 'FAILED')
      && !j.result?.orphaned
      && Date.parse(j.updatedAt || 0) >= since)
    .map(serviceSeconds)
    .filter((s) => s !== null)
    .sort((a, b) => a - b);

  const arrivals = jobs.filter((j) => Date.parse(j.createdAt) >= since).length;
  const observedPerHour = (arrivals / windowSeconds) * HOUR;

  const inFlight = jobs.filter((j) => j.status === 'RUNNING').length;
  const waiting = jobs.filter((j) => j.status === 'PENDING').length;

  // Below the sample floor, every derived figure would be noise dressed as
  // knowledge. Report the raw counts and say plainly that the rest is unknown.
  if (finished.length < minSamples) {
    return {
      lanes,
      verdict: 'unmeasured',
      reason: `${finished.length} finished job(s), ${minSamples} needed before a rate means anything`,
      observed: { samples: finished.length, arrivalsPerHour: round(observedPerHour) },
      inFlight,
      waiting,
    };
  }

  const meanSeconds = finished.reduce((a, b) => a + b, 0) / finished.length;
  const maxPerHour = (lanes / meanSeconds) * HOUR;
  const utilisation = maxPerHour > 0 ? observedPerHour / maxPerHour : 0;

  return {
    lanes,
    verdict: verdictFor(utilisation),
    observed: {
      samples: finished.length,
      meanSeconds: round(meanSeconds),
      medianSeconds: round(quantile(finished, 0.5)),
      p95Seconds: round(quantile(finished, 0.95)),
      arrivalsPerHour: round(observedPerHour),
    },
    throughput: {
      maxPerHour: round(maxPerHour),
      utilisation: round(utilisation, 3),
      // How much longer a job waits than it runs, at this utilisation.
      queueingFactor: utilisation < 1 ? round(1 / (1 - utilisation), 2) : null,
    },
    inFlight,
    waiting,
    // How long the current backlog needs, at the measured pace.
    //
    // Utilisation and backlog answer different questions and must not be
    // conflated. ρ describes a **sustained** arrival rate: a burst of thirty
    // jobs absorbed in a minute leaves ρ low and rightly so, because nothing is
    // arriving at that pace. But an operator watching eighteen jobs queue up
    // wants to know when it clears, and ρ will not tell them.
    //
    // So: two numbers, two questions. Same discipline as health versus vitals.
    backlogSeconds: waiting > 0 ? round((waiting * meanSeconds) / lanes) : 0,
    // What to do about it, stated in the two terms that can actually change.
    levers: {
      lanesForHeadroom: Math.max(lanes, Math.ceil((observedPerHour * meanSeconds) / HOUR / 0.7)),
      meanSecondsForHeadroom: round((0.7 * lanes * HOUR) / Math.max(observedPerHour, 1e-9)),
    },
  };
}

function verdictFor(rho) {
  if (rho < 0.5) return 'comfortable';
  if (rho < 0.7) return 'healthy';
  // Past 0.7 the queueing factor exceeds 3: waiting already dominates working.
  if (rho < 0.85) return 'saturating';
  return 'saturated';
}

const round = (n, digits = 1) => (n === null || !Number.isFinite(n)
  ? null
  : Math.round(n * 10 ** digits) / 10 ** digits);
