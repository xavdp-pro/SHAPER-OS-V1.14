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

* **Complete source identity metadata.** MariaDB HTTP ingestion now derives
  `pod` from a verified unit credential and rejects a different body claim.
  The service pins one universe and validates the current incarnation in Vault.
  Explicit persisted universe/incarnation columns, identity-aware chain records
  and their migration/replay contracts remain open.
* **The cross-event chain and external checkpoints.** Each event proves its own integrity; nothing yet links an event to the previous one, keeps the chain head in a control table, or anchors signed checkpoints outside the database. Deleted rows are not yet detectable.
* **Partition maintenance automation.** Splitting `p_future` ahead of time, alerting on the horizon, freezing, backing up and retiring closed partitions (with their `ingest_keys` rows) are administrative operations still to be scripted and proven.
* **Outbox adoption.** `deliverLog` supplies strict receipt verification for
  durable relays, including claim identity and event digest. Queue now persists
  delivery debt transactionally. Other source paths still use best-effort
  `ingestLog`; authenticated end-to-end delivery and installed restore proof
  remain open.
* **The rest of the classification grammar.** `family`, `topic`, `schema_version`, `subject_ref`, typed outcome and source occurrence time are not stored yet.

---

### Illustrative Example (Non-Binding / Demonstration Only)

* **Brick port**: `8620`
* **Storage**: `logger` database in the unit's private MariaDB, socket `/apps/logger/nosav/run/mysqld/mysqld.sock` on the universe side
* **DEV scaffolding only**: `LOGGER_STORE=file LOG_DIR=<dir>` → `<dir>/<POD>/activity.jsonl`

## Authenticated HTTP boundary

The MariaDB entrypoint requires a parent-pinned public-key file, universe id and
Vault URL. Factory callers without authorization are refused for MariaDB; an
explicit `allowAnonymous` option exists only for database-free storage fixtures,
and is not exposed as an entrypoint deployment setting. File DEV scaffolding
retains its declared legacy behavior.

Ingestion requires `logger:ingest`; the authenticated unit is the event source.
Reads require `logger:read:own` and are forced to that source. Pod inventory and
vitals require `logger:observe`. Streams filter to the authenticated unit, check
current authority before every emitted event, close at credential expiry and
cap queued frames. Health remains a payload-free liveness endpoint.

Protected requests verify Ed25519 signature, universe, audience, exact scopes
and validity, then obtain Vault's current incarnation/revocation decision. A
missing or unavailable verifier never enables anonymous access. Receipts remain
transactional and replay identity stays stable across credential renewal.

## Public event input boundary

Before canonicalization or any write, the HTTP normalization and direct
MariaDB ingest boundary reject secret-bearing fields (case and separator
insensitive), recognized credential strings, private-key PEM, authorization
values, credential-bearing URLs, cookies and secret query assignments.
The in-process event formatter applies the same refusal before JSONL output.
Nested arrays and even ignored request metadata are checked. Public references,
digests and counters such as `secretRef`, `artifactRef`, `tokenCount` and
`passwordSource` remain admissible; the referenced secret value does not.

Buffers, typed binary views, serialized Buffer objects, accessors, non-JSON
objects, repeated/cyclic object graphs and non-finite values are refused.
Traversal is iterative and bounded to 32 levels, 10000 values and 2 MiB of
aggregate key/string bytes, in addition to HTTP/body/data limits. A refused
batch writes no event and no replay key.
Refusal messages never include the submitted field/value; malformed JSON and
unexpected storage exceptions are answered without raw exception messages.
The canonical event format and SQL schema are unchanged by this boundary.

This is a defense against declared secret fields and recognizable encodings,
not an oracle for arbitrary secrets concealed in otherwise ordinary strings.
The producing unit must emit only public evidence. Versioned event schemas,
closed classification and explicit body/reference contracts remain required
before final reference qualification. No existing history is migrated here.
