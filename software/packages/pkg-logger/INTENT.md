# Package: @shaper/pkg-logger

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)  
> **Manifest**: [`topology.json`](../../topology.json) → node `logger`

---

## 1. Declarative Objective

Durably record structured events from every unit — agent telemetry, job
lifecycle, security tracing — and answer what was actually received, in the
order it was received, from the Logger unit's own private MariaDB.

---

## 2. Universal Invariants (Parameterized)

1. **Format**: one canonical event per record — `at`/`timestamp` (Logger receipt time), `pod`, `event`, `level`, `correlationId`/`correlation_id`, `execution_id`, `data`, `duration_ms`; the MariaDB store adds `id`, `sourceEventId` and `digest`.
2. **Append-only**: an accepted event is never mutated, reordered or deleted by the application.
3. **Dual mode**: in-process `EventLogger` / `LogCollector` (JSONL, used as a library by other units) or the HTTP gateway `createLoggerServer()` over an event store.
4. **Dependency-free library surface**: `index.js`, `events.js`, `vitals.js`, `ingest-client.js` and `ingest-contract.js` use Node built-ins only and import no sibling package, because other units' images ship `pkg-logger` without `pkg-db`. Only `mariadb-store.js`, loaded by `server.js`, reaches `../pkg-db/`.

## 3. Invariants learned by running it

<a id="identity"></a>
### 3.1 A service announces its layer, not its version

Every service states `service: "brick-<component>"` on `/api/health` and
`/api/vitals`. The supervisor reads that name to decide what it is looking at,
so the name is a contract and not a label.

*Why this is written here.* Until V1.11 four bricks announced `vault-v1`,
`logger-v1`, `queue-v1` and `maestro-v1` — a version suffix frozen at `v1`
through eleven releases, naming a layer the reader had to infer. Maestro was
renamed and the others were not, so the fleet spoke two vocabularies at once,
which is worse than leaving all four alone. A partial rename is a defect in its
own right.

<a id="sibling-paths"></a>
### 3.2 A package must be reachable at the path its importers resolve

When a package is flattened into an image's `WORKDIR`, a sibling import such as
`../pkg-logger/vitals.js` resolves to `/pkg-logger/`. The image must place it
exactly there. The name in the import and the destination of the copy are the
same fact stated twice, and they must not be allowed to drift apart.

*Why this is written here.* V1.10 renamed every package to `pkg-*`, which changed
every sibling import, and left the copy destination at `/logger/`. Every image
built that way threw `Cannot find module '/pkg-logger/vitals.js'` on its first
import — including the one brick V1.10 had converted and the test it had
written, which checked that the Containerfile *mentioned* the package and never
where it put it. A guard that reads a name proves nothing about a path.

<a id="evidence"></a>
### 3.3 Evidence is what the logger holds, not what answers

`/api/events` is a live stream: it answers the moment it is opened, whether or
not anything was ever recorded. A proof that reads it observes a socket. The
question "is there evidence" is answered by `/api/events/last`, which returns
what is actually held. Practical note that has cost two testers ~2 minutes
each: a plain `curl` on `/api/events` **never returns** — an SSE stream needs
`curl -N` and a bounded read, or just use `/api/events/last`.

*Why this is written here.* `univ-base`'s proof script reported "the logger holds
evidence" while observing only that a connection succeeded. A probe that cannot
fail is not a probe, and this class of mistake — confusing reachability with
content — will outlive this particular endpoint.

<a id="private-mariadb"></a>
## 4. Storage: the unit's private MariaDB (Rules 4 and 26)

5. **The durable store is the `logger` database of the unit's own MariaDB**, reached through its private socket as `logger@localhost` (`MariaDbLoggerStore`, `sql/schema.sql`). The brick selects it by default (`LOGGER_STORE=mariadb`) and refuses to start, with a typed reason, when the passwd file, the identity or the schema is not what it must be. The JSONL collector remains as declared DEV scaffolding, selected only with `LOGGER_STORE=file` and an explicit `LOG_DIR`, never as a fallback; it keeps what it is given and claims nothing more — no idempotency, no digest, no transaction.
6. **The schema is installed by the administrative path.** The application account holds `SELECT, INSERT, UPDATE, DELETE` on `logger.*` only, never creates or alters a table, and refuses to serve when `schema_meta` is absent or older than the build. Re-applying the schema is idempotent and never undoes partition maintenance.
7. **Events are immutable and partitioned monthly by receipt time.** `events` is partitioned `RANGE COLUMNS (received_at)`, one partition per calendar month (UTC), from `p2026_08` to `p2027_03`, then `p_future` (`MAXVALUE`). Receipt time is assigned by Logger, never by the source, as a `DATETIME(3)` in UTC — `TIMESTAMP` is not a `COLUMNS` partitioning type. Triggers refuse `UPDATE` and `DELETE` on `events`; retention retires whole partitions from the administrative path.
8. **`p_future` is a guard, not a destination.** It must stay empty so that splitting it ahead of time moves no data. `/api/vitals` reports `partitionHorizon` (the bound of the last monthly partition) and `eventsBeyondHorizon` (rows already past it): a non-zero count means partition maintenance fell behind.
9. **Receipt order is exact.** The primary key is `(received_at, id)`: MariaDB requires the partition column in every unique key, and the same key clusters rows in receipt order. `id` is a Logger-assigned UUIDv7 whose generator is monotonic within the process and whose millisecond *is* the receipt time, so a stalled or stepped-back clock never reorders two receipts.
10. **Idempotency lives where uniqueness can be held.** A source may supply `sourceEventId` (≤ 191 characters, no control characters). Because a retry arrives at a different receipt time, a unique key on the partitioned `events` — which must include `received_at` — could never see it as a duplicate. Uniqueness is therefore held by the unpartitioned `ingest_keys` table, primary key `(pod, source_event_id)`, written in the same transaction as the event and pointing at it by its full primary key. The same id with the same normalised claim (its `claim_digest`) returns the original receipt, byte for byte, with `replayed: true`; the same id with a different claim is refused `409 SOURCE_EVENT_CONFLICT`, and the refusal is itself recorded as a `LOGGER_INGEST_CONFLICT` event from `brick-logger`, filed under the refused submission's correlation id (claim digests stay in that record and are never handed to the submitter). Without a source id, every ingest is a new event, as before.
11. **Every event carries its own digest.** `digest` is the SHA-256 of the canonical JSON (sorted keys, no whitespace) of the stored event: the normalised claim plus Logger's `id`, receipt time and execution id. Anyone reading the row can recompute it; a replay whose stored row no longer matches its digest is refused (`DIGEST_MISMATCH`) rather than served.
12. **A receipt means committed.** `/api/ingest` answers `200` only after the MariaDB transaction commits. An array ingest is one transaction: every entry is kept, or none. Every entry is validated before anything is written. A database failure answers `503` with the typed code `DB_UNAVAILABLE` and no record; `/api/health` answers `503` with the probe's evidence when the database does not answer; `/api/vitals` keeps answering with that evidence (`checks.database.lastError`).
13. **Ingest is bounded.** Body ≤ `LOGGER_MAX_BODY_BYTES` (default 1 MiB, `413 BODY_TOO_LARGE`, enforced while streaming), batch ≤ `LOGGER_MAX_BATCH` entries (default 500, `413 BATCH_TOO_LARGE`), canonical `data` of one event ≤ `LOGGER_MAX_EVENT_BYTES` (default 64 KiB, at most 1 MiB, the ceiling the schema also checks; `413 EVENT_TOO_LARGE`). `pod` and `event` ≤ 128 characters, correlation and execution ids ≤ 191 (`400 FIELD_TOO_LONG`). A limit set to an invalid value refuses the start; it never becomes a default. Large artefacts are recorded by reference and digest.
14. **Queries are bounded and indexed.** `GET /api/events/last` keeps `pod` and `limit`, and adds `correlationId`, `event`, `since` and `until` (receipt time, ISO-8601); each filter has an index with `received_at`. `limit` defaults to 50 and is capped at 1000; a malformed value is refused `400 INVALID_QUERY`.

What this storage does not yet provide, against the Logger target contract, recorded as gaps rather than implied:

* **Authenticated source identity.** `pod` is still what the body claims. Vault-signed, short-lived source credentials — and a `sourceEventId` scope derived from them instead of the claimed `pod` — belong to the next step.
* **The cross-event chain and external checkpoints.** Each event proves its own integrity; nothing yet links an event to the previous one, keeps the chain head in a control table, or anchors signed checkpoints outside the database. Deleted rows are not yet detectable.
* **Partition maintenance automation.** Splitting `p_future` ahead of time, alerting on the horizon, freezing, backing up and retiring closed partitions (with their `ingest_keys` rows) are administrative operations still to be scripted and proven.
* **Outbox receipts.** Sources still send best-effort (`ingestLog` returns `null` on refusal); a transactional outbox that retries with the same `sourceEventId` until a receipt is held is not built.
* **The rest of the classification grammar.** `family`, `topic`, `schema_version`, `subject_ref`, typed outcome and source occurrence time are not stored yet.

---

### Illustrative Example (Non-Binding / Demonstration Only)

* **Brick port**: `8620`
* **Storage**: `logger` database in the unit's private MariaDB, socket `/apps/logger/nosav/run/mysqld/mysqld.sock` on the universe side
* **DEV scaffolding only**: `LOGGER_STORE=file LOG_DIR=<dir>` → `<dir>/<POD>/activity.jsonl`
