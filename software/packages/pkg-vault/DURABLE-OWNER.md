# Opt-in private MariaDB durable owner

The owning Vault function supplies its confined application pool, existing
scoped master key and scope identifier to `DurableVaultOwner`. No schema install,
HTTP route, deployment, credentials or file-to-SQL migration happens implicitly.
Legacy `VaultStore`/`VaultClient` remain unchanged; their encrypted-file writes
are not this protocol. Rules 4/26 private-function MariaDB remains mandatory
for runtime qualification.

- `prepareImmutable` binds exact JSON payload bytes/digest, path, scope/device,
  revision and UUID. A different operation cannot overwrite a prepared path.
- `tombstoneImmutable` requires the next resource revision, clears encrypted
  material and retains permanent operation receipts. A tombstoned path cannot
  be prepared again. Identical UUID retries are idempotent; conflicting reuse
  refuses. Only generic supplied identifiers are used; no consumer path is known.
- Transactions require `innodb_flush_log_at_trx_commit=1`, authenticate receipts
  with the scoped key, then read committed receipt/payload on a fresh checkout.
  Failed commits destroy the connection and report uncertainty. `findReceipt`
  reconciles by UUID; `verifyReceipt` returns a canonical checked receipt, not
  the caller object's identity. Consumers must compare canonical receipt fields.
- Install `durable-owner.sql` through the function's authorized administrator.
  Apply only the column/table grants declared there; never expose root to the
  application. Concurrent operations serialize under their scope epoch row.
- Secrets use existing AES-256-GCM; receipts expose no plaintext. Schema,
  runtime role/key ownership, SQL backup/restore, wall-clock/request admission
  and cross-system disclosure fences need separate qualification. A paired old
  SQL/key snapshot alone cannot detect rollback: independent restore/version
  attestation is required before enabling delivery. No handset claim is made.

Native tests use disposable Unix-socket-only MariaDB and fresh synthetic keys.
Filesystem ENOTDIR/fsync are properties of the legacy file API, not durability
mechanisms for the new SQL owner; SQL commit/rollback failures are tested here.

## Qualification boundary and replay

The opt-in native runner is `test/helpers/qualify-durable-owner.py`; its required
arguments select privately extracted MariaDB tools, Node, an external locked
`mysql2` dependency package and a private evidence directory. It refuses UID 0,
starts only its own servers with `--no-defaults --skip-networking`, uses fresh
synthetic keys/data and records source hashes, phases, dump digest and owned
process cleanup. It never installs a system service or reads an existing Vault.
The dependency is qualification-only; production accepts the owning function's
pool and adds no package dependency.

Covered on MariaDB 11.8.6 / Node 24: exact encrypted payload readback, narrow
column grants and denied DDL/admin access, scoped and immutable operation
conflicts, two concurrent workers, canonical receipt verification after JSON
reordering, authenticated scope/device/revision admission, weak commit durability
refusal, real transaction rollback, post-commit lost acknowledgement for prepare
and tombstone, and an actual client SIGKILL after uncommitted resource insertion.
A server restart and fresh dump/restore compare all three complete table digests
and exercise restored payload/receipt readers. Fault injection supplies only
failure boundaries around actual SQL operations, never simulated success.

The runner is a library-level protocol proof, **not** a qualified functional
Podman, database/key/account bootstrap, HTTP transport, owner-specific application
authorization, physical device, power-loss storage device, or independent
anti-rollback attestation. These remain release gates. SQL pool acquisition and
query deadlines are the owning pool's responsibility. A valid historical prepare
receipt proves that operation committed, not that its resource is still active;
`getPrepared` must validate the current resource before any disclosure. Legacy
file APIs and their migration/rollback remain untouched.

## In-process current-resource guard

`withPreparedGuard({path, deviceId, revision, payloadDigest}, async payload => work)`
reads and validates the exact active encrypted resource under `SELECT FOR UPDATE`
and retains that lock through the callback and commit. Missing, tombstoned,
misbound or digest-conflicting resources refuse before the callback. Callback
failure rolls back and preserves the original callback exception; owner SQL
rollback/commit uncertainty remains distinct. An independently committed peer
database action is not undone by owner rollback. The callback
must be bounded and must not recursively mutate this owner.

This primitive is strictly in-process. It exposes no arbitrary callback HTTP
endpoint and does not make callback side effects in a peer database atomic,
reversible or durable. Cross-container lease/guard transport, failure recovery
and the consuming journal's independent commit remain separate design gates.
The real SQL fixture exercises two connections in one Node process, verifies
that the tombstone promise remains unsettled while the callback is held, then
requires its completion after release. It is not an independent-process or
server lock-wait witness.
