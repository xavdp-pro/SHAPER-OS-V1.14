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

9. **The durable store is the `vault` database of the unit's own MariaDB**, reached through its private socket as `vault@localhost` (`MariaDbVaultStore`, `sql/schema.sql`). The encrypted-file `VaultStore` remains as declared DEV scaffolding for local tooling; the brick selects it only with `VAULT_STORE=file` and an explicit file, never as a fallback.
10. **The schema is installed by the administrative path.** The application account holds `SELECT, INSERT, UPDATE, DELETE` on `vault.*` only and refuses to serve when `schema_meta` is absent or older than the build.
11. **The master key never enters the database, and a Vault never serves under the wrong key.** The first start of an empty database records a key-check digest (HMAC-SHA256 of a fixed label under the key); every later start compares it and refuses on mismatch. A database holding ciphertext but no identity row is refused, never adopted.
12. **The master key arrives as a protected file** (`VAULT_MASTER_KEY_FILE`, read-only, owned by the unit account); the environment variable remains for local tooling only.
13. **A storage failure is an unavailable Vault** (HTTP 503 with a typed code), never a malformed request and never an empty answer.

What this storage does not yet provide, against the Vault target contract: scoped secret delivery, complete secret mutation/read/refusal outboxes,
Logger relay of Vault evidence, journalled parent registration/revocation and
key rotation. Signed credential issuance and its local outbox are now provided;
that partial implementation is not full reference qualification. They are recorded as gaps, not implied.

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
