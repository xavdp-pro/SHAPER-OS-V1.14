# Package: @shaper/pkg-vault

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)  
> **Manifest**: [`topology.json`](../../topology.json) → node `vault`

---

## 1. Declarative Objective

Sovereign AES-256-GCM secret engine — encrypt, persist, and inject credentials without any cloud vault.

---

## 2. Universal Invariants (Parameterized)

1. **Crypto**: AES-256-GCM at rest. Master key via `<MASTER_KEY>` or SHA-256 normalization.
2. **One declared dependency**: native `node:crypto`, `node:fs`, `node:http`, plus `@shaper/pkg-db` for private MariaDB and `@shaper/pkg-auth`
   for signed unit identity; the driver is pinned in pkg-db, nowhere else.
3. **Dual Mode**: In-process store or HTTP service via `createVaultServer()`; the server awaits either store kind.
4. **Isolation**: Zero knowledge of consuming universes. Mailbox schema is a reusable contract only.
5. **Materialized Empty State**: bootstrap persists an empty storage object even when no secrets are configured; successful initialization always leaves a storage file.
6. **Owner-only Storage**: every persistence creates or repairs the Vault storage file with Unix mode `0600`.
7. **No Documentation as a Key**: bootstrap refuses a master key or token left as an example template (`<...>`, `changeme`, …), whatever its source, and halts before creating anything — a value the operator never chose must never encrypt a vault (Rule 0J).
8. **Generic Identity**: package metadata, defaults, and reusable contracts name no client, infrastructure owner, or deployment. Concrete provenance belongs in a declared instance and its evidence, outside this package.

<a id="private-mariadb"></a>
## 3. Storage: the unit's private MariaDB (Rules 4 and 26)

9. **The durable store is the `vault` database of the unit's own MariaDB**, reached through its private socket as `vault@localhost` (`MariaDbVaultStore`, `sql/schema.sql`). The encrypted-file `VaultStore` remains as declared DEV scaffolding for local tooling; the brick selects it only with `VAULT_STORE=file` and an explicit file, never as a fallback, and the entrypoint refuses it (`DEV_STORE_REFUSED`) when `SHAPER_QUALIFICATION` or a non-development `SHAPER_RUNTIME_MODE` is set. The scripts that drive `VaultStore` directly (`software/scripts/*vault*.mjs`) are file tooling outside this guard.
10. **The schema is installed by the administrative path.** The application account holds `SELECT, INSERT, UPDATE, DELETE` on `vault.*` only and refuses to serve when `schema_meta` is absent or older than the build.
11. **The master key never enters the database, and a Vault never serves under the wrong key.** The first start of an empty database records a key-check digest (HMAC-SHA256 of a fixed label under the key); every later start compares it and refuses on mismatch. A database holding ciphertext but no identity row is refused, never adopted.
12. **The master key arrives as a protected file** (`VAULT_MASTER_KEY_FILE`, read-only, owned by the unit account); the environment variable remains for local tooling only.
13. **A storage failure is an unavailable Vault** (HTTP 503 with a typed code), never a malformed request and never an empty answer.

What this storage does not yet provide, against the Vault target contract: scoped secret delivery, evidence of secret reads and of refused requests,
journalled parent registration/revocation and key rotation. Secret mutations
and credential issuance commit their evidence with the change, and the relay
delivers it to Logger ([§ evidence relay](#evidence-relay)); that is not full
reference qualification. The gaps are recorded, not implied.

---

### Illustrative Example (Non-Binding / Demonstration Only)

* **Brick port**: `8610`
* **Storage**: `vault` database in the unit's private MariaDB, socket `/apps/vault/nosav/run/mysqld/mysqld.sock` on the universe side

## Signed runtime identity issuance

Schema version 2 adds `unit_identities`, `unit_credentials` and `event_outbox`;
version 3 adds `recovery_points` ([pkg-db retention](../pkg-db/INTENT.md#retention)).
An hourly cleanup removes credential rows expired for more than 24 hours
(`pruneExpiredCredentials`) — never `unit_identities`, never a row marked
revoked — and delivered evidence as pkg-db declares it. Vault's relay issues
itself a logger credential only when its outbox owes a row.
The administrative parent registers an incarnation, exact audience-to-scope
grants, bootstrap digest and bounded bootstrap expiry. Vault authenticates
the bootstrap request against that row and commits credential metadata and
non-secret issuance evidence together before returning the token. Signed tokens,
bootstrap values and signing keys do not enter MariaDB or evidence.

The signing seed is HKDF-SHA256 domain-separated from the matching master key
and universe identity; Ed25519 key encoding follows RFC 8410. Restoring the same
key and universe preserves the signing identity; a different key or universe
produces another public key. Parent provisioning pins that public key in consumers.

`POST /api/identity/issue` accepts only unit, incarnation and audience; the
Bearer bootstrap grants no secret access. `POST /api/identity/check` verifies a
credential's signature, expiry, current incarnation, epoch, grant and revocation
state. Registered credential metadata lives in the same private Vault database.
MariaDB or identity verification failures cannot acknowledge issuance.

The MariaDB entrypoint requires `SHAPER_UNIVERSE_ID`. Runtime credential TTL is
`UNIT_CREDENTIAL_TTL_SECONDS` (default 300, allowed 1–300). Generic secret APIs
in identity mode require the separately configured administrative credential;
an empty setting never opens that surface. Scoped unit secret-delivery policy
and removal of the legacy static administrative surface remain reference work.

<a id="evidence-relay"></a>
## Evidence relay

Every state change of the MariaDB Vault commits its evidence to the unit's
`event_outbox` in the same transaction, or the change does not happen:

| Change | Evidence | Data |
| :--- | :--- | :--- |
| `setSecret` (create or overwrite) | `SECRET_STORED` | `secretRef`, `created` |
| `deleteSecret` that removed a row | `SECRET_DELETED` | `secretRef` |
| credential issuance | `UNIT_CREDENTIAL_ISSUED` | `unit`, `incarnation`, `audience`, `epoch` |

`secretRef` is the secret's key — a public reference — or `sha256:<hex>` of it
when the key itself would be refused by Logger's public-event boundary. No
secret value, ciphertext, credential, bootstrap value or key ever enters the
outbox. A failed evidence insert rolls the mutation back and answers 503.

`evidence-runtime.js` delivers the outbox after the server listens: one lane
(pkg-db `createEvidenceRelay`), the strict `deliverLog` receipt check (the
claim and event digests must match), the same source event id on every retry,
backoff capped at 256 seconds, no lock held while Logger answers, no debt
ever expired. Vault obtains its
logger-audience credential from itself, in-process, through exactly the path
other units use over HTTP: its own `UNIT_BOOTSTRAP_TOKEN_FILE`, its
`SHAPER_UNIT_INCARNATION`, and a grant `{"logger":["logger:ingest"]}` the parent
registers for unit `vault` after the Vault identity is born. Until that
registration (or while Logger is down), the relay reports once and keeps the
debt; it never opens authority to drain it. Issuance evidence for the relay's
own credential lands in the same outbox (about one row per credential lifetime).

On MariaDB the entrypoint therefore requires `LOGGER_URL` (plain http(s), no
credentials, query or fragment), `SHAPER_UNIT_INCARNATION` and
`UNIT_BOOTSTRAP_TOKEN_FILE` (0600, owned by the unit) in addition to
`VAULT_MASTER_KEY_FILE` and `SHAPER_UNIVERSE_ID`, and refuses to start without
them. Optional: `VAULT_RELAY_INTERVAL_MS` (2000), `VAULT_RELAY_BATCH` (10),
`VAULT_RELAY_TIMEOUT_MS` (3000), `VAULT_SHUTDOWN_TIMEOUT_MS` (15000). Shutdown
closes the server (event streams and idle connections ended after a 5-second
grace) and lets the relay finish its send in flight, both before the database
closes; an unconfirmed send exits 1 with its debt retained. Evidence fields
Logger would refuse are reduced to a digest before they are committed. `/api/vitals` reports
`evidencePending` and `oldestPendingEvidenceAt`.

Adapted from the reference branch (14f2253) without its signed-receipt
transport, which belongs to the later Logger chain. Proof:
`test/evidence-outbox.live.mjs` on a real MariaDB whose server time zone is not
UTC — mutation evidence without the value, rollback when the outbox table is
missing, and the drain to the real Logger under the self-issued credential.

<a id="access-evidence"></a>
## Evidence of reads and refusals (DECISIONS-20261011 §H)

`access-evidence.js`, wired by the entrypoint on MariaDB:

* **A read leaves its proof before the secret leaves.** `GET /api/secret/<key>`
  reads and decrypts the row, commits `SECRET_READ` (action `secret.read`,
  result `returned` or `not_found`, the requester `vault:admin`, an opaque
  resource id, the universe, the request id, the instant) to the outbox, and
  only then answers — `evidence: "pending"`, `Cache-Control: no-store`,
  `X-Request-Id`. The outbox unwritable: `503`, no value. Logger down but the
  outbox durable: the read succeeds and its evidence waits for the relay.
  `GET /api/secrets` commits `SECRET_KEYS_LISTED` (a count, no key).
* **The resource id is opaque**: `res-` and an HMAC of the normalized key under
  a key derived from the master key — stable for one Vault, recomputable by an
  operator who holds the master key, revealing no path to anyone else.
* **A refusal carries a typed reason**, the requester's identity when it proved
  one, the universe, its incarnation, the action, the resource, the result,
  the instant and the request id — never a secret, a token, a body or a path.
  Issuance refusals answer one code to the caller and keep their reason for
  evidence: `IDENTITY_UNKNOWN`, `BOOTSTRAP_MISMATCH` (unauthenticated);
  `IDENTITY_REVOKED`, `INCARNATION_NOT_CURRENT`, `BOOTSTRAP_EXPIRED`,
  `AUDIENCE_NOT_GRANTED` (the bootstrap matched: authenticated). A check of a
  validly signed credential Vault no longer holds current is
  `CREDENTIAL_NOT_CURRENT` (authenticated); a malformed, forged or expired one
  keeps its verification code (unauthenticated). Admin refusals are
  `VAULT_TOKEN_MISSING`, `VAULT_TOKEN_INVALID`, `VAULT_ADMIN_DISABLED`.
* **Bounded.** An authenticated refusal is committed individually
  (`VAULT_REQUEST_REFUSED`) the first time in a five-minute window and counted
  after; an unauthenticated one is only counted. Counts are committed each
  minute as aggregates (`VAULT_REFUSALS_AGGREGATED`, at most 64 keys, the rest
  folded into `REFUSALS_OVERFLOW`). A refusal that repeats — Vault's own relay
  presenting a credential revoked under it, which makes Logger's check refuse
  again on each delivery — costs at most two rows a window, never one per
  attempt: no relay-induced loop. Counts not yet committed are lost with the
  process (at most one minute). A successful identity check is not recorded.

<a id="bootstrap-renewal"></a>
## Bootstrap renewal (DECISIONS-20261011 §D, SOL decision L)

`unit-registration.js renew --expect <slug>… --record <file>… [--renewal-id
<uuid>]` turns the composition's identities (`--expect`, so an identity whose
record disappeared is still checked) and the parent's records (owner-only
JSON named after their unit: unit, incarnation, epoch, grants, bootstrap
digest) into one compound statement root applies through the mariadb client.
A record that is not a private regular file, not JSON, or not of the unit its
name says is an input that cannot be verified: the command fails and nothing
is built.

In one transaction, with an exit handler that rolls everything back on any
SQL error:

* the universe must be known to this Vault (at least one identity row);
  otherwise nothing is checked, `UNIT_BOOTSTRAP_RENEWAL_HALTED` (level
  `ERROR`, reason `universe-unknown`) is committed and the answer is `halted`;
* each recorded identity's row is locked (`FOR UPDATE`) and classified —
  `due` (consistent, expiring within 7 days), `current`, `inconsistent`
  (incarnation, epoch, grants or digest differ; the detail names which),
  `revoked`, `expired`, `missing` (`no-record`: expected, no record;
  `no-row`: no row for this unit in this universe), `unexpected` (a record of
  a unit outside the composition);
* each `due` bootstrap is extended by 30 days **from its current expiry**,
  guarded on every recorded field and on the expiry just read (an extension
  that does not touch exactly its row signals and rolls back), with its
  `UNIT_BOOTSTRAP_RENEWED` outbox row (event id `<run>:<n>`, correlationId the
  run id);
* when any identity is blocked, `UNIT_BOOTSTRAP_RENEWAL_PARTIAL` (level
  `ERROR`, event id the run id, every identity's state, detail and expiry) is
  committed with the extensions. A blocked identity is left exactly as it is
  and never holds back a consistent one.

The answer is one row per identity, `unit state expiry detail` (`renewed`,
`current` or the blocked state), then `* complete|partial|halted renewed
blocked`. `readback --renewal-id <uuid>` prints the query that re-reads what
one run committed from the outbox — its `UNIT_BOOTSTRAP_RENEWED` rows and its
alert, then a `# read` row proving the query ran — for the parent to settle a
lost acknowledgement before anything is repeated. Neither ever inserts an
identity, writes `incarnation`, `epoch`, `grants` or `revoked`, or sees a
bootstrap. Proof: `test/bootstrap-renewal.live.mjs` (applied by the real
client as root against a throwaway MariaDB; mixed run, second run, outbox
failures, readback, unknown universe; the events receipted by the real
Logger).

<a id="parent-registration"></a>
## Parent registration

Units hold Vault-signed credentials only after the parent — the universe's
construction path, which holds the master key and administers Vault's MariaDB
as root — has done two things. `unit-registration.js` performs both, as a
library and a command:

* `public-key` prints Vault's Ed25519 signing public key for the universe,
  derived from the master key (`VAULT_MASTER_KEY_FILE`, private) and
  `SHAPER_UNIVERSE_ID`. The parent writes it as each consumer's
  `UNIT_AUTH_PUBLIC_KEY_FILE` (Logger, Queue, Maestro): the pin comes from the
  parent's own derivation, never from what a running Vault would hand out.
* `register --unit <slug> --incarnation <id> --grant <audience>=<scope>…
  --bootstrap-file <path> [--ttl-seconds <n>]` writes a fresh 64-hex bootstrap
  token to a new 0600 file (it never overwrites one) and prints the one
  statement root applies to Vault's database. The statement carries the
  token's SHA-256, never the token. Re-registering the same live incarnation
  redelivers a bootstrap and keeps the epoch; a new incarnation, or the
  re-registration of a revoked one, bumps the epoch, so credentials issued
  before stop being current. The bootstrap
  expiry (default 30 days, 60 s to 366 days) bounds how long a unit can renew:
  the parent renews it before it passes ([bootstrap renewal](#bootstrap-renewal)).
* `renew --expect <slug>… --record <file>…` and `readback --renewal-id <uuid>` — see [bootstrap renewal](#bootstrap-renewal).

A base composition registers each *recreated* unit of `vault`, `queue` and
`maestro` under a new random incarnation `<slug>-<16 hex>`, after Vault's
identity is born, with its declared grants — `logger=logger:ingest` for each,
and Maestro's `queue=queue:enqueue`, `queue=queue:read`; a kept unit keeps its
incarnation (DECISIONS-20261011 §B). A reader of Logger's events needs its own
grant (`logger:read:own`, or `logger:observe` for pods and vitals). The file
must be owned by the unit's account when the unit starts. Unit names and
audiences follow one grammar that accepts hyphens (`brick-voice`), with no
alias.
