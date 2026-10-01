# Brick: Vault

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)

## 1. Declarative Objective

Local sovereign secret store — zero cloud lock-in.

## 2. Invariants

1. AES-256-GCM at rest.
2. Localhost or mesh bind only — zero public exposure.
3. Podman Quadlet lifecycle.
4. One instance per universe.
5. The persisted Vault file is owner-readable and owner-writable only (`0600`).

## Opt-in private MariaDB durable owner

The separate `Containerfile.durable` variant belongs to this same Vault function;
it never replaces the legacy Containerfile, Quadlet, file API or running state.
The functional Linux account, MariaDB account and database all use `vault`.
The application reads its owner-only password from
`/apps/vault/etc/mysql/localhost/passwd`. MariaDB has no TCP listener; root
administration uses only its local socket. The five authenticated POST methods
bind payloads and receipts to the explicitly selected universe and scoped key.
The application refuses unsafe files, principals, schema or inherited privileges.

Existing declared directories are validated, never repaired. Unknown populated
SQL directories require an explicit migration/restore procedure; bootstrap never
adopts them. A plain source-format/function/scope marker is metadata only, not a
second secret store or a substitute for the SQL owner. A data-bearing transition
still requires the owning snapshot and verified restore before activation.

See [the scoped runtime contract](DURABLE-RUNTIME.md). No live activation or
cross-container distributed guard is implied.

## 3. What experience corrected

* **Empty is a valid persisted state.** A zero-secret bootstrap must create the
  storage file containing an empty object. Reporting success without a file
  makes every cold boot repeat bootstrap and makes “empty” indistinguishable
  from “never initialized”.
* **Encryption does not replace filesystem isolation.** Clean-sheet deployment
  exposed a default `0644` file. Every persistence now creates or repairs the
  Vault storage file to `0600`.

---

## Cognition

> Scales and semantics: [`docs/architecture/COGNITION.md`](../../../docs/architecture/COGNITION.md) · Extends Rule 21.

- **capacity-class**: — (deterministic, no engine)
- **role**: neutral
- **depth**: D0
- **throughput**: T3
- **degraded**: refuse
- **rationale**: Encryption, storage and controlled decryption. A model must never be in the path of a secret.
