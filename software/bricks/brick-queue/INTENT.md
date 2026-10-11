# Brick: Queue

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)  
> **Package**: `@shaper/pkg-queue`

## 1. Declarative Objective

Durable async job queue — no external broker. Jobs live in the unit's own
private MariaDB; the package intent states the contract
([`pkg-queue/INTENT.md`](../../packages/pkg-queue/INTENT.md#private-mariadb)).

## 2. Invariants

1. Lifecycle: `PENDING` → `RUNNING` → `COMPLETED` | `FAILED`. A consumer claims a job (`POST /api/jobs/<id>/claim`) — a durable attempt bound to its unit and incarnation — and presents that attempt on every progress or terminal update; a terminal state is never rewritten, its identical repeat answers the same receipt, and a late update is `409 STALE_ATTEMPT` ([attempts](../../packages/pkg-queue/INTENT.md#attempts), schema version 4).
2. The Queue's durable state lives in its own private MariaDB (Rules 4 and 26): account, database and Linux user are all `queue`; the MariaDB server runs **inside this unit's own container**, as `mysql` (uid `10641`), beside the application (`queue`, uid `10640`) — two processes, one container, no database container beside it (Rule 4, Turbinobash method; [`runtime/unit-mariadb`](../../runtime/unit-mariadb/INTENT.md)); it has no TCP listener and its socket `/run/queue/mysqld.sock` is private to the container. A job state change is reported only after it commits; the image selects that store by default (`QUEUE_STORE=mariadb`) and never falls back to memory or a file.
3. The application password (`/apps/queue/etc/mysql/localhost/passwd`) is generated once inside the unit, `0600`, owned by the `queue` account, in a directory the account cannot write, never in an image, a log or a dump. The schema (`/apps/queue/app/packages/pkg-queue/sql/schema.sql` in the image) is applied by root through the unit's socket when the database is born, never by the application.
4. Localhost or mesh bind only.
5. Podman Quadlet lifecycle.
6. One instance per universe.
7. Every transition commits its evidence to the unit's outbox in the same transaction (schema version 4: `job_attempts`, and `recovery_points` for the declared cleanup); the unit relays it to Logger under a logger credential renewed from Vault (`SHAPER_UNIT_INCARNATION`, `UNIT_BOOTSTRAP_TOKEN_FILE`, `UNIT_AUTH_PUBLIC_KEY_FILE`, `VAULT_URL`, `LOGGER_URL`, from `/apps/queue/etc/identity/`, mounted read-only). A job found `RUNNING` at start is settled `FAILED` as interrupted, whatever the worker setting.

---

## 3. What experience corrected

Recorded here rather than only in the code, so the next universe inherits the
lesson instead of the bug (Rule 29, applied to intent as well as to tests).

* **This intent and the package's once disagreed about persistence.** It said
  "ephemeral — no persistence" while the package appended every change to a
  JSONL file and read it back at boot. A reader could not tell which to build.
  There is now one answer — the unit's private MariaDB — stated here and
  detailed in the package intent.

* **A logged write is not a durable write.** The JSONL store logged a failed
  append and still answered success, and skipped any line it could not parse
  at boot. A job could be acknowledged and never exist. The MariaDB store
  answers only after `COMMIT`, refuses with 503 when the database is gone, and
  refuses to start on a row it cannot read.

* **A retried enqueue is not a new job.** Without an idempotency key, a
  producer that lost the answer to its `POST` and asked again created a second
  job. A key now names the request; the `UNIQUE` constraint, not a pre-check,
  decides between two simultaneous attempts.

* **A read can be older than the last commit.** Once reads go to a database, a
  lane can see a job as `PENDING` after another change has moved it. The move
  to `RUNNING` is therefore a claim, granted only to a job still `PENDING`, and
  committed before anything reaches a bridge.

* **A late completion must not overwrite what recovery settled.** A job left
  `RUNNING` by a dead process was settled `FAILED`, orphaned, at the next
  start — and the dead process's late `COMPLETED` could still rewrite it. Each
  run is now an attempt; recovery invalidates it, and the late update is
  `STALE_ATTEMPT`.

* **An acknowledgement is not a result.** The queue once marked a job
  `COMPLETED` the moment a bridge answered `ok`. It now follows the run to its
  terminal event, and **subscribes before injecting** — a short run finished
  before anyone was listening.

* **Work whose end cannot be observed stays `RUNNING`**, with the reason
  recorded. A pending job beats an invented success; the invented one propagates
  and everything downstream inherits it.

* **But a run nobody watches any more is a fact, not a mystery.** Jobs left
  `RUNNING` by a worker that no longer exists are settled at startup. Left
  alone, each one holds its pod's exclusivity for ever — that pod never beats
  again — and inflates every capacity reading built on it.

* **Bridges do not share a vocabulary.** `done`/`exit_code`, `response_complete`
  /`exit`, `result`/`is_error`. They live in one table, so a fourth CLI is one
  line rather than a branch in the flow.

* **A terminal answer is evidence, not disposable transport.** When a bridge
  includes its final text in the terminal event, the queue persists that text
  beside the exit code. `COMPLETED` without the answer forces the proof client
  to reconstruct history from a transient SSE stream and breaks
  order → action → log → answer after a restart.

* **Capacity is measured, never declared**, and three ways of getting it wrong
  were found by saturating: service time must exclude queue wait, orphans must
  be out of the sample, and the sample must be bounded to the present. Each
  error grew with load — worst exactly when the number is consulted.

* **Utilisation and backlog answer different questions.** ρ describes a
  sustained arrival rate and stays calm during a burst, correctly. `backlog`
  says when the queue clears. One question per number.

* **Width is decided from above.** A universe never widens itself: it publishes
  evidence, the parent decides (Rule 23 applied to resources). A child asking
  itself whether it deserves more is judge and party.

* **A task must be reviewable before it is sent**: no perimeter, no goal, no
  brief — refused. Half a task is refused too, because it looks framed and is
  not, and a reader stops checking.

* **The follower must never reject.** Subscribing before injecting is what stops
  a short run finishing before anyone listens; its cost is that a failed
  subscription rejects before anything awaits it, and an unhandled rejection
  ends the process. One unreachable bridge once took the whole queue down — the
  most critical brick in the control plane, killed by a dead address. An
  unreachable bridge is simply the case the design already names: unobservable.

* **Name the kind of blindness.** "No event stream" and "the bridge refused the
  connection" call for different actions; a generic reason sends the reader to
  the wrong place.

## 4. What this brick does not yet do

Against the Queue target contract of 22 September 2026, and listed in full in
the package intent: durable leases with heartbeat and expiry over the
attempts, at-least-once lease recovery,
`DEAD_LETTER`, evidence policies, and the removal of task framing, Bridge
dispatch and the quality gate from Queue.

---

## Cognition

> Scales and semantics: [`docs/architecture/COGNITION.md`](../../../docs/architecture/COGNITION.md) · Extends Rule 21.

- **capacity-class**: — (deterministic, no engine)
- **role**: neutral
- **depth**: D0
- **throughput**: T3
- **degraded**: refuse
- **rationale**: Dispatch, lanes and persistence are mechanical. Each job carries its own cognitive requirement — the queue never carries one on their behalf.
