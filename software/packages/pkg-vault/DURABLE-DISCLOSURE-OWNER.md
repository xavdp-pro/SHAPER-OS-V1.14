# Current disclosure owner — unmounted candidate

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)

- A read is a new immutable operation and guard, distinct from its preparing
  activation. Exact resource/revision/digest and neutral current authority digest
  bind a pinned consumer/incarnation/key and safe sequence. Historical activation
  settlement is provenance, never current disclosure authority.
- `CurrentDisclosureVaultOwner` retains activation APIs and adds finite
  `beginDisclosure`, `inspectDisclosure`, `finishDisclosure`. Begin requires signed
  admission and a live resource. The pinned peer must explicitly admit `read`;
  mandatory freshness is rechecked after awaited readback commit before plaintext
  return. No deployed freshness witness is supplied.
- The common permanent fence excludes owner mutations while HELD. Pending
  tombstone UUID and deny-new remain durable. Initial begin claims payload once;
  duplicate/inspect/recovery responses are metadata only. Reply or commit loss
  consumes the claim. Deadline, death or matching restored databases never release it.
- Historical signed writer closure seals OUTPUT_ENDED or NO_OUTPUT_ENDED with
  writerFenced=true and complete/partial/uncertain/none disposition. This refers
  to local response finish or positively closed stream with future writers
  fenced, never handset receipt. The owner verifies pinned signature, not actual
  response completion or initiating account activity; consumer proof is essential.
- Consumer order: authenticated preflight/durable read intent; owner begin outside
  consumer SQL locks; fresh current authority/source locks and verifier/path
  recheck through bounded output; fence future writers and release local locks;
  durably persist/sign closure; owner finish outside locks. Expiry stops local
  output, never expires an owner guard. Uncertain/dead writers stay quarantined.
- Schema/grants are owning and additive. Exact known three/five-table shapes
  upgrade to six preserving key/ciphertext/receipt bytes. Startup admin metadata
  refuses unknown tables/columns before migration; confined app readiness checks
  six-table keys/engines and excess grants. Ungranted foreign tables are invisible
  to the app and require the admin preflight. The authenticated loopback HTTP
  adapter can route disclosure calls when its injected owner advertises the
  disclosure protocol. The installed runtime still constructs the base owner,
  so it does not mount those calls.

## Typed APIs

The binding has exactly the activation binding's thirteen field names with
`purpose:current-disclosure`, `operation:read`, new `operationId`, plus
`activationOperationId` and `authorityBindingDigest`. Read UUID differs from
activation UUID; `guardId` identifies disclosure. Consumer allocates permanent
safe `ackSequence`; owner epoch lock serializes cross-table identity checks.
Preparing provenance does not certify a consumer activation COMMITTED or current
account authority.

`beginDisclosure({binding,peerAdmission})` admission body has schema
`shaper.peer-disclosure-admission.v1`, consumerId, consumerIncarnation, ownerEpoch,
operationId, guardId, bindingDigest, ackSequence, keyId and signature. Ed25519
signs the canonical sorted body without signature. Only the creating invocation
may return `{receipt,payload}`; any replay returns `{receipt}` even after lost reply.

`inspectDisclosure({disclosureId,bindingDigest,consumerId,consumerIncarnation,
ownerEpoch,peerAdmission})` returns metadata only.
`finishDisclosure` takes that selection with peerClosure. Its signed body uses
schema `shaper.peer-disclosure-closure.v1`, the same remaining admission fields,
plus decision, outputDisposition and writerFenced. NO_OUTPUT_ENDED requires none;
OUTPUT_ENDED permits complete/partial/uncertain. Changed terminal closure refuses.

Receipt `shaper.vault-disclosure-receipt.v1`: disclosureId, bindingDigest,
universeId, ownerEpoch, durableSequence, state, payloadClaimed, closureDigest and
owner authentication. It proves neither tenant jurisdiction nor client receipt.
Pinned consumer trust must remain available for historical cleanup; retiring it
without actual old-writer fencing can intentionally leave quarantine.

## Storage and proof boundary

New `vault_owner_disclosures` stores immutable binding/admission/claim and signed
closure, never plaintext. App SELECT/INSERT + UPDATE(state,closure_json,
closure_digest) only; no binding/claim UPDATE, DELETE, DDL or admin grant.
Epoch/resource/fence order is common with activation and mutations. Legacy getters
cannot read managed resources. Every mutable guarded path must use this subclass
when admitting disclosure identities; mixed owner configurations are unqualified.

The opt-in native helper uses real owning AES, confined vault SQL account,
private Unix-socket MariaDB and an ephemeral authenticated loopback HTTP server.
Historical three-table data are seeded by actual
owning encryption/SQL, not present-source execution before migration. It tests
once-only payload, signature/identity/grant refusal, pending revoke, lost ACK,
stopped/killed child, exact ciphertext preservation and six-table restart/fresh
restore. Freshness/fault adapters are test-only. No independent restore witness,
HTTP partition, physical output, consumer account/source fencing, functional
Podman startup or installed provisioning proof is claimed.

The transport unit test proves bounded authenticated request/response carriage
and refusal on a base owner. The native helper additionally exercises the
disclosure calls through HTTP against a real SQL owner, with synthetic data.
Neither proves a cross-container transaction or authorizes a runtime cutover. A real cutover
still needs independently witnessed freshness, pinned peer registration,
confined network access, and the consuming VOX output fence.
