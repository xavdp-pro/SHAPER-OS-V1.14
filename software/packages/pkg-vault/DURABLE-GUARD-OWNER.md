# Unmounted activation guard owner

This source candidate extends the existing Vault unit's private MariaDB owner.
Its authenticated loopback HTTP adapter can route guard calls only for an
injected owner advertising the guard protocol. The installed runtime still
constructs the base owner, changes no live key custody and supplies no
independent freshness witness. No cross-container release claim is made.
Legacy encrypted-file Vault APIs remain untouched.

## Required dependencies and methods

`GuardedDurableVaultOwner({pool, masterKey, universeId, admitFreshness,
resolveConsumer})` requires both explicit synchronous admission interfaces.
Freshness must return exactly true for the scoped owner epoch/consumer
incarnation; unavailable, throwing or asynchronous results refuse. The trusted
consumer resolver supplies its pinned Ed25519 public key, key identifier, scope,
consumer/incarnation and permitted issue/rotate operations. RPC-supplied keys
are never accepted. These injectable interfaces are test-admission boundaries,
not an implementation of independent restore or trusted registration services.

- `acquireGuard(binding)` accepts exact primitive fields: universeId, ownerEpoch,
  consumerId, consumerIncarnation, operationId, guardId, ackSequence, path,
  deviceId, revision, payloadDigest, purpose=`activation`, operation=issue/rotate.
  The same operation must already have prepared the exact immutable resource.
  One permanent guard per operation, unique consumer acknowledgement sequence,
  immutable binding digest and exact resource fence commit together. A fresh
  SQL checkout supplies payload only for the exact held, non-denied binding.
  Terminal retry is status-only. No time-based expiry exists.
- `inspectGuard({guardId,bindingDigest,consumerId,consumerIncarnation,ownerEpoch})`
  returns deterministic authenticated acquisition/current receipts, no payload.
- `settleGuard({...inspection,peerAcknowledgement})` requires the canonical signed
  `shaper.peer-guard-acknowledgement.v1` envelope: consumerId,
  consumerIncarnation, ownerEpoch, operationId, guardId, bindingDigest,
  decision=COMMITTED/ABORTED, ackSequence, keyId and standard canonical base64
  Ed25519 signature. The signature covers sorted primitive fields excluding
  signature. Trusted key and admission are rechecked before local commit.
  Permanent terminal state/acknowledgement and clearing the exact held fence
  are one SQL transaction; fresh readback follows. Conflicting terminal replay
  refuses. Lost owner commit acknowledgement requires inspect/reconciliation.

Owner receipts use schema `shaper.vault-guard-receipt.v1`, scope, guard identity,
binding digest, owner epoch, durable guard sequence, state and terminal
acknowledgement digest, authenticated with the existing scoped owner key.
They are derived deterministically from immutable binding/sequence and the
single terminal transition, avoiding an extra writable receipt column.

A peer signature authenticates its issuer, not SQL durability by itself.
Only a conforming admitted peer may issue it after fresh durable readback of
its permanent COMMITTED or irreversible ABORTED ledger. A compromised peer
signer is outside the crash/partition fault model. This package neither reads
peer SQL nor implements that consuming ledger.

## Shared fences and safe mutation

The existing durable owner also queries the new fence for mutations, secret
reads and local callbacks. Managed resources cannot be read or mutated by an
old base-owner instance. The guarded owner refuses generic getPrepared/local
callback APIs entirely. Preparation's private readback compares exact payload
bytes internally and returns only the historical prepare receipt.

Guarded tombstone validates the existing resource CAS and persists deny-new
intent bound to exact tombstone UUID/revision/request digest. If a guard remains
held, it commits that intent and reports `vault_owner_guard_pending`, never a
successful tombstone. A conflicting UUID/action/path cannot steal the intent.
After checked terminal settlement, the exact tombstone retry may complete.
Deny intent never clears; managed never returns to unmanaged. Process death,
restart, absence of a peer or an RPC deadline never releases held guards.

Lock order is scope epoch, resource, fence and guard. No connection or SQL
transaction spans a remote RPC. Admission callbacks must be local, synchronous
and bounded; they must not acquire consumer SQL or recurse into the owner.
A restored matching key/SQL pair cannot prove freshness on its own.

## Schema, grants and cutover gate

Install the additive five-table schema via the owning administrator before
admitting this source. The two new tables require SELECT/INSERT and only:

- fences: UPDATE(managed,held_guard_id,deny_new,deny_operation_id,deny_revision,
  deny_request_digest);
- guards: UPDATE(state,terminal_ack_json,terminal_ack_digest).

Binding, operation/guard identities, peer sequence and acquisition sequence have
no UPDATE grant. No DELETE, DDL, peer-database account or administrator access
is given to the application. Terminal transition immutability is enforced by
the trusted owner algorithm; these transition-column grants are not protection
against arbitrary malicious SQL executed with the application credential.
Missing tables/grants refuse; there is no legacy fallback. The additive bootstrap follow-up installs the two new tables and narrowly
adds their declared grants to a known owned three-table database. Cold readiness
checks all five tables, required columns/keys, InnoDB and exact privileges.
Excess inherited grants are refused rather than removed. This compatibility
step mounts only the historical five HTTP methods because the runtime supplies
the base owner. The optional adapter routes are not an installed guard, and a
freshness witness remains absent. Installed cutover and advanced guard
activation still require separate owning qualification.

No initial handset disclosure, cross-container current-state acknowledgement,
HTTP mounting, peer permanent ledger, attempt-unique consuming path migration,
production trusted key registration or independent freshness witness is
implemented here. Initial disclosure needs confirmed settlement PLUS its own
current delivery fence; uncertain replay never rediscloses a secret.

## Native proof boundary

The opt-in `test/helpers/qualify-guard-owner.py` starts only disposable Unix-socket
MariaDB engines as a nonroot user, with synthetic keys/data and narrow app grants.
It records exact source hashes, real SQL state digests through engine restart
and fresh dump/restore, and owned process cleanup. The paused consumer is an
independent synthetic Node process, not a real peer private SQL coordinator.
No HTTP partition or consumer commit/abort race is claimed. Injected failure
occurs after actual owner SQL commit, never simulated successful persistence.
The freshness callback is deliberately test-only; restored state equality does
not qualify rollback admission or cross-system release.
