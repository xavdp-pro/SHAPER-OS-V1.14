
# Universe — Isolation Model & Role of Vault

**Type:** conceptual architecture — **nothing coded** for vault/universe to date.
**Date:** 2026-07-24
**Decision:** each **universe** is an autonomous **echo-system**; the **master vault**
of the universe replaces **freetier** for secrets **at the scale of this universe**.

See also: [`PLAN-VAULT-V1.md`](./PLAN-VAULT-V1.md) · [`PLAN-CODEX-V1.md`](./PLAN-CODEX-V1.md) ·
[`PLAN-SYMPHONY-PILOT.md`](./PLAN-SYMPHONY-PILOT.md) · freetier-v1 `/apps/freetier-v1/app`.

---

## 1. Current State — Is Vault Coded?

| Component | State July 2026 |
|-----------|-----------------|
| **`vault-v1` app** | ✅ tb noweb space; ❌ code — pilot `/opt/vault-pilot/` to come |
| **`codex-v1` app** | ❌ Not coded — plan + pilot file slices |
| **`maestro-v1`** | ✅ In prod (orchestration, stream, scheduler) |
| **`helm-v2`** | ✅ In prod (human cockpit) |
| **`freetier-v1`** | ✅ In prod — **global** free tier API key catalog |

**Conclusion:** vault = **design only**. Secrets still live in
`passwd`, `.env`, `/opt/bridge/*/.env` and freetier-v1.

---

## 2. What is an Universe?

An **universe** (`universe`) is an **isolation boundary**: an echo-system
grouping everything that belongs to the same operational perimeter.

```
┌─────────────────────────────────────────────────────────────┐
│  UNIVERSE "gbs-symphonie"                                   │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ vault    │  │ codex    │  │ maestro  │  │ helm-v2  │   │
│  │ (master) │  │ (context)│  │ (exec)   │  │ (human)  │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
│       │             │             │             │          │
│       └─────────────┴──────┬──────┴─────────────┘          │
│                            │                                │
│  ┌─────────────────────────┼─────────────────────────────┐  │
│  │  Resources               │                             │  │
│  │  • agents (subs/bridges) │  • tb apps (helm, maestro…) │  │
│  │  • machines / nodes      │  • MariaDB (scopes)         │  │
│  │  • workspaces            │  • containers (future)      │  │
│  └─────────────────────────┴─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Properties of an Universe

| Property | Description |
|----------|-------------|
| **Isolation** | Secrets, context, runs, and resources of one universe do not leak to another without explicit export |
| **Master Vault** | One secrets authority per universe — single source to render to files / container env |
| **Local Codex** | Agent context catalog (briefings, blueprints) scoped to the universe |
| **Maestro Scope** | Lanes, tasks, subs attached to the universe |
| **Echo** | Each universe is a **replicable subsystem** (h1 pilot → bs1 deploy) |

### Examples of Universes (Targets)

| Slug | Description | Pilot Host |
|------|-------------|------------|
| `gbs-symphonie` | Agentic infra helm + maestro + bridges | gbs-h1 → bs1 |
| `wordavo` | Sciento educational apps | zerux / sciento |
| `freetier-legacy` | Transitory — current global catalog | freetier-v1 |

---

## 3. Master Vault — The Universe Connector

The **master vault** of an universe is the **point of truth** linking the other
bricks **without mixing them**:

```
                    ┌─────────────────┐
                    │  MASTER VAULT   │
                    │  (per universe) │
                    └────────┬────────┘
         secrets             │            names only
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
         bridges         tb apps      containers
         (.env render)   (passwd)     (env inject)
              │             │             │
              └─────────────┼─────────────┘
                            │
              codex ← secret_ref (never the value)
              maestro ← render before run
              helm ← controlScope perimeter
```

| Vault Does | Vault Does NOT |
|------------|----------------|
| Store passwords, tokens, API keys | Store briefings / LLM context → **codex** |
| `vault render` → files or container env | Orchestrate tasks → **maestro** |
| Named references for agents (`CLOUDFLARE_API_TOKEN`) | Human chat → **helm** |
| Audit who rendered what, when | Global free tier catalog → **freetier** (transitory) |

---

## 4. Freetier → Vault: Replacement at Universe Level

### Today (freetier-v1)

- **Global** multi-account email catalog (GBS, PRO, MUSICA, Theta…)
- Health checks, models, key export
- **Outside** the scope of a single infra deployment
- Useful to **discover** and **test** free providers

### Tomorrow (per Universe)

| Before (freetier) | After (universe vault) |
|-------------------|------------------------|
| Global OpenRouter key "Theta" | `OPENROUTER_API_KEY` in vault `gbs-symphonie` |
| Ollama key "PRO" | `OLLAMA_API_KEY` scoped universe |
| Manual export to bridge `.env` | `vault render bridge-claude` automatic |
| Catalog UI providers | Vault UI: secrets of **this** universe only |

### Planned Migration (No Big-bang)

```
Phase A — Spot import (manual, pilot)
  freetier export (email/account) → vault set global <SECRET_NAME>
  One key, one universe, one test render

Phase B — freetier remains "discovery" catalog
  New free tier accounts → still registered in freetier
  Keys **validated for infra prod** → copied into universe vault

Phase C — freetier slimmed down (optional, distant)
  freetier = signup directory + sandbox health
  vault = sole source for apps/bridges/maestro in prod
```

> **Rule:** we do not import all of freetier at once. One validated key per
> universe, via documented maestro task.

### Mapping freetier → vault (example `gbs-symphonie`)

| Vault Secret | Current freetier Origin | Usage |
|--------------|-------------------------|-------|
| `OPENROUTER_API_KEY` | Theta OpenRouter #32 or future GBS key | Kimi K3, DeepSeek, GLM |
| `OLLAMA_API_KEY` | PRO Ollama #28 | minimax-m3, free nemotron |
| `GROQ_API_KEY` | GBS Groq #17 | helm voice ack (not agent) |
| `DEEPGRAM_API_KEY` | outside freetier | STT |
| `CLOUDFLARE_API_TOKEN` | outside freetier | controlScope |

---

## 5. Inventory per Universe — Agents, Resources, Containers

Each universe maintains a **registry** (future: `universe_resources` table or codex slice `infra_blueprint`):

| Type | Examples | Managed by |
|------|----------|------------|
| **agent** | cursor-bridge, claude-bridge, maestro sub | maestro lanes + vault env |
| **app** | helm-v2, maestro-v1, codex-v1 | turbinobash + vault render |
| **machine** | gbs-h1, bs1, gbs-p2 | codex blueprint + maestro node |
| **container** | (future) vault runtime service, worker | vault `type: container_env` |
| **secret_ref** | logical name → vault path | vault only |
| **context_slice** | briefing, local norm | codex |

```
universe: gbs-symphonie
├── vault_master: /opt/vault/gbs-symphonie/   (future)
├── codex: /apps/codex-v1 (scope=gbs-symphonie)
├── maestro: lanes infra, app, ops
├── helm: sessions gbs-h1/helm-v2/*
├── agents:
│   ├── cursor-bridge :4310
│   └── claude-bridge :4320 + litellm :4330
├── apps:
│   ├── helm-v2
│   ├── maestro-v1
│   └── (future) vault-v1, codex-v1
└── machines:
    ├── gbs-h1 (pilot)
    └── bs1 (target deploy — gbs-p2 full)
```

---

## 6. Relationship with Symphony (Maestro)

The **symphony** = orchestration **within** an universe:

| Layer | Scope |
|-------|-------|
| **Universe** | Isolation boundary + master vault |
| **Symphony** | maestro orchestrates agents/subs in the universe |
| **Pilot wave** | Testable increment (see `PLAN-SYMPHONY-PILOT.md`) |

Maestro does not replace vault: it **consumes** the vault render before each run.

---

## 7. Multi-Universe / Multi-Host

| Scenario | Behavior |
|----------|----------|
| h1 pilot, bs1 prod | Same universe slug, encrypted **vault export/import** or versioned render manifest |
| Distinct universes | Separate vaults, separate codex, zero secret sharing |
| gbs-p2 full | New deployment on **bs1** = same universe, other machine in registry |

---

## 8. What We Do NOT Do

- ❌ Merge vault + codex + freetier into one app
- ❌ Migrate all freetier keys without validation per universe
- ❌ Code vault before the pilot `/opt/vault-pilot/` is validated
- ❌ Expose vault values in codex or LLM context

---

## 9. Documented Next Steps

| # | Action | Project |
|---|--------|---------|
| 1 | Create slug `gbs-symphonie` in pilot codex (file) | codex-pilot |
| 2 | `/opt/vault-pilot/` + 1 test secret | pilot vault |
| 3 | Maestro task: current secrets inventory vs universe registry | maestro |
| 4 | Script import **one** freetier key → pilot vault (dry-run) | vault-v1 phase 1 |
| 5 | ~~`tb app create vault-v1`~~ ✅ | vault-v1 |

---

## 10. Glossary

| Term | Definition |
|------|------------|
| **Universe** | Isolated echo-system: agents + resources + master vault + codex + maestro scope |
| **Master vault** | Authoritative secrets vault of an universe |
| **Echo** | Replicable subsystem (same logic, other host) |
| **Symphony** | Maestro orchestration within an universe |
| **secret_ref** | Logical name on agent side — never the value |
| **Render** | Vault action writing files/env without exposing to LLM |

---

*Last revision: 2026-07-24 — universe = unit of isolation; vault replaces freetier per universe; vault not coded.*
