import { EventEmitter } from 'node:events';
import http from 'node:http';
import { capacityReport } from './capacity.js';
import { vitals, ageSeconds, writable } from '../pkg-logger/vitals.js';
import fs from 'node:fs';
import path from 'node:path';
import { ingestLog } from '../pkg-logger/ingest-client.js';
import {
  QueueError,
  applyJobPatch,
  newJobRecord,
  normalizeCreateRequest,
  normalizeJobPatch,
  queueErrorStatus,
  replayOrConflict,
  requestDigest,
  validateIdempotencyKey,
} from './job-contract.js';

export { QueueError, queueErrorStatus } from './job-contract.js';

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

/**
 * Audit, correlated to the job id and read from outside the queue (Rule 0G).
 * Fire-and-forget: a logger that is down must never stop work — but it says
 * so on stderr rather than failing silently (Rule 0K, never silent). Every
 * store calls it only after the state it reports is recorded.
 */
export function auditJobEvent({ loggerUrl, fetchImpl = fetch }, event, job, level = 'INFO') {
  if (!loggerUrl) return;
  ingestLog({
    loggerUrl,
    pod: 'queue',
    event,
    level,
    correlationId: job.id,
    data: { jobId: job.id, type: job.type, status: job.status, conversation: job.payload?.conversation },
    fetchImpl,
  }).catch((err) => console.error('[queue] audit failed:', err.message));
}

/** The terminal audit event a job's new state calls for, if any. */
export function terminalAudit(job) {
  if (job.status === 'COMPLETED') return ['JOB_COMPLETED', 'INFO'];
  if (job.status === 'FAILED') return ['JOB_FAILED', 'ERROR'];
  return null;
}

/**
 * The in-process job store: memory, optionally appended to a JSONL file.
 *
 * Declared DEV scaffolding (Rules 4 and 26). The brick's durable store is the
 * unit's private MariaDB (./mariadb-store.js); this one is selected only
 * explicitly (QUEUE_STORE=memory or QUEUE_STORE=file), never as a fallback,
 * and never satisfies a database or promotion gate. Its file path still logs
 * a failed append instead of refusing — that is recorded debt, which is why
 * it is not a store anything may be promoted on.
 */
export class JobQueue extends EventEmitter {
  constructor({ storageFile = null, enforceQualityGate = false, gedRoot = null, loggerUrl = null, fetchImpl = fetch } = {}) {
    super();
    this.jobs = new Map();
    this.byIdempotencyKey = new Map();
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

    if (this.storageFile) {
      this._hydrateFromDisk();
    }
  }

  get storageKind() {
    return this.storageFile ? 'file' : 'memory';
  }

  get persisted() {
    return Boolean(this.storageFile);
  }

  _hydrateFromDisk() {
    let unreadable = 0;
    try {
      if (fs.existsSync(this.storageFile)) {
        const lines = fs.readFileSync(this.storageFile, 'utf-8').split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const job = JSON.parse(line);
            if (job && job.id) {
              this.jobs.set(job.id, job);
              if (job.idempotencyKey) this.byIdempotencyKey.set(job.idempotencyKey, job.id);
            } else {
              unreadable += 1;
            }
          } catch {
            unreadable += 1;
          }
        }
      }
    } catch (err) {
      console.error('[queue] disk hydration failed:', err.message);
    }
    // DEV scaffolding keeps reading past a torn line, but it says so.
    if (unreadable) console.warn(`[queue] ${unreadable} unreadable line(s) in ${this.storageFile} were skipped (DEV file store)`);
  }

  _audit(event, job, level = 'INFO') {
    auditJobEvent(this, event, job, level);
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
  }

  /**
   * Accepts a job, or recognises a replay of one (idempotency key).
   * @returns {{ job: object, duplicate: boolean }}
   */
  enqueue(request) {
    const normalized = normalizeCreateRequest(request);
    const digest = requestDigest(normalized);
    if (normalized.idempotencyKey) {
      const existing = this.findByIdempotencyKey(normalized.idempotencyKey);
      if (existing) return replayOrConflict(existing, digest, normalized.idempotencyKey);
    }

    const job = newJobRecord(normalized, {
      id: `job-${Date.now()}-${++this.jobCounter}`,
      digest,
      now: new Date(),
    });

    this.jobs.set(job.id, job);
    if (job.idempotencyKey) this.byIdempotencyKey.set(job.idempotencyKey, job.id);
    this._persistJob(job);

    this._audit('JOB_CREATED', job);
    this.emit('jobCreated', job);
    this.emit('statusChange', job);
    return { job, duplicate: false };
  }

  createJob(request) {
    return this.enqueue(request).job;
  }

  runQualityGate(jobId, { gedRoot = this.gedRoot, testRunner = null } = {}) {
    const job = this.jobs.get(jobId);
    if (!job) throw new QueueError('JOB_NOT_FOUND', `Job ${jobId} not found`);
    const gateResult = validateQualityGate(job, { gedRoot, testRunner });
    job.qualityGateStatus = gateResult.status || (gateResult.passed ? 'PASSED' : 'FAILED');
    if (!gateResult.passed) {
      job.error = gateResult.error;
    }
    this.jobs.set(jobId, job);
    this._persistJob(job);
    return gateResult;
  }

  /**
   * @param {string} jobId
   * @param {object} patch - { progress, step, status, result, error, contractType, testRunner }
   * @param {{ expectStatus?: string }} [options] - refuse (JOB_STATE_CHANGED) unless the job is in this state
   */
  updateJobProgress(jobId, patch, { expectStatus = null } = {}) {
    const changes = normalizeJobPatch(patch);
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new QueueError('JOB_NOT_FOUND', `Job ${jobId} not found`);
    }
    if (expectStatus && job.status !== expectStatus) {
      throw new QueueError('JOB_STATE_CHANGED', `Job ${jobId} is ${job.status}, not ${expectStatus}`, { jobId, status: job.status });
    }

    const next = applyJobPatch(job, changes, {
      gate: (candidate) => validateQualityGate(candidate, { gedRoot: this.gedRoot, testRunner: changes.testRunner }),
      now: new Date(),
    });
    // The job object is updated in place: holders of it see the new state.
    Object.assign(job, next);

    this.jobs.set(jobId, job);
    this._persistJob(job);

    const terminal = terminalAudit(job);
    if (terminal) this._audit(terminal[0], job, terminal[1]);

    this.emit('jobUpdated', job);
    this.emit('statusChange', job);
    return job;
  }

  getJob(jobId) {
    return this.jobs.get(jobId);
  }

  findByIdempotencyKey(key) {
    const id = this.byIdempotencyKey.get(key);
    return id ? this.jobs.get(id) || null : null;
  }

  listJobs({ status, type } = {}) {
    let allJobs = Array.from(this.jobs.values());
    if (status) allJobs = allJobs.filter((job) => job.status === status);
    if (type) allJobs = allJobs.filter((job) => job.type === type);
    return allJobs;
  }

  countJobs() {
    return this.jobs.size;
  }

  /** Not "persisted: true" — whether the file can actually be written. */
  storageCheck() {
    return writable(fs, this.storageFile ? path.dirname(this.storageFile) : null);
  }

  static formatSSE(event, data) {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }
}

/**
 * Creates an HTTP REST + SSE gateway for the JobQueue.
 */
const STARTED_AT = new Date().toISOString();

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const body = await readBody(req);
  try {
    return JSON.parse(body || '{}');
  } catch (err) {
    throw new QueueError('INVALID_JSON', err.message);
  }
}

/** The body an error answers with; `error` stays the human-readable field. */
export function errorBody(err, status) {
  if (status === 503) {
    return { error: 'Queue storage unavailable', code: err.code || 'DB_UNAVAILABLE', detail: err.message };
  }
  const body = { error: err.message, code: err.code || null };
  if (err.jobId) body.jobId = err.jobId;
  return body;
}

/**
 * @param {object} options
 * @param {object} [options.queue] - a store: JobQueue (memory/file, DEV) or MariaDbJobQueue.
 *   When omitted, an in-memory JobQueue is built from the options below — a
 *   library default for tests and tooling. The brick's entrypoint (server.js)
 *   always passes the store it selected explicitly.
 */
export function createQueueServer({
  port = 8640,
  host = '0.0.0.0',
  queue = null,
  storageFile = null,
  enforceQualityGate = null,
  gedRoot = null,
  loggerUrl = null,
} = {}) {
  const jobQueue = queue || new JobQueue({
    storageFile,
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

  // Stores emit only after the state is recorded — in MariaDB, after commit —
  // so a stream reader never sees a job that the store does not hold.
  jobQueue.on('jobCreated', (job) => broadcast('jobCreated', job));
  jobQueue.on('jobUpdated', (job) => broadcast('jobUpdated', job));
  jobQueue.on('statusChange', (job) => broadcast('statusChange', job));

  const lanes = () => Math.max(1, Number(process.env.QUEUE_CONCURRENCY || 1));

  const server = http.createServer((req, res) => {
    const sendJson = (statusCode, data) => {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    route(req, res, sendJson).catch((err) => {
      const status = queueErrorStatus(err);
      if (status >= 500) console.error(`[brick-queue] ${req.method} ${req.url} → ${status} ${err.code || ''} ${err.message}`);
      if (res.headersSent) {
        res.end();
        return;
      }
      sendJson(status, errorBody(err, status));
    });
  });

  async function route(req, res, sendJson) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (req.method === 'GET' && (pathname === '/api/health' || pathname === '/health')) {
      // Health reveals the store and its reachability, never a payload.
      const db = typeof jobQueue.probe === 'function' ? await jobQueue.probe() : null;
      if (db && !db.ok) {
        return sendJson(503, {
          status: 'unavailable',
          service: 'brick-queue',
          storage: jobQueue.storageKind,
          db,
          timestamp: new Date().toISOString(),
        });
      }
      return sendJson(200, {
        status: 'ok',
        service: 'brick-queue',
        storage: jobQueue.storageKind || 'memory',
        ...(db ? { db } : {}),
        jobsCount: await jobQueue.countJobs(),
        sseClients: sseClients.size,
        persisted: Boolean(jobQueue.persisted),
        timestamp: new Date().toISOString(),
      });
    }

    // Vital signs: evidence a reader can re-derive, never a verdict to believe.
    // `/api/health` above says a process is listening; this says what the brick
    // can prove about itself and about what it depends on.
    if (req.method === 'GET' && pathname === '/api/vitals') {
      const storage = await jobQueue.storageCheck();
      if (storage && storage.ok === false) {
        // The store is unreachable: say so with the evidence, not with counts
        // that could not be read.
        return sendJson(503, vitals({
          service: 'brick-queue',
          startedAt: STARTED_AT,
          signals: { lanesConfigured: lanes(), sseClients: sseClients.size },
          checks: { storage },
        }));
      }
      const jobs = await jobQueue.listJobs();
      const pending = jobs.filter((j) => j.status === 'PENDING');
      const oldestPending = pending
        .map((j) => ageSeconds(j.createdAt))
        .filter((a) => a !== null)
        .sort((a, b) => b - a)[0] ?? null;

      return sendJson(200, vitals({
        service: 'brick-queue',
        startedAt: STARTED_AT,
        signals: {
          lanesConfigured: lanes(),
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
          // Not "persisted: true" — whether the store can actually be written
          // (file) or answers right now (MariaDB).
          storage,
        },
      }));
    }

    // What this universe can absorb, measured rather than declared.
    if (req.method === 'GET' && pathname === '/api/capacity') {
      return sendJson(200, capacityReport(await jobQueue.listJobs(), {
        lanes: lanes(),
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
      const key = url.searchParams.get('idempotencyKey');
      if (key !== null) {
        const job = await jobQueue.findByIdempotencyKey(validateIdempotencyKey(key));
        return sendJson(200, {
          status: 'ok',
          jobs: job && (!status || job.status === status) ? [job] : [],
        });
      }
      return sendJson(200, {
        status: 'ok',
        jobs: await jobQueue.listJobs({ status }),
      });
    }

    if (req.method === 'POST' && pathname === '/api/jobs') {
      const parsed = await readJson(req);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new QueueError('INVALID_JOB_REQUEST', 'a job request is a JSON object');
      }
      const { job, duplicate } = await jobQueue.enqueue({
        type: parsed.type,
        payload: parsed.payload,
        totalSteps: parsed.totalSteps,
        contractType: parsed.contractType,
        idempotencyKey: parsed.idempotencyKey,
      });
      // A replay answers with the original job and creates nothing.
      return sendJson(duplicate ? 200 : 201, { status: 'ok', job, duplicate });
    }

    const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (jobMatch) {
      const jobId = decodeURIComponent(jobMatch[1]);

      if (req.method === 'GET') {
        const job = await jobQueue.getJob(jobId);
        if (!job) return sendJson(404, { error: `Job "${jobId}" not found.` });
        return sendJson(200, { status: 'ok', job });
      }

      if (req.method === 'PATCH' || req.method === 'POST') {
        const parsed = await readJson(req);
        const job = await jobQueue.updateJobProgress(jobId, parsed);
        return sendJson(200, { status: 'ok', job });
      }
    }

    sendJson(404, { error: 'Not Found' });
  }

  server.listen(port, host);
  server.jobQueue = jobQueue;
  return server;
}
