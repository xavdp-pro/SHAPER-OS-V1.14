# Brick: Logger

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)

## 1. Declarative Objective

Durable, append-only record of the events agents and pods emit, held in the
Logger unit's own private MariaDB and answered in receipt order.

## 2. Invariants

1. One immutable row per accepted event — never mutated, never deleted by the application; the schema's triggers refuse both.
2. The Logger's durable state lives in its own private MariaDB (Rules 4 and 26): account, database and Linux user are all `logger`; the MariaDB server runs **inside this unit's own container**, as `mysql` (uid `10621`), beside the application (`logger`, uid `10620`) — two processes, one container, no database container beside it (Rule 4, Turbinobash method; [`runtime/unit-mariadb`](../../runtime/unit-mariadb/INTENT.md)); it has no TCP listener and its socket `/run/logger/mysqld.sock` is private to the container. The events are in that database; the unit's volumes hold its password, its datadir and dumps, and its log.
3. The application password (`/apps/logger/etc/mysql/localhost/passwd`) is generated once inside the unit, `0600`, owned by the `logger` account, in a directory the account cannot write, never in an image, a log or a dump.
4. The schema (`/apps/logger/app/packages/pkg-logger/sql/schema.sql` in the image) is applied by the administrative path; the application never creates or alters a table and refuses to start without the schema version it needs.
5. Events are partitioned monthly by Logger receipt time, with an empty guard partition `p_future`; `/api/vitals` reports the partition horizon and any row past it.
6. A receipt (`200` on `/api/ingest`) means the transaction committed. A database failure is `503 DB_UNAVAILABLE`, never an empty answer; `/api/health` answers `503` when the database does not.
7. A source-supplied `sourceEventId` makes ingest idempotent: the same id and content return the original receipt, a different content is refused `409` and recorded.
8. Localhost bind only (`HOST=127.0.0.1` on the host network), Podman Quadlet lifecycle.
9. The JSONL store is DEV scaffolding, selected only with `LOGGER_STORE=file` and an explicit `LOG_DIR`; the image never preselects it.
10. Every request but `/api/health` needs a Vault-signed credential for audience `logger`, checked current at Vault (`VAULT_URL`, the pinned `UNIT_AUTH_PUBLIC_KEY_FILE`, `SHAPER_UNIVERSE_ID`): `logger:ingest` to write — the event's source is the authenticated unit, never a claim — `logger:read:own` to read one's own events, `logger:observe` for pods and vitals. An anonymous call is refused.

## 3. What is not yet provided

Against the Logger target contract, recorded as gaps (detail in
[`pkg-logger/INTENT.md#private-mariadb`](../../packages/pkg-logger/INTENT.md#private-mariadb)):
the cross-event integrity chain with external checkpoints, signed receipts,
and partition maintenance automation (split ahead, freeze, back up, retire).

---

## Cognition

> Scales and semantics: [`docs/architecture/COGNITION.md`](../../../docs/architecture/COGNITION.md) · Extends Rule 21.

- **capacity-class**: — (deterministic, no engine)
- **role**: neutral
- **depth**: D0
- **throughput**: T3
- **degraded**: refuse
- **rationale**: Append-only structured audit. No model, ever: the record must not be interpretable by the thing being recorded.
