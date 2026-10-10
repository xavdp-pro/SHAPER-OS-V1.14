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

Schema version 2 adds `unit_identities`, `unit_credentials` and `event_outbox`.
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
backoff capped at five minutes, no debt ever expired. Vault obtains its
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
closes the server and drains the batch in flight before the database closes;
an unconfirmed batch exits 1 with its debt retained. `/api/vitals` reports
`evidencePending` and `oldestPendingEvidenceAt`.

Adapted from the reference branch (14f2253) without its signed-receipt
transport, which belongs to the later Logger chain. Proof:
`test/evidence-outbox.live.mjs` on a real MariaDB whose server time zone is not
UTC — mutation evidence without the value, rollback when the outbox table is
missing, and the drain to the real Logger under the self-issued credential.
