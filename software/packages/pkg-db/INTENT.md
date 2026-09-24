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

## 3. Specialisation Points

| Parameter | Meaning |
| :--- | :--- |
| `slug` | The functional unit (`vault`, `logger`, `queue`, `maestro`, …) |
| `SHAPER_DB_SOCKET` | Private socket path inside the unit's container (default `/run/mysqld/mysqld.sock`) |
| `appsRoot` | Root of the Turbinobash layout (default `/apps`) |

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
