# Brick: Vault

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)

## 1. Declarative Objective

Local sovereign secret store — zero cloud lock-in.

## 2. Invariants

1. AES-256-GCM at rest.
2. Localhost or mesh bind only — zero public exposure.
3. Podman Quadlet lifecycle.
4. One instance per universe.
5. The Vault's durable state lives in its own private MariaDB (Rules 4 and 26): account, database and Linux user are all `vault`; the MariaDB server runs **inside this unit's own container**, as `mysql` (uid `10611`), beside the application (`vault`, uid `10610`) — two processes, one container, no database container beside it (Rule 4, Turbinobash method; [`runtime/unit-mariadb`](../../runtime/unit-mariadb/INTENT.md)); it has no TCP listener and its socket `/run/vault/mysqld.sock` is private to the container.
6. The application password (`/apps/vault/etc/mysql/localhost/passwd`) is generated once inside the unit, `0600`, owned by the `vault` account, in a directory the account cannot write; the master key file is `0400`, owned by `vault`, mounted read-only. Neither is ever in an image, a log or a dump.
7. Vault signs the universe's short-lived unit credentials (schema version 2: `unit_identities`, `unit_credentials`, `event_outbox`). The parent registers each unit's incarnation and pins Vault's public key in the units that verify ([`pkg-vault` parent registration](../../packages/pkg-vault/INTENT.md#parent-registration)); every secret change and issuance commits its evidence in the same transaction, and Vault relays it to Logger under a logger credential it issues to itself (`SHAPER_UNIT_INCARNATION`, `UNIT_BOOTSTRAP_TOKEN_FILE`, `LOGGER_URL`). Its identity inputs arrive in `/apps/vault/etc/identity/`, mounted read-only.

## 3. What experience corrected

* **Empty is a valid persisted state.** A zero-secret bootstrap must create the
  storage file containing an empty object. Reporting success without a file
  makes every cold boot repeat bootstrap and makes “empty” indistinguishable
  from “never initialized”.
* **Encryption does not replace filesystem isolation.** Clean-sheet deployment
  exposed a default `0644` file. Every persistence now creates or repairs the
  Vault storage file to `0600`.
* **A database initialised with an unreadable root secret keeps an empty root
  password.** On the first private-MariaDB build, a root password file the
  MariaDB account could not read left `root@localhost` without a password, and
  the application's container could log in as root through the shared socket.
  The unit's MariaDB root now authenticates by `unix_socket` only, network root
  accounts and image default accounts are removed, and the universe proof
  checks that the application account cannot become root. Since the MariaDB
  server moved into the unit's own container (10 October 2026), no root
  password exists at any moment: the datadir is born with `unix_socket` root,
  and every start refuses a retained root that accepts anything else.

---

## Cognition

> Scales and semantics: [`docs/architecture/COGNITION.md`](../../../docs/architecture/COGNITION.md) · Extends Rule 21.

- **capacity-class**: — (deterministic, no engine)
- **role**: neutral
- **depth**: D0
- **throughput**: T3
- **degraded**: refuse
- **rationale**: Encryption, storage and controlled decryption. A model must never be in the path of a secret.
