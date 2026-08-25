/**
 * Dynamic lanes — a decision the level above makes, from evidence below.
 *
 * ── Who decides, and why it is not the queue ───────────────────────────────
 * **A universe never widens itself.** It publishes what it can prove — lanes
 * occupied, jobs waiting, throughput achieved — and the parent decides. This is
 * the Law of External Correction (Rule 23) applied to resources rather than to
 * repair, and for the same reason: a child asking itself whether it deserves
 * more is judge and party, and every child would answer yes.
 *
 * Only the parent sees the other children and the host they share. A width that
 * is right for one universe in isolation can starve its siblings, and nothing
 * inside that universe can know it.
 *
 * So this module is a **pure decision function**. It is called by the level
 * above, on evidence gathered from below, and its answer is applied to the
 * child. It holds no timer, mutates nothing, and is never wired into the
 * worker's own loop — that wiring would be the bug, not the feature.
 *
 * ── Why not scale on utilisation ───────────────────────────────────────────
 * The obvious rule, "lanes are busy and jobs are waiting, so add a lane", is
 * wrong often enough to be dangerous. It assumes the bottleneck is here. When
 * the real limit is upstream — an agent's rate limit, a remote API, one slow
 * disk — adding lanes makes throughput **worse**: the same work is spread over
 * more concurrent calls, each one slower, and the queue looks busier while
 * delivering less.
 *
 * Utilisation cannot tell those two worlds apart. Only the outcome can.
 *
 * ── What this does instead ─────────────────────────────────────────────────
 * A hill climb with memory. Widen by one lane, then **measure whether
 * throughput actually rose**. If it did, keep going. If it did not, step back
 * and remember that width as the discovered ceiling, so the same mistake is not
 * repeated every minute.
 *
 * The virtue of this is that it finds the *real* ceiling of this host, this
 * agent and this workload, rather than the one we guessed from a CPU count.
 * The cost is that it needs a few cycles to settle — which is the honest price
 * of not pretending to know.
 *
 * ── The three things it will not do ────────────────────────────────────────
 * 1. **Never exceed `max`.** An operator's ceiling is a fact about the machine
 *    and its budget; no measurement overrides it.
 * 2. **Never widen while nothing waits.** Idle lanes cost nothing and prove
 *    nothing; a change with no pressure behind it teaches us nothing either.
 * 3. **Never shed a lane that is working.** Narrowing happens only from quiet,
 *    and only after sustained quiet, so a lull does not undo a real discovery.
 */

/** A throughput sample: how many jobs finished, over how long. */
export function throughputPerMinute({ completed, seconds }) {
  return seconds > 0 ? (completed / seconds) * 60 : 0;
}

/**
 * Decides the next lane count from the last decision and what followed it.
 *
 * @param {object} state
 *   lanes        current width
 *   min, max     bounds set by the operator
 *   waiting      jobs pending right now
 *   busyLanes    lanes currently occupied
 *   throughput   jobs per minute over the last window
 *   lastAction   'widen' | 'narrow' | 'hold' — what we did last time
 *   lastThroughput  what throughput was before that action
 *   ceiling      width already found not to help, or null
 *   quietCycles  consecutive cycles with nothing waiting
 * @returns {{lanes:number, action:string, why:string, ceiling:(number|null)}}
 */
export function nextLaneCount({
  lanes,
  min = 1,
  max = 1,
  waiting = 0,
  busyLanes = 0,
  throughput = 0,
  lastAction = 'hold',
  lastThroughput = null,
  ceiling = null,
  quietCycles = 0,
  quietCyclesBeforeNarrowing = 3,
  meaningfulGain = 1.05,
} = {}) {
  const hold = (why, over = {}) => ({ lanes, action: 'hold', why, ceiling, ...over });

  // Did the last widening actually buy anything? This is the whole point.
  if (lastAction === 'widen' && lastThroughput !== null) {
    if (throughput < lastThroughput * meaningfulGain) {
      // It did not. Step back, and remember this width so we stop trying it.
      const reverted = Math.max(min, lanes - 1);
      return {
        lanes: reverted,
        action: 'narrow',
        ceiling: lanes,
        why: `widening to ${lanes} did not raise throughput (${throughput.toFixed(2)} vs ${lastThroughput.toFixed(2)}/min) — the bottleneck is not here`,
      };
    }
    // It did. Fall through and consider going further.
  }

  if (waiting === 0) {
    if (quietCycles + 1 >= quietCyclesBeforeNarrowing && lanes > min) {
      return {
        lanes: lanes - 1,
        action: 'narrow',
        ceiling,
        why: `nothing waited for ${quietCycles + 1} cycles — giving a lane back`,
      };
    }
    return hold('nothing is waiting');
  }

  if (busyLanes < lanes) return hold('a lane is already free, width is not the limit');
  if (lanes >= max) return hold(`at the operator ceiling of ${max}`);
  if (ceiling !== null && lanes + 1 >= ceiling) {
    return hold(`${ceiling} was already measured as no better`);
  }

  return {
    lanes: lanes + 1,
    action: 'widen',
    ceiling,
    why: `${waiting} waiting with every lane busy — trying ${lanes + 1} to see if throughput rises`,
  };
}
