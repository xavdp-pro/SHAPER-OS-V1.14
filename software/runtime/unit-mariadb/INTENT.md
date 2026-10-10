# Runtime: unit-mariadb

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)
> **Perimeter**: P1 (Rule 0A) — the container process of every functional unit that owns a private MariaDB

## 1. Declarative Objective

Run one functional unit the Turbinobash way — Rule 4, clause "The Turbinobash
Method: One Application Account per Server", of the governing SHAPER OS V1.15
corpus (`docs/rules/02-CONSTRUCTION.md#rule-4` at `9ad14ba`; this tree's
[Rule 4](../../RULES.md#rule-4) is its lineage): **the application and its own
MariaDB server, two processes in one container**. The functional slug is the Linux account, the MariaDB
account and the database. No separate database container, no TCP listener, no
shared server.

The runtime is copied into each unit image from the base image
(`/shaper/runtime/unit-mariadb/` → `/usr/local/lib/shaper/unit-mariadb/`) and
is the image's entrypoint, under `tini`:

| Process | Account | What it is |
| :--- | :--- | :--- |
| `tini` (pid 1) | root | container init: forwards the stop signal, reaps |
| `supervisor.mjs` | root | the container's administrative path; never runs application code |
| `mariadbd` | `mysql` (fixed uid per unit) | the unit's private server, socket only |
| the application (`CMD`) | `<slug>` (fixed uid > 1000) | the unit itself |

## 2. Invariants

1. **One name everywhere.** `SHAPER_UNIT_SLUG` is the application account
   (home `/apps/<slug>`), the MariaDB account and the database. The account,
   the engine account `mysql` and their groups carry the fixed numeric ids the
   image declares (`UNIT_UID`, `UNIT_ENGINE_UID`); a mismatch refuses to start.
2. **Socket only.** `mariadbd --no-defaults --skip-networking`, socket
   `/run/<slug>/mysqld.sock`; the socket directory belongs to `mysql`, group
   `<slug>`, mode `0750`, rebuilt at every start. Nothing mounts it.
3. **The application cannot reach the server's files.** Before anything
   starts, the supervisor refuses when the application account could modify or
   replace the datadir, the socket directory, the password directory, the
   schema, the runtime or the MariaDB option files — directly or through a
   writable ancestor directory, or through a symbolic link.
4. **No recursive ownership change.** Only single directories of the layout
   are converged. An existing datadir owned by another uid is refused
   (`DATADIR_OWNER_MISMATCH`): move data with a logical dump, never a chown.
5. **One password file, generated once.** `/apps/<slug>/etc/mysql/localhost/passwd`,
   64 hex characters, `0600`, owned by `<slug>`, in a directory owned by root.
   It is generated only when the datadir is born; an existing database without
   it refuses (`PASSWD_MISSING_FOR_EXISTING_DATABASE`). The password travels on
   standard input or in a root-only option file, never on a command line, and
   is redacted from every log line.
6. **Credential continuity, never a silent rotation.** At every start the file
   must open `<slug>@localhost` on `<slug>` (`CREDENTIAL_MISMATCH`, exit 9).
7. **Root administers through its own path.** `mariadb -uroot` over the socket,
   by `unix_socket` as OS root. At first birth every account but
   `root@localhost` and `mariadb.sys@localhost` is removed and root is set to
   `unix_socket` alone. At every start, before any grant or schema statement,
   the retained accounts are observed: exactly one root, `root@localhost`, by
   `unix_socket` with no authentication string and no alternative method; no
   principal other than root, `mariadb.sys` and `<slug>`; the `PUBLIC`
   pseudo-role holding nothing. Otherwise `ADMIN_AUTHENTICATION_MISMATCH`,
   exit 8 (port of SHAPER-OS-V1.14 `c0ab540`). Authentication strings never
   leave the server.
8. **The exact schema version.** A retained database with tables must carry
   exactly the version the image declares (`UNIT_SCHEMA_VERSION`, from
   `brick.json`); otherwise `SCHEMA_VERSION_MISMATCH`, exit 7, before any grant
   or schema statement (port of `938555b`, provisioning part — these units'
   `schema_meta` has no profile column, so the exact version is the profile).
   The schema is applied by root only into an empty database; a restart
   re-applies nothing. A schema change is a version change with its own
   authorized migration (Rule 30).
9. **Runtime data privileges only.** `SELECT, INSERT, UPDATE, DELETE` on
   `<slug>.*`, nothing else, verified from `information_schema` after every
   convergence (`GRANTS_MISMATCH`, exit 10).
10. **Readiness is gated on MariaDB.** The application starts only once the
    server this supervisor started — the pid file names its child and the
    server reports that pid file — answers the root path, and birth has
    completed. `unit-ready` (the health command) checks the engine process
    (`mariadbd`, engine uid), the root path, `@@skip_networking = 1`, the
    application process (unit uid) and `UNIT_HEALTH_URL`.
11. **Coordinated stop.** SIGTERM: the application gets `UNIT_DRAIN_SECONDS`
    to finish, then MariaDB gets `UNIT_ENGINE_STOP_SECONDS` to shut down
    cleanly. Either process ending on its own stops the other in the same order
    and ends the container, so the restart policy recreates both together.

## 3. Specialisation Points

Declared by each unit image (`Containerfile`, from `brick.json`):

| Variable | Meaning |
| :--- | :--- |
| `SHAPER_UNIT_SLUG` | the functional slug |
| `UNIT_UID`, `UNIT_ENGINE_UID` | fixed ids of the application and engine accounts |
| `UNIT_SCHEMA_FILE`, `UNIT_SCHEMA_VERSION` | the schema root applies at birth, and its exact version |
| `SHAPER_DB_SOCKET` | must equal `/run/<slug>/mysqld.sock` |

Set by the universe at run time:

| Variable | Meaning |
| :--- | :--- |
| `UNIT_MODE` | `serve` (default); `birth` births or keeps the database, then stops; `database` keeps only the database up (administration, restore checks) |
| `UNIT_RESTORE_DUMP` | a `mariadb-dump --databases <slug>` file inside `/apps/<slug>/sav/`, owned by root, private; honoured only by a fresh datadir — the restore into a fresh volume |
| `UNIT_HEALTH_URL` | the application's health endpoint, checked by `unit-ready` |
| `UNIT_DRAIN_SECONDS`, `UNIT_ENGINE_START_SECONDS`, `UNIT_ENGINE_STOP_SECONDS` | bounds of the lifecycle (20, 120, 60) |

The container needs: root inside it (the administrative path), the capabilities
`CHOWN DAC_OVERRIDE FOWNER KILL SETGID SETUID` only, `no-new-privileges`, and
three persistent volumes per unit: `/apps/<slug>/etc/mysql` (the password),
`/apps/<slug>/sav` (the datadir, dumps) and `/apps/<slug>/log`.

## 4. Proof of Correct Operation

`test/` runs under `node --test` without a server: the order of birth (every
refusal before any grant or schema statement), the parsers and SQL builders,
the filesystem-rights predicate, the coordinated stop with real child
processes, and the consistency of the four base unit images with their
`brick.json`, schema and universe manifest. The live proof is the universe's:
`software/universes/univ-minimal/deploy/proof.sh` (the Rule 26 inventory from
outside every unit) and `restore-drill.sh` (each unit restored from its dump
into a fresh volume and read back by its application).

## 5. Lineage

Reworked from `software/scripts/provision-unit-mariadb.sh` (Space2 branch,
`19a792b`), which ran each unit's MariaDB as a separate container — the shape
the 10 October 2026 Turbinobash direction forbids. Kept from it: root by
`unix_socket` only (its lesson: an initialisation secret unreadable by `mysql`
left root without a password, and the application could become root through
the shared socket — here no root password exists at any moment), the password
generated once and never on a command line, DML-only grants, schema by root.
The in-container lifecycle follows the Clinic reference
(`univ-clinic0-bricks/brick-voice/entrypoint.sh`, `src/mariadb-birth.js`) and
corrects what it leaves: the application no longer runs as root, no recursive
chown, the datadir's engine uid is fixed, readiness names the started server.

---

## Cognition

- **capacity-class**: — (deterministic, no engine)
- **role**: neutral
- **depth**: D0
- **throughput**: T3
- **degraded**: refuse
- **rationale**: Process supervision and database birth are deterministic; no model sits in the path of a credential or a datadir.
