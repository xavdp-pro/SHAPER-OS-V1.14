# Brick: Maestro

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)  
> **Package**: `@shaper/pkg-maestro`

## 1. Declarative Objective

Cadence scheduler — decides when 1..N declared tasks are due and submits one
idempotent occurrence per due instant to Queue; zero idle LLM waste.

## 2. Invariants

1. Scheduling only — no AI inference, no execution of the work it schedules.
2. Requires logger for audit trail.
3. Tasks loaded from `MAESTRO_TASKS_FILE` — zero hardcoded mailboxes (Rule 0B).
4. Podman Quadlet lifecycle.
5. Maestro's durable state — schedules, revisions, occurrences, Queue job ids —
   lives in its own private MariaDB (Rules 4 and 26): account, database and
   Linux user are all `maestro`, uid fixed at `10630`; the database has no TCP
   listener and is reached only through a socket directory mounted into this
   unit's two containers. The schema is `/app/packages/pkg-maestro/sql/schema.sql`
   in the image, applied by the administrative path.
6. The application password (`/apps/maestro/etc/mysql/localhost/passwd`) is
   `0600`, owned by the `maestro` account, mounted read-only, never in an
   image, a log or a dump.
7. The image selects `MAESTRO_STORE=mariadb`; it refuses to start without its
   passwd file, its schema, `SHAPER_UNIVERSE_ID` (part of every occurrence id)
   or `MAESTRO_QUEUE_URL`, each with a typed reason. It never falls back to the
   in-memory scaffolding or to a direct bridge call.
8. Every occurrence reaches Queue under its deterministic idempotency key, so a
   restart before, during or after a due instant cannot create a second job for
   it.

## 3. What experience corrected

* **Timer phase is not state.** The first Maestro armed `setInterval` timers at
  start and kept its registry and counters in memory: every restart re-phased
  every task from the moment the process came up, and nothing remembered which
  instants had already been handed to Queue. Instants are now derived from a
  stored anchor and cadence, and each one is recorded before and after it is
  submitted.
* **Listing everything to guess is not asking.** Checking whether a previous
  beat was still open by listing every Queue job scaled with Queue's history
  and matched on payload text. The durable path asks Queue about the previous
  occurrence's own job by its idempotency key, and nothing else.

What the brick does not yet provide is listed in the package intent
([`pkg-maestro/INTENT.md`](../../packages/pkg-maestro/INTENT.md#private-mariadb)).

---

## Cognition

> Scales and semantics: [`docs/architecture/COGNITION.md`](../../../docs/architecture/COGNITION.md) · Extends Rule 21.

- **capacity-class**: — (deterministic, no engine)
- **role**: neutral
- **depth**: D0
- **throughput**: T3
- **degraded**: refuse
- **rationale**: Scheduler only. Rule 21: Maestro never executes heavy transformation itself; it hands each due occurrence to Queue.
