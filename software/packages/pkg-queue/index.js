import { EventEmitter } from 'node:events';
import http from 'node:http';
import { capacityReport } from './capacity.js';
import { vitals, ageSeconds, writable } from '../pkg-logger/vitals.js';
import fs from 'node:fs';
import path from 'node:path';
import { ingestLog } from '../pkg-logger/ingest-client.js';

/**
 * Quality Gate Contract Validator (Rule 20)
 * Validates deliverables according to their typed contract before marking COMPLETED.
 */
export function validateQualityGate(job, { gedRoot = null, testRunner = null } = {}) {
  const contractType = job.contractType || job.payload?.contractType || null;
  const result = job.result || {};

  if (!contractType) {
    return {
      passed: true,
      status: 'NEEDS_CONTRACT',
      warning: 'No typed contract declared for this deliverable.',
    };
  }

  switch (contractType) {
    case 'code': {
      if (testRunner && typeof testRunner === 'function') {
        try {
          const testRes = testRunner(job);
          if (!testRes || testRes.passed === false) {
            return { passed: false, error: testRes?.error || 'Code tests failed in quality gate sandbox.' };
          }
        } catch (err) {
          return { passed: false, error: `Code quality gate error: ${err.message}` };
        }
      }
      return { passed: true, status: 'VERIFIED_CODE' };
    }

    case 'document': {
      // Document / PDF / XLSX / DOCX validation
      const filePath = result.filePath || job.payload?.filePath || result.file;
      if (!filePath) {
        return { passed: false, error: 'Document quality gate failed: No output filePath declared in result.' };
      }
      if (gedRoot) {
        const fullPath = path.isAbsolute(filePath) ? filePath : path.join(gedRoot, filePath);
        if (!fs.existsSync(fullPath)) {
          return { passed: false, error: `Document quality gate failed: File ${filePath} not found on disk.` };
        }
      }
      // Arithmetic totals check if metadata provided
      if (result.totals) {
        const { ht = 0, vat = 0, ttc = 0 } = result.totals;
        if (Math.abs((Number(ht) + Number(vat)) - Number(ttc)) > 0.01) {
          return { passed: false, error: `Document quality gate failed: Arithmetic mismatch (HT: ${ht} + VAT: ${vat} != TTC: ${ttc}).` };
        }
      }
      return { passed: true, status: 'VERIFIED_DOCUMENT' };
    }

    case 'data': {
      // Dataset / CSV / JSON validation
      const dataRows = result.rows || result.data || job.payload?.data;
      if (dataRows && Array.isArray(dataRows)) {
        const requiredColumns = job.payload?.requiredColumns || [];
        for (const col of requiredColumns) {
          const missing = dataRows.some(row => row[col] === undefined || row[col] === null);
          if (missing) {
            return { passed: false, error: `Data quality gate failed: Column "${col}" has missing values.` };
          }
        }
      }
      return { passed: true, status: 'VERIFIED_DATA' };
    }

    case 'action': {
      // System action / dispatch verification
      if (result.dryRun && result.simulatedSuccess === false) {
        return { passed: false, error: result.error || 'Action quality gate failed during dry-run simulation.' };
      }
      return { passed: true, status: 'VERIFIED_ACTION' };
    }

    default:
      return { passed: true, status: 'VERIFIED_GENERIC' };
  }
}

export class JobQueue extends EventEmitter {
  constructor({ storageFile = null, enforceQualityGate = false, gedRoot = null, storageAdapter = null, loggerUrl = null, fetchImpl = fetch } = {}) {
    super();
    this.jobs = new Map();
    this.jobCounter = 0;
    this.storageFile = storageFile;
    // The queue is the universe's ledger of work, so it is the queue that must
    // say a job existed — not whoever happened to enqueue it. Until V1.13.4
    // only maestro logged, so a job POSTed by hand (exactly what the runbook's
    // own proof step prescribes) completed with a persisted answer and left
    // ZERO audit trace: proof #4 was unsatisfiable on the documented path.
    this.loggerUrl = loggerUrl;
    this.fetchImpl = fetchImpl;
    this.enforceQualityGate = enforceQualityGate;
    this.gedRoot = gedRoot;
    this.storageAdapter = storageAdapter; // Optional MariaDB or external adapter

    if (this.storageFile) {
      this._hydrateFromDisk();
    }
  }

  _hydrateFromDisk() {
    try {
      if (fs.existsSync(this.storageFile)) {
        const lines = fs.readFileSync(this.storageFile, 'utf-8').split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const job = JSON.parse(line);
            if (job && job.id) {
              this.jobs.set(job.id, job);
            }
          } catch {
            /* ignore invalid lines */
          }
        }
      }
    } catch (err) {
      console.error('[queue] disk hydration failed:', err.message);
    }
  }

  /**
   * Audit, correlated to the job id and read from outside the queue (Rule 0G).
   * Fire-and-forget: a logger that is down must never stop work — but it says
   * so on stderr rather than failing silently (Rule 0K, never silent).
   */
  _audit(event, job, level = 'INFO') {
    if (!this.loggerUrl) return;
    ingestLog({
      loggerUrl: this.loggerUrl,
      pod: 'queue',
      event,
      level,
      correlationId: job.id,
      data: { jobId: job.id, type: job.type, status: job.status, conversation: job.payload?.conversation },
      fetchImpl: this.fetchImpl,
    }).catch((err) => console.error('[queue] audit failed:', err.message));
  }

  _persistJob(job) {
    if (this.storageFile) {
      try {
        const dir = path.dirname(this.storageFile);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(this.storageFile, JSON.stringify(job) + '\n', 'utf-8');
      } catch (err) {
        console.error('[queue] disk persist error:', err.message);
      }
    }
    if (this.storageAdapter && typeof this.storageAdapter.saveJob === 'function') {
      this.storageAdapter.saveJob(job).catch(err => {
        console.error('[queue] storage adapter error:', err.message);
      });
    }
  }

  createJob({ type, payload = {}, totalSteps = 1, contractType = null }) {
    const jobId = `job-${Date.now()}-${++this.jobCounter}`;
    const job = {
      id: jobId,
      type,
      payload,
      contractType: contractType || payload.contractType || null,
      status: 'PENDING',
      progress: 0,
      step: 0,
      totalSteps,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      result: null,
      error: null,
      qualityGateStatus: null,
    };

    this.jobs.set(jobId, job);
    this._persistJob(job);

    this._audit('JOB_CREATED', job);
    this.emit('jobCreated', job);
    this.emit('statusChange', job);
    return job;
  }

  runQualityGate(jobId, { gedRoot = this.gedRoot, testRunner = null } = {}) {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    const gateResult = validateQualityGate(job, { gedRoot, testRunner });
    job.qualityGateStatus = gateResult.status || (gateResult.passed ? 'PASSED' : 'FAILED');
    if (!gateResult.passed) {
      job.error = gateResult.error;
    }
    this.jobs.set(jobId, job);
    this._persistJob(job);
    return gateResult;
  }

  updateJobProgress(jobId, { progress, step, status, result, error, contractType, testRunner }) {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (contractType !== undefined) job.contractType = contractType;
    if (progress !== undefined) job.progress = progress;
    if (step !== undefined) job.step = step;
    if (result !== undefined) job.result = result;
    if (error !== undefined) job.error = error;

    // Quality Gate Enforcement on completion (Rule 20)
    if (status === 'COMPLETED') {
      const gateRes = validateQualityGate(job, { gedRoot: this.gedRoot, testRunner });
      job.qualityGateStatus = gateRes.status || (gateRes.passed ? 'PASSED' : 'FAILED');
      if (!gateRes.passed) {
        job.status = 'FAILED';
        job.error = `Quality Gate Error: ${gateRes.error}`;
      } else {
        job.status = 'COMPLETED';
      }
    } else if (status !== undefined) {
      job.status = status;
    }
    
    job.updatedAt = new Date().toISOString();

    this.jobs.set(jobId, job);
    this._persistJob(job);

    if (job.status === 'COMPLETED') this._audit('JOB_COMPLETED', job);
    else if (job.status === 'FAILED') this._audit('JOB_FAILED', job, 'ERROR');

    this.emit('jobUpdated', job);
    this.emit('statusChange', job);
    return job;
  }

  getJob(jobId) {
    return this.jobs.get(jobId);
  }

  listJobs({ status } = {}) {
    const allJobs = Array.from(this.jobs.values());
    if (status) {
      return allJobs.filter(job => job.status === status);
    }
    return allJobs;
  }

  static formatSSE(event, data) {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }
}

/**
 * Creates an HTTP REST + SSE gateway for the JobQueue.
 */
const STARTED_AT = new Date().toISOString();

export function createQueueServer({
  port = 8540,
  host = '0.0.0.0',
  queue = null,
  storageFile = null,
  enforceQualityGate = null,
  gedRoot = null,
  loggerUrl = null,
} = {}) {
  const jobQueue = queue || new JobQueue({
    storageFile: storageFile || process.env.QUEUE_STORAGE_FILE || null,
    // Off by default: the gate is opt-in during build-out, enabled per universe
    // via QUALITY_GATE_ENFORCE=1 once its deliverable contracts are declared.
    enforceQualityGate: enforceQualityGate !== null
      ? enforceQualityGate
      : process.env.QUALITY_GATE_ENFORCE === '1',
    gedRoot: gedRoot || process.env.GED_ROOT || null,
    loggerUrl: loggerUrl || process.env.LOGGER_URL || null,
  });
  const sseClients = new Set();

  const broadcast = (event, data) => {
    const frame = JobQueue.formatSSE(event, data);
    for (const client of sseClients) {
      client.write(frame);
    }
  };

  jobQueue.on('jobCreated', (job) => broadcast('jobCreated', job));
  jobQueue.on('jobUpdated', (job) => broadcast('jobUpdated', job));
  jobQueue.on('statusChange', (job) => broadcast('statusChange', job));

  const server = http.createServer((req, res) => {
    const sendJson = (statusCode, data) => {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (req.method === 'GET' && (pathname === '/api/health' || pathname === '/health')) {
      return sendJson(200, {
        status: 'ok',
        service: 'brick-queue',
        jobsCount: jobQueue.jobs.size,
        sseClients: sseClients.size,
        persisted: Boolean(jobQueue.storageFile || jobQueue.storageAdapter),
        timestamp: new Date().toISOString(),
      });
    }

    // Vital signs: evidence a reader can re-derive, never a verdict to believe.
    // `/api/health` above says a process is listening; this says what the brick
    // can prove about itself and about what it depends on.
    if (req.method === 'GET' && pathname === '/api/vitals') {
      const jobs = jobQueue.listJobs();
      const pending = jobs.filter((j) => j.status === 'PENDING');
      const oldestPending = pending
        .map((j) => ageSeconds(j.createdAt))
        .filter((a) => a !== null)
        .sort((a, b) => b - a)[0] ?? null;

      return writable(fs, jobQueue.storageFile ? path.dirname(jobQueue.storageFile) : null)
        .then((storage) => sendJson(200, vitals({
          service: 'brick-queue',
          startedAt: STARTED_AT,
          signals: {
            lanesConfigured: Math.max(1, Number(process.env.QUEUE_CONCURRENCY || 1)),
            jobsHeld: jobs.length,
            pending: pending.length,
            running: jobs.filter((j) => j.status === 'RUNNING').length,
            // A job waiting far longer than the cadence is lateness you can see.
            oldestPendingAgeSeconds: oldestPending,
            completedSinceStart: jobs.filter((j) => j.status === 'COMPLETED').length,
            failedSinceStart: jobs.filter((j) => j.status === 'FAILED').length,
            sseClients: sseClients.size,
          },
          checks: {
            // Not "persisted: true" — whether the file can actually be written.
            storage,
          },
        })))
        .catch((err) => sendJson(500, { error: err.message }));
    }

    // What this universe can absorb, measured rather than declared.
    if (req.method === 'GET' && pathname === '/api/capacity') {
      return sendJson(200, capacityReport(jobQueue.listJobs(), {
        lanes: Math.max(1, Number(process.env.QUEUE_CONCURRENCY || 1)),
        windowSeconds: Number(url.searchParams.get('window') || 3600),
      }));
    }

    if (req.method === 'GET' && pathname === '/api/jobs/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      sseClients.add(res);

      const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
      }, 30000);

      req.on('close', () => {
        clearInterval(heartbeat);
        sseClients.delete(res);
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/jobs') {
      const status = url.searchParams.get('status') || undefined;
      return sendJson(200, {
        status: 'ok',
        jobs: jobQueue.listJobs({ status }),
      });
    }

    if (req.method === 'POST' && pathname === '/api/jobs') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const job = jobQueue.createJob({
            type: parsed.type,
            payload: parsed.payload,
            totalSteps: parsed.totalSteps,
            contractType: parsed.contractType,
          });
          return sendJson(201, { status: 'ok', job });
        } catch (err) {
          return sendJson(400, { error: err.message });
        }
      });
      return;
    }

    const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (jobMatch) {
      const jobId = decodeURIComponent(jobMatch[1]);

      if (req.method === 'GET') {
        const job = jobQueue.getJob(jobId);
        if (!job) return sendJson(404, { error: `Job "${jobId}" not found.` });
        return sendJson(200, { status: 'ok', job });
      }

      if (req.method === 'PATCH' || req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body || '{}');
            const job = jobQueue.updateJobProgress(jobId, parsed);
            return sendJson(200, { status: 'ok', job });
          } catch (err) {
            const statusCode = err.message.includes('not found') ? 404 : 400;
            return sendJson(statusCode, { error: err.message });
          }
        });
        return;
      }
    }

    sendJson(404, { error: 'Not Found' });
  });

  server.listen(port, host);
  server.jobQueue = jobQueue;
  return server;
}
