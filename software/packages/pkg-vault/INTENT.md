# Package: @shaper/pkg-vault

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)  
> **Manifest**: [`topology.json`](../../topology.json) → node `vault`

---

## 1. Declarative Objective

Sovereign AES-256-GCM secret engine — encrypt, persist, and inject credentials without any cloud vault.

---

## 2. Universal Invariants (Parameterized)

1. **Crypto**: AES-256-GCM at rest. Master key via `<MASTER_KEY>` or SHA-256 normalization.
2. **Zero Dependencies**: Native `node:crypto`, `node:fs`, `node:http` only.
3. **Dual Mode**: In-process `VaultStore` or HTTP service via `createVaultServer()`.
4. **Isolation**: Zero knowledge of consuming universes. Mailbox schema is a reusable contract only.
5. **Materialized Empty State**: bootstrap persists an empty storage object even when no secrets are configured; successful initialization always leaves a storage file.
6. **Owner-only Storage**: every persistence creates or repairs the Vault storage file with Unix mode `0600`.

---

### Illustrative Example (Non-Binding / Demonstration Only)

* **Dev port**: `8510` | **Brick port**: `8443`
* **Storage**: `/data/<universe-slug>/vault/vault.enc`
