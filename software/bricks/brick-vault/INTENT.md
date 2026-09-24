# Brick: Vault

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)

## 1. Declarative Objective

Local sovereign secret store — zero cloud lock-in.

## 2. Invariants

1. AES-256-GCM at rest.
2. Localhost or mesh bind only — zero public exposure.
3. Podman Quadlet lifecycle.
4. One instance per universe.
5. The Vault's durable state lives in its own private MariaDB (Rules 4 and 26): account, database and Linux user are all `vault`, uid fixed at `10610`; the database has no TCP listener and is reached only through a socket directory mounted into this unit's two containers.
6. The application password (`/apps/vault/etc/mysql/localhost/passwd`) and the master key file are `0600`/`0400`, owned by the `vault` account, mounted read-only, never in an image, a log or a dump.

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
  checks that the application account cannot become root.

---

## Cognition

> Scales and semantics: [`docs/architecture/COGNITION.md`](../../../docs/architecture/COGNITION.md) · Extends Rule 21.

- **capacity-class**: — (deterministic, no engine)
- **role**: neutral
- **depth**: D0
- **throughput**: T3
- **degraded**: refuse
- **rationale**: Encryption, storage and controlled decryption. A model must never be in the path of a secret.
