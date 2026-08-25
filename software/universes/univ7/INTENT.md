# Universe: univ7 — Overnight Ops Watchdog (Artisan BTP)

> **Intent Classification**: SPECIFIC INTENT (Universe: univ7)

## 1. Declarative Objective

Demonstrate minimal vital socle: vault stores secrets, logger audits beats, maestro schedules agy agent for overnight construction quote monitoring.

## 2. Invariants

1. AGY API key stored in vault — never in git.
2. Maestro beats wake `bridge-agy` on cadence.
3. Every beat logged as JSONL.
4. PRA from scratch in `/tmp/univ7-pra-*` then destroyed.

## 3. Fractal layout (what lives here vs SHAPER-OS root)

| Layer | Path | Contains |
| :--- | :--- | :--- |
| **Generic law** | `SHAPER-OS/bricks/brick-*` | INTENT + Containerfile + image |
| **Generic code** | `SHAPER-OS/packages/*` | `@shaper/maestro`, `@shaper/agent`, … |
| **Universe manifest** | `universes/univ7/manifest.json` | Which bricks, their intents, how to specialize |
| **Universe params** | `tasks/`, `context/`, `bricks/*/instance.json` | Concrete values for this test |
| **Pre-vault secrets** | `resources/vault-resources.local.json` | plaintext → bootstrap once |

**Never copy** a generic brick Containerfile into univ7. Read `manifest.json` first — it points to generic intents and specialization files.

## 4. Document map

| File | Who reads it | Purpose |
| :--- | :--- | :--- |
| `INTENT.md` | Human + all agents | Law — objective + invariants |
| `manifest.json` | Scripts, deploy agent | Brick graph + specialize paths |
| `AGENT-DEPLOY.md` | Deploy agent only | What to build, test, wire — autonomous capabilities |
| `context/AGENT-CONTEXT.md` | Runtime AI (agy) | Business rules at beat/inject time |

**Deploy agent entrypoint**: `INTENT.md` → `manifest.json` → `AGENT-DEPLOY.md`
