/**
 * @module @shaper/pkg-supervisor/diagnostics
 * Pure diagnostic rules evaluating raw vital signs (Rule 23).
 *
 * An external supervisor evaluates evidence; a brick NEVER grades itself.
 * All functions here are pure: (vitalsEvidence, thresholds) -> DiagnosticVerdict
 */

export const HEALTH_STATUS = {
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  STALLED: 'STALLED',
  FAULT: 'FAULT',
  UNREACHABLE: 'UNREACHABLE',
};

/**
 * Evaluates a single service vital signs response.
 *
 * @param {string} serviceName - e.g. "vault", "logger", "maestro", "queue", "bridge"
 * @param {object} vitalsData - Envelope from GET /api/vitals or fetch error
 * @param {object} [thresholds]
 * @returns {object} Diagnostic evaluation
 */
export function diagnoseServiceVitals(serviceName, vitalsData, thresholds = {}) {
  const {
    maxBeatAgeMultiplier = 2.5,
    maxPendingAgeSeconds = 300,
    maxErrorRate = 0.5,
  } = thresholds;

  if (!vitalsData || vitalsData.error || !vitalsData.signals) {
    return {
      service: serviceName,
      status: HEALTH_STATUS.UNREACHABLE,
      issues: [{
        code: 'SERVICE_UNREACHABLE',
        severity: 'CRITICAL',
        message: vitalsData?.error || 'No vital signs received (connection refused or timeout)',
      }],
      at: new Date().toISOString(),
    };
  }

  const issues = [];
  const signals = vitalsData.signals || {};
  const checks = vitalsData.checks || {};

  // 1. Check all writability checks (Rule 23: storage/disk evidence)
  for (const [checkName, checkObj] of Object.entries(checks)) {
    if (checkObj && typeof checkObj === 'object' && checkObj.writable === false) {
      issues.push({
        code: 'STORAGE_UNWRITABLE',
        severity: 'CRITICAL',
        check: checkName,
        path: checkObj.path,
        reason: checkObj.reason || 'Directory is not writable',
      });
    }
    const minFree = thresholds.minFreeBytes;
    if (
      checkObj && typeof checkObj === 'object'
      && Number.isFinite(checkObj.freeBytes)
      && Number.isFinite(minFree)
      && checkObj.freeBytes < minFree
    ) {
      issues.push({
        code: 'DISK_LOW',
        severity: 'HIGH',
        check: checkName,
        path: checkObj.path,
        freeBytes: checkObj.freeBytes,
        minFreeBytes: minFree,
        message: `Free disk ${checkObj.freeBytes} bytes is below ${minFree}`,
      });
    }
    if (
      checkObj && typeof checkObj === 'object'
      && (checkName === 'database' || checkName === 'db' || checkName.endsWith('Database'))
    ) {
      const hasError = Boolean(checkObj.lastError);
      const neverOk = checkObj.lastOkAgeSeconds === null || checkObj.lastOkAgeSeconds === undefined;
      if (hasError || (neverOk && Number(checkObj.attempts || 0) > 0)) {
        issues.push({
          code: 'DB_UNREACHABLE',
          severity: 'CRITICAL',
          check: checkName,
          lastError: checkObj.lastError || null,
          lastOkAgeSeconds: checkObj.lastOkAgeSeconds ?? null,
          attempts: checkObj.attempts || 0,
        });
      }
    }
  }

  const maxHttpAge = thresholds.maxHttpAgeSeconds || 30;
  if (
    signals.httpLastOkAgeSeconds !== undefined
    && signals.httpLastOkAgeSeconds !== null
    && signals.httpLastOkAgeSeconds > maxHttpAge
  ) {
    issues.push({
      code: 'SERVICE_UNREACHABLE',
      severity: 'CRITICAL',
      httpLastOkAgeSeconds: signals.httpLastOkAgeSeconds,
      httpStatus: signals.httpStatus ?? null,
      message: `HTTP last-ok age ${signals.httpLastOkAgeSeconds}s exceeds ${maxHttpAge}s`,
    });
  }

  // 2. Service-specific factual evaluations
  if (serviceName.includes('maestro')) {
    const tasks = signals.tasks || {};
    for (const [taskSlug, taskInfo] of Object.entries(tasks)) {
      const cadence = Number(taskInfo.cadenceSeconds || 30);
      const age = taskInfo.lastBeatAgeSeconds;
      if (age !== null && age !== undefined && age > cadence * maxBeatAgeMultiplier) {
        issues.push({
          code: 'STALLED_CADENCE',
          severity: 'HIGH',
          task: taskSlug,
          cadenceSeconds: cadence,
          lastBeatAgeSeconds: age,
          driftRatio: Math.round((age / cadence) * 10) / 10,
          message: `Task ${taskSlug} beat is overdue (${age}s vs cadence ${cadence}s)`,
        });
      }
    }
    if (signals.beatsSkippedTotal > 10) {
      issues.push({
        code: 'HIGH_BEATS_SKIPPED',
        severity: 'MEDIUM',
        skipped: signals.beatsSkippedTotal,
        message: `High number of skipped beats recorded (${signals.beatsSkippedTotal})`,
      });
    }
  }

  if (serviceName.includes('queue')) {
    const pendingAge = signals.oldestPendingAgeSeconds;
    if (pendingAge !== null && pendingAge !== undefined && pendingAge > maxPendingAgeSeconds) {
      issues.push({
        code: 'QUEUE_STARVATION',
        severity: 'HIGH',
        oldestPendingAgeSeconds: pendingAge,
        message: `Pending jobs starved in queue (oldest age: ${pendingAge}s)`,
      });
    }
  }

  if (serviceName.includes('bridge')) {
    const injects = Number(signals.injects || 0);
    const errors = Number(signals.errors || 0);
    if (injects > 5 && errors / injects > maxErrorRate) {
      issues.push({
        code: 'HIGH_ERROR_RATE',
        severity: 'HIGH',
        injects,
        errors,
        errorRate: Math.round((errors / injects) * 100) / 100,
        message: `Bridge error rate exceeded threshold (${errors}/${injects})`,
      });
    }
  }

  // Derive status from issues
  let status = HEALTH_STATUS.HEALTHY;
  if (issues.some(i => i.severity === 'CRITICAL')) {
    status = HEALTH_STATUS.FAULT;
  } else if (issues.some(i => i.severity === 'HIGH')) {
    status = HEALTH_STATUS.STALLED;
  } else if (issues.some(i => i.severity === 'MEDIUM')) {
    status = HEALTH_STATUS.DEGRADED;
  }

  return {
    service: serviceName,
    status,
    uptimeSeconds: vitalsData.uptimeSeconds,
    signals,
    issues,
    at: new Date().toISOString(),
  };
}

/**
 * Diagnoses an entire universe given vitals evidence from all its bricks.
 *
 * @param {string} universeName
 * @param {Record<string, object>} brickVitals - Map of brickName -> vitals result
 * @param {object} [thresholds]
 * @returns {object} Universe diagnosis
 */
export function diagnoseUniverse(universeName, brickVitals = {}, thresholds = {}) {
  const evaluations = {};
  const allIssues = [];

  for (const [brickName, vitalsData] of Object.entries(brickVitals)) {
    const diag = diagnoseServiceVitals(brickName, vitalsData, thresholds);
    evaluations[brickName] = diag;
    for (const issue of diag.issues) {
      allIssues.push({ brick: brickName, ...issue });
    }
  }

  let overallStatus = HEALTH_STATUS.HEALTHY;
  if (allIssues.some(i => i.severity === 'CRITICAL' || i.code === 'SERVICE_UNREACHABLE')) {
    overallStatus = HEALTH_STATUS.FAULT;
  } else if (allIssues.some(i => i.severity === 'HIGH')) {
    overallStatus = HEALTH_STATUS.STALLED;
  } else if (allIssues.some(i => i.severity === 'MEDIUM')) {
    overallStatus = HEALTH_STATUS.DEGRADED;
  }

  return {
    universe: universeName,
    status: overallStatus,
    evaluations,
    allIssues,
    at: new Date().toISOString(),
  };
}
