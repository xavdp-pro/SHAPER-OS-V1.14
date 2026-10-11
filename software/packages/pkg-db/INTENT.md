# Package: @shaper/pkg-db

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)
> **Perimeter**: P1 (Rule 0A) — every functional Podman of the base uses it from birth

## 1. Declarative Objective

Give every functional unit one way to reach **its own** private MariaDB (Rules 4
and 26): the functional slug is the function identity, the Linux system account,
the MariaDB account and the MariaDB database; the password comes from
`/apps/<slug>/etc/mysql/localhost/passwd`; the connection goes through the
unit's private unix socket, and the server — not the configuration — confirms
who the unit is before it serves anything.

## 2. Invariants

1. **One name everywhere.** `resolveUnitDbConfig` refuses a slug that is not a
   valid Linux account, MariaDB account and database name at once, and refuses
   `MYSQL_USER` or `MYSQL_DATABASE` values that differ from it.
2. **The password file is private.** It must be a regular file, mode `0600`,
   owned by the uid the unit runs as. Anything else is refused with a typed
   code, never read.
3. **The DEV fallback announces itself.** `MYSQL_PASSWORD` is used only when a
   caller asks for the fallback and the passwd file is absent; the resolved
   configuration then carries `passwordSource: "env-dev-fallback"`, which no
   qualification accepts.
4. **The server confirms the identity.** `openUnitDb` fails unless
   `CURRENT_USER()` is `<slug>@localhost` and `DATABASE()` is `<slug>`.
5. **The application never owns its schema.** `assertSchema` refuses to serve
   when `schema_meta` is absent or older than the build needs; tables are
   installed by the administrative path (local MariaDB root CLI), never by the
   application account, which holds no DDL privilege.
6. **Failures are typed.** Every refusal is a `UnitDbError` with a stable
   `code` (`INVALID_SLUG`, `IDENTITY_MISMATCH`, `PASSWD_MISSING`, `PASSWD_MODE`,
   `PASSWD_OWNER`, `PASSWD_EMPTY`, `DB_UNAVAILABLE`, `SCHEMA_MISSING`,
   `SCHEMA_TOO_OLD`). No empty replacement database is ever created.
7. **One dependency, in one file.** `index.js` uses Node built-ins only;
   `pool.js` loads the pinned `mysql2` driver. A consumer that only resolves
   identity never needs the driver installed.
8. **Every session speaks UTC.** `openUnitDb` sets `time_zone = '+00:00'` on
   each new pool connection, and refuses to serve (`SESSION_TIMEZONE`) when
   the first connection does not report it. Units write UTC `DATETIME`s, and
   SQL that converts instants (`UNIX_TIMESTAMP`, `FROM_UNIXTIME`, `NOW`) must
   read them as UTC whatever time zone the server or its host carries; before
   this, Vault's credential issuance refused every bootstrap on a server whose
   zone was ahead of UTC.

<a id="dev-scaffolding"></a>
## DEV scaffolding never qualifies

`qualificationFlags(env)` names the flags that declare a promotion or
qualification run: `SHAPER_QUALIFICATION` set to anything but empty or `0`, or
`SHAPER_RUNTIME_MODE` set to anything but `dev` or `development` (test, demo,
production). `assertDisposableStoreAllowed({ unit, store })` refuses a file or
memory store under either flag with `DEV_STORE_REFUSED`; each unit entrypoint
calls it before it builds such a store, so an explicit `*_STORE=file` (or
`memory`) remains possible for disposable DEV and impossible for anything
promoted. `resolveUnitDbConfig` refuses the `MYSQL_PASSWORD` fallback the same
way (`DEV_FALLBACK_REFUSED`). No entrypoint ever selects a DEV store by itself:
MariaDB is the default and an unknown store is a refusal.

## 3. Specialisation Points

| Parameter | Meaning |
| :--- | :--- |
| `slug` | The functional unit (`vault`, `logger`, `queue`, `maestro`, …) |
| `SHAPER_DB_SOCKET` | Private socket path inside the unit's container (default `/run/mysqld/mysqld.sock`) |
| `appsRoot` | Root of the Turbinobash layout (default `/apps`) |
| `SHAPER_QUALIFICATION` | Any value but empty or `0`: a qualification or promotion run — DEV stores and the password fallback are refused |
| `SHAPER_RUNTIME_MODE` | Anything but `dev`/`development` has the same effect |

## 4. Proof of Correct Operation

Unit tests (`test/`) cover the resolver without a database. The live proof is
the universe's own `deploy/proof.sh`, run against the real private MariaDB of
every unit (Rule 0G): the identity the server confirms, the schema installed by
the administrative path, and — checked from outside the unit — that no other
unit can reach the socket and that another unit's credential is refused.

## 5. Lineage

The resolver descends from the catalogue's `@shaper/pkg-db` (identity equality,
passwd path), itself from turbinobash-web's "one name everywhere". It entered
the base when Rules 4 and 26 made a private MariaDB mandatory for the base's
own units, which cannot import catalogue source. The catalogue copy is
superseded; its removal belongs to the catalogue repository
(`doctrine/CONVERGENCE-STATE.md`).

---

## Cognition

- **capacity-class**: — (deterministic, no engine)
- **role**: neutral
- **depth**: D0
- **throughput**: T3
- **degraded**: refuse
- **rationale**: Identity resolution and connection setup are deterministic; no model sits in the path of a credential.

## Transactional outbox helper

`outbox.js` records a bounded delivery obligation on a connection supplied by
the owning unit's transaction. `sql/outbox.sql` is a schema fragment for that
unit's administrative installation; the helper performs no DDL. No shared
database or separate outbox service is introduced.

The relay works row by row in three steps, and holds no lock and no
connection while it waits for the recipient:

1. **Claim**, in a short READ COMMITTED transaction: the oldest due row is read
   `FOR UPDATE SKIP LOCKED`, its `next_attempt_at` is pushed past the delivery
   deadline plus five seconds (a lease), and the transaction commits.
2. **Send** the stored bytes, bounded by the AbortSignal deadline.
3. **Settle**, in another short transaction: the validated receipt is stored,
   or the attempt is counted with `DELIVERY_UNCONFIRMED` and the row comes due
   again after a backoff of one second doubling to 256 seconds.

A relay that dies between claim and settlement leaves its row leased, then due
again under the same `sourceEventId`; a second relay never sends a leased row.
Lost replies and failed commits therefore require recipient idempotency: no
universal exactly-once effect is claimed. A row whose bytes, digest or source
id do not match is never sent nor guessed around: it is marked
`OUTBOX_ROW_INVALID`, kept as it is for repair, set aside for 300 seconds, and
the rows behind it are delivered. Before this, the relay kept one transaction
open across the send: under REPEATABLE READ its locking read held gap locks, so
every evidence insert of the unit waited for the Logger round trip (the live
test measured inserts blocked until the lock-wait timeout), and one damaged
oldest row stopped all delivery.

`createEvidenceRelay` is the one delivery lane a unit's service lifecycle
runs: started after the service listens, a timer runs one non-overlapping
batch at a time. Each round first reads whether a row is due
(`hasDueEvidence`, no lock); only then is the transport credential obtained,
so an idle unit asks Vault for nothing — before this, every unit issued itself
a credential on every renewal whether or not it owed evidence
(DECISIONS-20261011 §C). The credential is obtained *before* the relay opens
its transaction (Vault's own issuance appends to the same outbox); a refused
or unavailable credential is asked again after a backoff of two intervals
doubling to one minute, not on every tick. `close()`
waits a bounded time for the batch in flight before the database closes — an
unconfirmed batch is reported, never claimed, and its debt stays. Repeated
identical failures are reported once, then again when the reason changes or
delivery resumes. `outboxStatus` gives the debt still owed (pending, retrying,
oldest pending instant, rows set aside as invalid) for each unit's vitals: a
down Logger is observable. Each pool connection that cannot be pinned to UTC
is destroyed rather than used.

Vault, Queue and Maestro carry this exact table in their own schema; a test
holds the three definitions equal to `sql/outbox.sql`.

<a id="retention"></a>
## Declared cleanup (dataLifecycle)

`sql/outbox.sql` also defines `recovery_points`, which the same three units
carry (schema version 3). Only the administrative path writes it: the parent
records a point once a logical dump of the unit's database has been restored
into a fresh volume and read back (univ-minimal `deploy/restore-drill.sh`),
with the instant taken before the dump's snapshot. `pruneDeliveredOutbox`
then removes, in bounded batches, a row delivered more than 30 days ago only
when it carries Logger's verified receipt and a recovery point taken after its
delivery (five-minute margin) holds it. A row still owed, set aside as invalid
or failed is never removed, and without a recovery point nothing is.
`createMaintenanceLane` runs a unit's cleanup jobs hourly (first after one
minute) in its service lifecycle, closed before the database. Each universe
declares these classes in its `manifest.json` `dataLifecycle` (Rule 31).

<a id="live-tests"></a>
## Live tests

`test/live/run-live.mjs` starts one throwaway MariaDB server on a private
socket (no TCP), provisions the four base units as the administrative path
does — database and account of the slug, `SELECT, INSERT, UPDATE, DELETE` on
that database only, schema installed by root, password in
`<apps>/<slug>/etc/mysql/localhost/passwd` (0600) — runs the given
`*.live.mjs` files against it one at a time, then removes everything:

```sh
MARIADB_BASEDIR=<extracted MariaDB, holding usr/sbin/mariadbd> \
  node software/packages/pkg-db/test/live/run-live.mjs \
  software/packages/pkg-{queue,vault,maestro}/test/*.live.mjs
```

A live file run any other way fails at once; no other database is substituted
(Rule 0G). These files prove the services' SQL, transactions, outbox,
recovery and the real Vault → Logger authorization path. They do not replace
the universe's Rule 26 inventory of the running containers.
