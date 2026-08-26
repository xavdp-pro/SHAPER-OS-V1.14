import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  diagnoseServiceVitals,
  diagnoseUniverse,
  HEALTH_STATUS,
  ConvergenceGuard,
  SupervisorEngine,
} from '../index.js';

describe('Supervisor Diagnostics (Rule 23)', () => {
  it('diagnoses an unreachable service', () => {
    const diag = diagnoseServiceVitals('vault', { error: 'ECONNREFUSED' });
    assert.equal(diag.status, HEALTH_STATUS.UNREACHABLE);
    assert.equal(diag.issues.length, 1);
    assert.equal(diag.issues[0].code, 'SERVICE_UNREACHABLE');
  });

  it('detects storage permission / disk faults from vitals checks', () => {
    const vitalsData = {
      service: 'brick-vault',
      uptimeSeconds: 120,
      signals: { secretsHeld: 5 },
      checks: { storage: { path: '/data/vault', writable: false, reason: 'EACCES: permission denied' } },
    };
    const diag = diagnoseServiceVitals('vault', vitalsData);
    assert.equal(diag.status, HEALTH_STATUS.FAULT);
    assert.equal(diag.issues[0].code, 'STORAGE_UNWRITABLE');
    assert.equal(diag.issues[0].path, '/data/vault');
  });

  it('detects stalled cadence on maestro task drift', () => {
    const vitalsData = {
      service: 'brick-maestro',
      uptimeSeconds: 1200,
      signals: {
        tasksRegistered: 1,
        tasks: {
          'task-base-proof': { cadenceSeconds: 30, lastBeatAgeSeconds: 150 },
        },
        beatsSkippedTotal: 2,
      },
      checks: {},
    };
    const diag = diagnoseServiceVitals('maestro', vitalsData);
    assert.equal(diag.status, HEALTH_STATUS.STALLED);
    assert.equal(diag.issues[0].code, 'STALLED_CADENCE');
    assert.equal(diag.issues[0].task, 'task-base-proof');
    assert.equal(diag.issues[0].driftRatio, 5.0);
  });

  it('evaluates healthy service with all signals normal', () => {
    const vitalsData = {
      service: 'brick-logger',
      uptimeSeconds: 500,
      signals: { podsCount: 2, eventsLast60s: 10, lastWriteAgeSeconds: 2, bytesOnDisk: 1024 },
      checks: { disk: { path: '/data/log', writable: true } },
    };
    const diag = diagnoseServiceVitals('logger', vitalsData);
    assert.equal(diag.status, HEALTH_STATUS.HEALTHY);
    assert.equal(diag.issues.length, 0);
  });

  it('detects DISK_LOW from freeBytes vs threshold (raw bytes, no verdict in the child)', () => {
    const vitalsData = {
      service: 'brick-child-vitals',
      uptimeSeconds: 10,
      signals: { httpStatus: 200, httpLastOkAgeSeconds: 1 },
      checks: {
        uploads: { path: '/var/www/html/wp-content/uploads', writable: true, freeBytes: 1024 },
      },
    };
    const diag = diagnoseServiceVitals('child', vitalsData, { minFreeBytes: 10_000_000 });
    assert.equal(diag.status, HEALTH_STATUS.STALLED);
    assert.equal(diag.issues[0].code, 'DISK_LOW');
    assert.equal(diag.issues[0].freeBytes, 1024);
  });

  it('detects DB_UNREACHABLE from database check lastError', () => {
    const vitalsData = {
      service: 'brick-child-vitals',
      uptimeSeconds: 10,
      signals: {},
      checks: {
        database: {
          lastError: 'ECONNREFUSED 127.0.0.1:3306',
          lastOkAgeSeconds: null,
          attempts: 3,
        },
      },
    };
    const diag = diagnoseServiceVitals('mariadb', vitalsData);
    assert.equal(diag.status, HEALTH_STATUS.FAULT);
    assert.equal(diag.issues[0].code, 'DB_UNREACHABLE');
  });
});

describe('Convergence Guard (Rule 27)', () => {
  it('enforces exponential backoff and caps max attempts before DEGRADED', () => {
    const guard = new ConvergenceGuard({ maxAttempts: 3, baseBackoffSeconds: 2 });
    const sig = 'univ-child:vault:STORAGE_UNWRITABLE';

    // Attempt 1 allowed
    const c1 = guard.canRemediate(sig, 1000);
    assert.equal(c1.allowed, true);
    guard.recordOutcome(sig, false, 1000);

    // Immediate retry blocked by backoff
    const c2 = guard.canRemediate(sig, 1500);
    assert.equal(c2.allowed, false);
    assert.match(c2.reason, /Backoff cooling down/);

    // After backoff (2s = 3000), Attempt 2 allowed
    const c3 = guard.canRemediate(sig, 3100);
    assert.equal(c3.allowed, true);
    guard.recordOutcome(sig, false, 3100);

    // Attempt 3 allowed after next backoff (4s = 7100)
    const c4 = guard.canRemediate(sig, 7200);
    assert.equal(c4.allowed, true);
    const outcome3 = guard.recordOutcome(sig, false, 7200);
    assert.equal(outcome3.isDegraded, true);

    // Exceeded maxAttempts -> terminal DEGRADED
    const c5 = guard.canRemediate(sig, 999999);
    assert.equal(c5.allowed, false);
    assert.equal(c5.isDegraded, true);
    assert.match(c5.reason, /DEGRADED/);
  });
});

describe('SupervisorEngine Lifecycle & Remediation (Rule 23)', () => {
  it('assesses child universe and executes cold remediation', async () => {
    let restarted = false;
    const fakeExec = async (cmd) => {
      if (cmd.includes('podman start')) restarted = true;
      return 'ok';
    };

    const engine = new SupervisorEngine({
      name: 'supervisor-test',
      children: [{
        name: 'child-1',
        bricks: {
          vault: 'http://127.0.0.1:9999', // unreachable
        },
      }],
      fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
      execImpl: fakeExec,
      convergenceGuard: new ConvergenceGuard({ maxAttempts: 3, baseBackoffSeconds: 1 }),
    });

    const report = await engine.reconcileChild(engine.children.get('child-1'));
    assert.equal(report.status, HEALTH_STATUS.FAULT);
    assert.equal(report.issues.length, 1);
    assert.equal(report.actionsTaken[0].remediated, true);
    assert.equal(restarted, true);

    // Vitals compliance (Rule 23)
    const vit = await engine.vitals();
    assert.equal(vit.service, 'supervisor-test');
    assert.equal(typeof vit.signals.healingsAttempted, 'number');
    assert.equal(vit.status, undefined);
    assert.equal(vit.ok, undefined);
  });
});
