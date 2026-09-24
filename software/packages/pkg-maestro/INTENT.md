# Package: @shaper/pkg-maestro

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)  
> **Manifest**: [`topology.json`](../../topology.json) → node `maestro`

---

## 1. Declarative Objective

Maestro determines when declared recurring work is due and submits **one
idempotent occurrence per due instant** to Queue — deterministic cadence, zero
idle LLM token waste. It owns cadence, not execution: it never runs the work,
never judges its result, and with no declared schedule it stays idle and
creates no work.

---

## 2. Universal Invariants (Parameterized)

1. **Beat Engine**: Periodic heartbeat every `<CADENCE_SECONDS>`. Handler decides if LLM is needed.
2. **Registry**: A task requires `<SLUG>` and nothing else; a label, a port, a bridge or a context are optional and never invented. Vault key and context path are opaque references.
3. **Audit**: Every beat logged via `@shaper/pkg-logger` as JSONL.
4. **Isolation**: No universe business logic. Scheduling only.
5. **Context snapshot**: Before enqueueing, the handler reads the task's
   configured context and puts the text in `payload.context`. An unreadable or
   empty declared file skips the beat with its reason. The job thus carries the
   context actually supplied at creation, independently of container mounts or
   later file changes. `instruction` is the explicit task request; `beatMessage`
   remains the fallback for existing registrations.

---

<a id="private-mariadb"></a>
## 3. Storage: the unit's private MariaDB (Rules 4 and 26)

6. **Schedules and occurrences live in the `maestro` database of the unit's own
   MariaDB**, reached through its private socket as `maestro@localhost`
   (`MariaDbMaestroStore`, `sql/schema.sql`), and MariaDB is the source of
   truth — not timer phase, not process memory. The in-memory
   `MaestroScheduler` remains as declared DEV scaffolding, selected only with
   `MAESTRO_STORE=memory`; the brick default is `mariadb` and nothing falls
   back to memory.
7. **The schema is installed by the administrative path.** The application
   account holds `SELECT, INSERT, UPDATE, DELETE` on `maestro.*` only, issues
   no DDL, and refuses to start when `schema_meta` is absent or older than the
   build.
8. **An occurrence is named by what it is.** `occurrence_id = 'occ-' + hex
   SHA-256 of "<universe>|<schedule>|<revision>|<planned instant, ISO UTC>"`.
   `SHAPER_UNIVERSE_ID` is required in the durable mode; the schedule id is the
   task slug; the revision is SHA-256 of the canonical normalized declaration.
   The same instant of the same revision in the same universe is one
   occurrence, whoever computes it and however often.
9. **Planned instants come from the stored anchor and cadence**
   (`anchor + k · cadence`, epoch-aligned unless `anchorAt` is declared), from
   the first instant at or after the moment the revision became active —
   never from the moment a timer fired. A restart, a second evaluation or a
   clock that goes backwards computes the same instants and cannot plan one
   twice.
10. **A changed declaration is a new revision.** Its planning window starts
    when it is materialized; the occurrences of earlier revisions stay exactly
    as they were, and `schedule_revisions` keeps what each revision declared.
    Schedules no longer declared in `MAESTRO_TASKS_FILE` are disabled at start,
    with their history kept; a schedule registered through the API lives until
    the next start. A declaration Maestro does not fully understand is refused
    whole, with a typed reason, before the database is opened.
11. **On start, the declaration is materialized, then every unsettled (DUE)
    occurrence is reconciled, before any new wait.**
12. **Missed occurrences follow the policy stored with the schedule**, `skip`
    by default: an instant more than `lateToleranceSeconds` late (default: half
    the cadence, between 1 and 30 s) is recorded MISSED and never replayed.
    `coalesce_latest` emits one occurrence at the latest missed instant and
    records the others MISSED. While a schedule holds an unsettled DUE
    occurrence, new instants are MISSED — the backlog per schedule is one, never
    a pile. One evaluation writes at most 100 MISSED rows; the rest are counted
    (`missed_unrecorded_total`), never dropped silently.
13. **Queue is the only way out.** An occurrence's exact request (today's beat
    job shape plus `occurrenceId`, `scheduleId`, `scheduleRevision`,
    `plannedAt`, and `idempotencyKey = occurrenceId`) is frozen when it becomes
    DUE and sent byte for byte on every attempt. Its attempt is counted durably
    before the request leaves; it is marked ENQUEUED, with Queue's job id, only
    after Queue answered `201 {duplicate:false}` or `200 {duplicate:true}`. A
    lost answer, a timeout or a 5xx leaves it DUE and is retried under the same
    key with bounded exponential backoff (8 attempts, 5 s doubling to 5 min);
    exhausted retries end in one lookup by key, then ENQUEUED or MISSED
    (`enqueue_retries_exhausted`). A `409 IDEMPOTENCY_CONFLICT` or another 4xx
    is a typed MISSED, never retried blindly. The direct-to-bridge path does
    not exist in this mode.
14. **One outstanding run per schedule, asked precisely.** Before the first
    attempt of a cadence occurrence, the previous occurrence's own job is looked
    up by its idempotency key; a job still PENDING or RUNNING makes the new
    occurrence MISSED (`previous_run_still_open`). Maestro never lists all of
    Queue's jobs to guess; that listing survives only in the memory scaffolding.
15. **Every durable change is committed before it is reported**, and a
    database failure is a typed 503 (`/api/health` answers 503 with the probe),
    never an empty answer: no occurrence is claimed as emitted when MariaDB did
    not record it.
16. **`GET /api/occurrences?schedule=&state=&limit=`** reads Maestro's own
    record, bounded (limit 1–500, default 50), without the frozen request.

What this storage does not yet provide, against the Maestro target contract
(recorded as gaps, not implied): an authenticated, scoped API (registration,
tick, start and stop are still open on localhost); scheduler leases for several
replicas (the schedule row lock and Queue idempotency are the only barriers
today); the `catch_up_bounded` and `halt` missed policies (refused at
declaration); civil-calendar cadences with declared timezone and
daylight-saving rules (cadence is a fixed number of UTC seconds); a
transactional outbox to Logger (evidence is still local JSONL plus
fire-and-forget ingest); monthly-partitioned archival of settled occurrence
history; declared stream, topic, job class and schema version on schedules
(only an optional `jobType`); refusal of arbitrary bridge URLs and model names
in a schedule; persistence of the started/stopped state (it follows
`MAESTRO_AUTO_START` at every start); and removal of the memory scaffolding
with its direct-to-bridge legacy path.

---

### Illustrative Example (Non-Binding / Demonstration Only)

* **Brick port**: `8630` | **Default cadence**: `300`s
* **Storage**: `maestro` database in the unit's private MariaDB, socket `/apps/maestro/nosav/run/mysqld/mysqld.sock` on the universe side
* **Logs**: `/apps/maestro/log` (local JSONL audit — evidence, not state)
