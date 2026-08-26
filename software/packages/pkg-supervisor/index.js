/**
 * @module @shaper/pkg-supervisor
 * Parent Supervisor Engine — Sovereign External Healing (Rule 23 & Rule 27).
 */

import { EventEmitter } from 'node:events';
import { diagnoseUniverse, HEALTH_STATUS } from './diagnostics.js';
import { ConvergenceGuard } from './convergence-guard.js';
import { vitals, ageSeconds } from '../pkg-logger/vitals.js';
import { ingestLog } from '../pkg-logger/ingest-client.js';

export * from './diagnostics.js';
export * from './convergence-guard.js';

export class SupervisorEngine extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} [options.name='univ-test-father-supervisor']
   * @param {string} [options.loggerUrl] - Where the supervisor logs audit events
   * @param {Array<object>} [options.children=[]] - List of monitored child universe configs
   * @param {Function} [options.fetchImpl=fetch]
   * @param {Function} [options.execImpl] - External command executor for container/remediation actions
   * @param {ConvergenceGuard} [options.convergenceGuard]
   */
  constructor({
    name = 'supervisor-v1',
    loggerUrl = null,
    children = [],
    fetchImpl = fetch,
    execImpl = null,
    convergenceGuard = new ConvergenceGuard({ maxAttempts: 3, baseBackoffSeconds: 2 }),
  } = {}) {
    super();
    this.name = name;
    this.loggerUrl = loggerUrl;
    this.children = new Map(children.map(c => [c.name, c]));
    this.fetchImpl = fetchImpl;
    this.execImpl = execImpl;
    this.guard = convergenceGuard;
    this.startedAt = new Date().toISOString();
    this.lastReconcileAt = null;
    this.metrics = {
      reconciliationsTotal: 0,
      healingsAttempted: 0,
      healingsSucceeded: 0,
      degradedTotal: 0,
    };
    this.remediationHandlers = new Map();
    this.registerDefaultRemediations();
  }

  registerDefaultRemediations() {
    // 1. Unreachable Service / Container Down
    this.registerRemediation('SERVICE_UNREACHABLE', async (child, issue) => {
      if (!this.execImpl) return { success: false, reason: 'No execImpl available for cold restart' };
      const containerName = `${child.name}-${issue.brick}`;
      try {
        let logs = '';
        try {
          logs = String(await this.execImpl(`podman logs --tail 50 ${containerName}`) || '').slice(0, 8000);
        } catch {
          logs = '';
        }
        await this.execImpl(`podman start ${containerName} || podman restart ${containerName}`);
        return { success: true, action: `Started container ${containerName}`, logsTail: logs };
      } catch (err) {
        return { success: false, reason: err.message };
      }
    });

    // 2. Storage / Disk Fault
    this.registerRemediation('STORAGE_UNWRITABLE', async (child, issue) => {
      if (!this.execImpl) return { success: false, reason: 'No execImpl available for storage repair' };
      const targetPath = issue.path;
      if (!targetPath) return { success: false, reason: 'No path in issue metadata' };
      try {
        await this.execImpl(`chmod 777 ${targetPath} || chmod -R u+rwX ${targetPath}`);
        return { success: true, action: `Repaired permissions on ${targetPath}` };
      } catch (err) {
        return { success: false, reason: err.message };
      }
    });

    // 3. Stalled Cadence
    this.registerRemediation('STALLED_CADENCE', async (child, issue) => {
      if (!this.execImpl) return { success: false, reason: 'No execImpl available for cadence recovery' };
      const maestroContainer = `${child.name}-maestro`;
      try {
        await this.execImpl(`podman restart ${maestroContainer}`);
        return { success: true, action: `Restarted maestro container ${maestroContainer}` };
      } catch (err) {
        return { success: false, reason: err.message };
      }
    });

    // 4. Bridge error rate
    this.registerRemediation('HIGH_ERROR_RATE', async (child, issue) => {
      if (!this.execImpl) return { success: false, reason: 'No execImpl available for bridge reset' };
      const bridgeContainer = `${child.name}-${issue.brick}`;
      try {
        await this.execImpl(`podman restart ${bridgeContainer}`);
        return { success: true, action: `Restarted bridge container ${bridgeContainer}` };
      } catch (err) {
        return { success: false, reason: err.message };
      }
    });

    // 5. Disk below declared free-byte threshold — purge cache/transients only
    this.registerRemediation('DISK_LOW', async (child, issue) => {
      if (!this.execImpl) return { success: false, reason: 'No execImpl available for disk purge' };
      const targetPath = issue.path;
      if (!targetPath) return { success: false, reason: 'No path in issue metadata' };
      try {
        await this.execImpl(
          `find ${JSON.stringify(targetPath)} -xdev -type d \\( -name cache -o -name transients \\) -prune -exec rm -rf {} + 2>/dev/null; true`,
        );
        return { success: true, action: `Purged cache/transients under ${targetPath}` };
      } catch (err) {
        return { success: false, reason: err.message };
      }
    });

    // 6. Database connection evidence failed — restart the universe MariaDB container
    this.registerRemediation('DB_UNREACHABLE', async (child, issue) => {
      if (!this.execImpl) return { success: false, reason: 'No execImpl available for database recovery' };
      const containerName = `${child.name}-mariadb`;
      try {
        await this.execImpl(`podman start ${containerName} || podman restart ${containerName}`);
        return { success: true, action: `Started container ${containerName}` };
      } catch (err) {
        return { success: false, reason: err.message };
      }
    });
  }

  registerRemediation(issueCode, handlerFn) {
    this.remediationHandlers.set(issueCode, handlerFn);
  }

  async fetchBrickVitals(url, timeoutMs = 2500) {
    try {
      const res = await this.fetchImpl(`${url.replace(/\/$/, '')}/api/vitals`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        return { error: `HTTP ${res.status}` };
      }
      return await res.json();
    } catch (err) {
      return { error: err.message || 'Connection refused or timeout' };
    }
  }

  async assessChild(childConfig) {
    const vitalsMap = {};
    const bricks = childConfig.bricks || {};

    for (const [brickName, brickUrl] of Object.entries(bricks)) {
      vitalsMap[brickName] = await this.fetchBrickVitals(brickUrl);
    }

    const diagnosis = diagnoseUniverse(childConfig.name, vitalsMap, childConfig.thresholds || {});
    return {
      child: childConfig.name,
      diagnosis,
      vitals: vitalsMap,
      at: new Date().toISOString(),
    };
  }

  async reconcileChild(childConfig) {
    this.metrics.reconciliationsTotal++;
    this.lastReconcileAt = new Date().toISOString();

    const assessment = await this.assessChild(childConfig);
    const issues = assessment.diagnosis.allIssues;
    const actionsTaken = [];

    if (issues.length === 0) {
      return {
        child: childConfig.name,
        status: HEALTH_STATUS.HEALTHY,
        issues: [],
        actionsTaken: [],
      };
    }

    for (const issue of issues) {
      const sig = ConvergenceGuard.issueSignature(childConfig.name, issue.brick, issue.code);
      const gate = this.guard.canRemediate(sig);

      if (!gate.allowed) {
        if (gate.isDegraded) this.metrics.degradedTotal++;
        actionsTaken.push({
          brick: issue.brick,
          issue: issue.code,
          remediated: false,
          reason: gate.reason,
          degraded: gate.isDegraded,
        });
        continue;
      }

      const handler = this.remediationHandlers.get(issue.code);
      if (!handler) {
        actionsTaken.push({
          brick: issue.brick,
          issue: issue.code,
          remediated: false,
          reason: `No remediation handler registered for ${issue.code}`,
        });
        continue;
      }

      this.metrics.healingsAttempted++;
      await ingestLog({
        loggerUrl: this.loggerUrl,
        pod: this.name,
        event: 'HEALING_ATTEMPTED',
        correlationId: sig,
        data: { child: childConfig.name, brick: issue.brick, code: issue.code },
        fetchImpl: this.fetchImpl,
      });

      let result;
      try {
        result = await handler(childConfig, issue);
      } catch (err) {
        result = { success: false, reason: err.message };
      }

      const outcome = this.guard.recordOutcome(sig, result.success);
      if (result.success) {
        this.metrics.healingsSucceeded++;
        await ingestLog({
          loggerUrl: this.loggerUrl,
          pod: this.name,
          event: 'HEALING_SUCCEEDED',
          correlationId: sig,
          data: { child: childConfig.name, action: result.action },
          fetchImpl: this.fetchImpl,
        });
      } else {
        if (outcome.isDegraded) {
          this.metrics.degradedTotal++;
          await ingestLog({
            loggerUrl: this.loggerUrl,
            pod: this.name,
            event: 'HEALING_DEGRADED',
            level: 'ERROR',
            correlationId: sig,
            data: { child: childConfig.name, attempts: outcome.attempts },
            fetchImpl: this.fetchImpl,
          });
        }
      }

      actionsTaken.push({
        brick: issue.brick,
        issue: issue.code,
        remediated: result.success,
        action: result.action || null,
        reason: result.reason || null,
        degraded: outcome.isDegraded,
      });
    }

    return {
      child: childConfig.name,
      status: assessment.diagnosis.status,
      issues,
      actionsTaken,
    };
  }

  async vitals(now = Date.now()) {
    return vitals({
      service: this.name,
      startedAt: this.startedAt,
      signals: {
        childrenMonitored: this.children.size,
        reconciliationsTotal: this.metrics.reconciliationsTotal,
        healingsAttempted: this.metrics.healingsAttempted,
        healingsSucceeded: this.metrics.healingsSucceeded,
        degradedTotal: this.metrics.degradedTotal,
        lastReconcileAgeSeconds: ageSeconds(this.lastReconcileAt, now),
      },
      checks: {},
    }, now);
  }
}
