# Package: @shaper/pkg-queue

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)  
> **Manifest**: [`topology.json`](../../topology.json) → node `queue`

---

## 1. Declarative Objective

Async job queue with progress tracking and SSE streaming — no external broker.
Jobs live in the unit's own private MariaDB (Rules 4 and 26,
[§3](#private-mariadb)): records survive a crash, in-flight execution does not
(invariant 2).

---

## 2. Universal Invariants (Parameterized)

1. **Lifecycle**: `PENDING` → `RUNNING` → `COMPLETED` | `FAILED` — set explicitly by the consumer (or by `QUEUE_AUTO_DISPATCH=1` worker for `agent.inject`).
2. **Durability is evidence, never resumption** *(corrected in V1.13 — this
   line used to say "in-memory only, no persistence", which the code itself
   contradicted; the durable store became the unit's private MariaDB in V1.14,
   [§3](#private-mariadb))*: every job state change is committed to MariaDB
   before anyone is told it happened, and every start reads the jobs back — the
   **record** of a job survives a crash. What does NOT survive is its
   **execution**: a job that was `RUNNING` when the process died comes back as
   a record in its last committed state and is never re-executed by this brick.
   No crash-survival claim may rest on this queue re-running work; a universe
   that needs at-least-once execution must make its jobs idempotent and
   re-enqueue from its own beat (maestro), reading the recorded jobs to know
   what was in flight. One scoping note, verified in `worker.js`: recorded
   **PENDING** jobs are dispatched normally after a restart when the worker
   runs — a first execution, not a resumption; recorded **RUNNING** jobs are
   adopted as `FAILED`, never re-run. The in-memory store (`QUEUE_STORE=memory`)
   loses everything with the process; it and the JSONL file store
   (`QUEUE_STORE=file`) are DEV scaffolding only.
3. **The queue testifies for its own work** *(V1.13.4)*: with `LOGGER_URL` set,
   every job emits `JOB_CREATED` and its terminal `JOB_COMPLETED` /
   `JOB_FAILED`, **correlated to the job id**. The queue is the ledger of
   work, so the queue is what must say a job existed — not whoever happened to
   enqueue it. Until V1.13.4 only maestro logged, so a job POSTed by hand —
   what the runbook prescribes for its own functional proof — finished with a
   persisted answer and left no trace, making proof #4 unsatisfiable on the
   documented path. An event is emitted only after the state it reports is
   recorded (committed, in MariaDB), and a replayed enqueue emits nothing.
   Emission is fire-and-forget over HTTP: a logger that is down never stops
   work, and says so on stderr rather than failing silently — the line is then
   lost, which is why a transactional outbox is a recorded gap (§3).
4. **Events**: `EventEmitter` hooks + `JobQueue.formatSSE()` for HTTP streams. A store emits `jobCreated`, `jobUpdated` and `statusChange` only after the change is recorded; a stream reader never sees a job the store does not hold.
5. **Isolation**: `type` and `payload` are opaque. Zero business logic in the queue core.
6. **Optional worker**: `worker.js` understands only `type=agent.inject` and forwards `payload.message` (+ optional params) to a bridge HTTP inject.
7. **Terminal evidence**: a bridge terminal event decides success/failure; when it carries final answer text, the worker stores that answer in `job.result.answer` with the exit code.
8. **A lane is never held by silence** *(V1.13.12)*: the worker waits at most
   `QUEUE_RUN_MAX_SECONDS` (default 900) for a run's terminal event, then
   fails the job with the reason stated — the watcher gave up, the outcome is
   unknowable, as with orphans — and frees the lane. Until V1.13.12 a hung
   event stream held the only lane forever: the job sat `RUNNING`, every later
   job sat `PENDING`, and only a container restart freed the queue (v1.13.11
   sealing run, incident 2). Giving up is not inventing an outcome.

### Job parameters (voluntary enqueue)

```json
{
  "type": "agent.inject",
  "totalSteps": 2,
  "payload": {
    "message": "required instruction",
    "conversation": "optional-session-name",
    "bridgeUrl": "http://127.0.0.1:4440",
    "model": "<engine-measured-at-deployment>",
    "context": "optional extra instructions"
  }
}
```

| Param | Required | Meaning |
| :--- | :--- | :--- |
| `type` | yes | Must be `agent.inject` for auto-dispatch |
| `payload.message` | yes | What the agent should do |
| `payload.conversation` | no | Bridge conversation / workspace name |
| `payload.bridgeUrl` | no | Default `QUEUE_BRIDGE_URL` or `:4440` |
| `payload.model` | no | Engine id for the bridge. Selected by measurement at deployment against the declared depth and throughput (Rule 7) — never pinned in a tracked file |
| `payload.context` | no | Extra context text |
| `totalSteps` | no | Progress denominator (default 1) |
| `idempotencyKey` | no | Stable key for one logical request: a replay returns the original job, a different request under the same key is a conflict ([§3](#private-mariadb), invariant 14) |

---

<a id="private-mariadb"></a>
## 3. Storage: the unit's private MariaDB (Rules 4 and 26)

9. **The durable store is the `queue` database of the unit's own MariaDB**,
   reached through its private socket as `queue@localhost` (`MariaDbJobQueue`,
   `sql/schema.sql`). MariaDB is the source of truth: every read goes to it and
   no in-memory copy is authoritative. The brick selects it by default
   (`QUEUE_STORE=mariadb`); the in-memory and JSONL stores remain declared DEV
   scaffolding, selected only with `QUEUE_STORE=memory` or `QUEUE_STORE=file`
   plus an explicit `QUEUE_STORAGE_FILE`, never as a fallback. An unknown
   store, or MariaDB unreachable, unconfirmed or without its schema, is a
   refusal to start with a typed reason (exit 1).
10. **The schema is installed by the administrative path.** The application
    account holds `SELECT, INSERT, UPDATE, DELETE` on `queue.*` only, never
    creates or alters a table, and refuses to serve when `schema_meta` is
    absent or older than the build (or `job_transitions` is missing).
11. **A write is reported only after it commits.** Creation, every progress or
    status update, the worker's transitions and a quality-gate verdict each
    write the job row and one `job_transitions` row in one transaction. The API
    answers, the stream emits and the audit line leaves only after `COMMIT`. A
    database failure is HTTP 503 with a typed `code` — never a logged-and-ignored
    error, never an empty answer, never a success event.
12. **Every start reads every job back.** A row that cannot be parsed
    (`QUEUE_ROW_INVALID`, naming the job) stops the start; it is never skipped.
    The same error on a later read answers 500 with that code.
13. **The worker moves the ledger before it acts.** A job leaves `PENDING` only
    through a conditional transition (`expectStatus: 'PENDING'`, refused as
    `JOB_STATE_CHANGED` if someone else moved it), committed before anything is
    sent to a bridge; a stale read can therefore never run a job twice.
14. **Idempotent enqueue** — the contract producers such as Maestro rely on:
    * `POST /api/jobs` may carry `idempotencyKey`: a string of 1–190 characters
      from `[A-Za-z0-9._:-]`. Absent means none; anything else (null, empty,
      non-string, too long, other characters) is `400 IDEMPOTENCY_KEY_INVALID`.
    * The request digest is SHA-256 of the canonical JSON (object keys sorted
      at every depth, array order kept) of `{type, payload, totalSteps,
      contractType}`, after the defaults (`payload` `{}`, `totalSteps` 1,
      `contractType` null — the request's own field, not the payload's).
    * New key → `201 {status:'ok', job, duplicate:false}`. Same key, same
      digest → `200 {status:'ok', job, duplicate:true}` with the original job
      in its current state; nothing is created, emitted or audited. Same key,
      other digest → `409 {error, code:'IDEMPOTENCY_CONFLICT', jobId}`.
    * The `UNIQUE` constraint on `jobs.idempotency_key` decides, not the
      pre-check: of two simultaneous requests under one key, one INSERT wins
      and the other collides, rolls back and answers from the winning row.
    * `GET /api/jobs?idempotencyKey=<key>` → `200 {status:'ok', jobs:[job]}` or
      `jobs: []`. Without a key, `POST` creates a new job every time, as
      before, and answers `duplicate:false`.
    * Every job carries `idempotencyKey` (or null) and `requestDigest`.
15. **Requests are validated before they are stored**: `type` is required (1–190
    characters), `payload` may not be null, `totalSteps` and `step` are
    non-negative integers, `progress` a finite number, `status` a word of at
    most 32 letters or underscores, `error` a string or null, `contractType` at
    most 64 characters — refused with `400 INVALID_JOB_REQUEST` /
    `INVALID_JOB_UPDATE` instead of being stored as something else.
16. **Active and historical data are split** (design decision of 22 September
    2026): `jobs` is an ordinary InnoDB table (idempotency constraint, live
    state); `job_transitions` is append-only, partitioned by month on
    `recorded_at` with a guarded `p_future` partition, and nothing holds a
    foreign key to or from it.

What this storage does not yet provide, against the Queue target contract of
22 September 2026 — recorded as gaps, not implied:

* **Authenticated producers and consumers, and scopes.** The API is still
  unauthenticated behind its localhost bind: any local caller can enqueue,
  read every job and payload, patch any job's status, and subscribe to the
  stream. Idempotency keys are therefore unique per queue database, not per
  authenticated `(universe, producer, job class)`.
* **Durable leases with heartbeat.** The worker's claim is a conditional
  `PENDING → RUNNING` transition, not a lease: no lease id, no incarnation, no
  heartbeat, no expiry.
* **Attempts and at-least-once recovery.** There is no `attempts` table; a
  `RUNNING` job left by a dead worker is settled as `FAILED` (orphan) at the
  next start, never retried after a bounded backoff.
* **`DEAD_LETTER` and `CANCELLED`.** Neither state exists.
* **A transactional outbox to Logger.** Audit remains fire-and-forget over
  HTTP after the commit; a Logger outage loses the line while the job stays
  durable.
* **Evidence policies** (`before_execution` / `eventual`) are not applied.
* **Queue still carries more than transport.** Task framing (`task-frame.js`),
  direct Bridge dispatch and dialect translation (`worker.js`, only with
  `QUEUE_AUTO_DISPATCH=1`) and the deliverable quality gate
  (`validateQualityGate`) remain in this package; their removal belongs to the
  reconstruction.
* **Classification header and limits.** No `stream`/`topic`/source/correlation
  fields, no request-body or payload size limit beyond the column types, and
  `GET /api/jobs` returns every job, unpaginated.
* **Partition maintenance and archival.** The schema carries monthly
  partitions to `2027-03`; creating later ones before `p_future` fills, and
  archiving terminal jobs, belong to the administrative path and are not
  automated.
* **An outcome observed while MariaDB is unavailable is not retried.** The job
  keeps its last committed state (a `RUNNING` one becomes an orphan at the
  next start), and the worker says so on stderr.
* **The JSONL file store still logs a failed append and answers success, and
  skips (now with a warning) a line it cannot parse.** It is DEV scaffolding
  and is recorded as debt, not presented as compliance.
