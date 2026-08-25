# Vault-v1 — pointer (cross-project hub view)

> ⚠️ **This file is NOT the source of truth.**
> The technical reference for vault lives in **its app** (the home of a tb app is
> `app/`, never `mds/`):
>
> ### 👉 Source of truth: `/apps/vault-v1/app/mds/PLAN-V1.md`
>
> Every decision (schema, encryption, render, phases, security) is over there.
> This file only keeps the **hub view** (place of vault in the ecosystem).

---

## Place in the ecosystem (hub)

| App | Role | Content | Visible to LLM? |
|-----|------|---------|-----------------|
| **`vault-v1`** | Secrets vault | `passwd`, tokens, API keys | **No** — names only |
| **`codex-v1`** | Context & agentic infra | briefings, standards, digests | Yes — intended for this |
| **`auth-v1`** | Centralized authentication | users, groups, roles, apps, JWT | No — tokens/hash |
| **`maestro-v1`** | Execution engine | lanes, tasks, runs | Consumes render + codex |
| **`helm-v2`** | Human cockpit | chat, voice, prime | `controlScope.js` = names only |

## Key Reminders (details in the source of truth)

- **Secrets only** — agent context goes into `codex-v1`.
- **MariaDB AES-256-GCM**; `master.key` under `/apps/vault-v1/etc/encryption/`.
- **Nothing vital in `/opt`** (not backed up) — everything in tb + MariaDB.
- Agent/LLM side: secret **names**, never values.

## Related Docs

| Doc | Role |
|-----|------|
| `/apps/vault-v1/app/mds/PLAN-V1.md` | **Vault source of truth** |
| [`PLAN-CODEX-V1.md`](./PLAN-CODEX-V1.md) | Agent context / digests |
| [`UNIVERSE-V1.md`](./UNIVERSE-V1.md) | Universe model |
| [`PLAN-SYMPHONY-PILOT.md`](./PLAN-SYMPHONY-PILOT.md) | Coordinated pilot cadence |

---

*Pointer — last revision: 2026-07-24. Edit the source of truth, not this file.*
