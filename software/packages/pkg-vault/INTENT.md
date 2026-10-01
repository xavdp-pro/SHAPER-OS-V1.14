# Package: @shaper/pkg-vault

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)  
> **Manifest**: [`topology.json`](../../topology.json) → node `vault`

---

## 1. Declarative Objective

Sovereign AES-256-GCM secret engine — encrypt, persist, and inject credentials without any cloud vault.

---

## 2. Universal Invariants (Parameterized)

1. **Crypto**: AES-256-GCM at rest. Master key via `<MASTER_KEY>` or SHA-256 normalization.
2. **Zero Library Dependencies**: reusable APIs use native Node modules and accept the owning SQL pool by injection. The opt-in durable brick declares and physically supplies its locked SQL driver; no sibling checkout resolves a runtime dependency.
3. **Dual Mode**: In-process `VaultStore` or HTTP service via `createVaultServer()`.
4. **Isolation**: Zero knowledge of consuming universes. Mailbox schema is a reusable contract only.
5. **Materialized Empty State**: bootstrap persists an empty storage object even when no secrets are configured; successful initialization always leaves a storage file.
6. **Owner-only Storage**: every persistence creates or repairs the Vault storage file with Unix mode `0600`.
7. **No Documentation as a Key**: bootstrap refuses a master key or token left as an example template (`<...>`, `changeme`, …), whatever its source, and halts before creating anything — a value the operator never chose must never encrypt a vault (Rule 0J).
8. **Generic Identity**: package metadata, defaults, and reusable contracts name no client, infrastructure owner, or deployment. Concrete provenance belongs in a declared instance and its evidence, outside this package.
9. <a id="durable-conditional-owner"></a>**Opt-in Durable Conditional Owner**: the Vault functional unit's private MariaDB may hold encrypted immutable resources, operation identities, authenticated durable receipts and irreversible tombstones. A successful receipt follows an InnoDB durable commit and independent readback; commit uncertainty refuses success and is reconciled by operation identity. Legacy encrypted-file APIs remain unchanged and do not provide this guarantee. Schema installation, scoped key custody, confined function credentials, runtime migration, backup/restore attestation and activation remain explicit owning responsibilities.

---

### Illustrative Example (Non-Binding / Demonstration Only)

* **Brick port**: `8610`
* **Storage**: `/data/<universe-slug>/vault/vault.enc`
