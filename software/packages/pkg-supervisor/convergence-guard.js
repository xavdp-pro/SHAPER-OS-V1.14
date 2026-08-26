/**
 * @module @shaper/pkg-supervisor/convergence-guard
 * Convergence Guard implementation (Rule 27).
 *
 * Prevents reconciliation loops from becoming the outage itself.
 * Features:
 * - Exponential backoff on identical drift signatures
 * - Bounded healing attempts (maxHealingAttempts, default: 3)
 * - Transition to terminal DEGRADED state to prevent restart storms
 */

export class ConvergenceGuard {
  /**
   * @param {object} [options]
   * @param {number} [options.maxAttempts=3] - Max remediation attempts before DEGRADED
   * @param {number} [options.baseBackoffSeconds=5] - Initial backoff interval
   * @param {number} [options.maxBackoffSeconds=300] - Ceiling backoff interval
   */
  constructor({
    maxAttempts = 3,
    baseBackoffSeconds = 5,
    maxBackoffSeconds = 300,
  } = {}) {
    this.maxAttempts = maxAttempts;
    this.baseBackoffSeconds = baseBackoffSeconds;
    this.maxBackoffSeconds = maxBackoffSeconds;
    /** signature -> { attempts: number, lastAttemptAt: number, nextAllowedAt: number, isDegraded: boolean } */
    this.registry = new Map();
  }

  /**
   * Computes a canonical signature for an issue to track persistent drifts.
   * @param {string} universeName
   * @param {string} brickName
   * @param {string} issueCode
   * @returns {string}
   */
  static issueSignature(universeName, brickName, issueCode) {
    return `${universeName}:${brickName}:${issueCode}`;
  }

  /**
   * Checks whether remediation is allowed to proceed or is cooling down / degraded.
   * @param {string} signature
   * @param {number} [now=Date.now()]
   * @returns {{ allowed: boolean, reason?: string, attempts: number, isDegraded: boolean }}
   */
  canRemediate(signature, now = Date.now()) {
    const entry = this.registry.get(signature);
    if (!entry) {
      return { allowed: true, attempts: 0, isDegraded: false };
    }

    if (entry.isDegraded) {
      return {
        allowed: false,
        reason: `Remediation exhausted (${entry.attempts}/${this.maxAttempts} attempts failed) — universe is in terminal DEGRADED state (Rule 27)`,
        attempts: entry.attempts,
        isDegraded: true,
      };
    }

    if (now < entry.nextAllowedAt) {
      const waitSec = Math.ceil((entry.nextAllowedAt - now) / 1000);
      return {
        allowed: false,
        reason: `Backoff cooling down: wait ${waitSec}s before retrying remediation (attempt ${entry.attempts}/${this.maxAttempts})`,
        attempts: entry.attempts,
        isDegraded: false,
      };
    }

    return { allowed: true, attempts: entry.attempts, isDegraded: false };
  }

  /**
   * Records the outcome of a remediation attempt.
   * @param {string} signature
   * @param {boolean} success
   * @param {number} [now=Date.now()]
   * @returns {{ attempts: number, isDegraded: boolean, nextBackoffSeconds: number }}
   */
  recordOutcome(signature, success, now = Date.now()) {
    if (success) {
      this.registry.delete(signature);
      return { attempts: 0, isDegraded: false, nextBackoffSeconds: 0 };
    }

    const prev = this.registry.get(signature) || {
      attempts: 0,
      lastAttemptAt: now,
      nextAllowedAt: now,
      isDegraded: false,
    };

    const attempts = prev.attempts + 1;
    const isDegraded = attempts >= this.maxAttempts;
    const backoffSec = Math.min(
      this.maxBackoffSeconds,
      this.baseBackoffSeconds * Math.pow(2, attempts - 1),
    );

    const updated = {
      attempts,
      lastAttemptAt: now,
      nextAllowedAt: now + backoffSec * 1000,
      isDegraded,
    };

    this.registry.set(signature, updated);
    return { attempts, isDegraded, nextBackoffSeconds: backoffSec };
  }

  /**
   * Clears state for a universe / signature upon manual or guardian intervention.
   * @param {string} [signature]
   */
  reset(signature = null) {
    if (signature) {
      this.registry.delete(signature);
    } else {
      this.registry.clear();
    }
  }
}
