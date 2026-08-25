# Plan — `codex-v1`: Context Registry & Agentic Infra

**Type:** plan + checklists — design only.
**Separate project from `vault-v1`** — do not merge codebases.
**Policy:** no migration; pilots on h1 in small increments; maestro
iterations until infra-v2 building blocks stabilize.
**Cadence:** [`PLAN-SYMPHONY-PILOT.md`](./PLAN-SYMPHONY-PILOT.md) — start with a
**slice file** (wave 2) before the codex-v1 app (wave 3).
**Future home:** `/apps/codex-v1/app/mds/`

Each **codex** is scoped to a **universe** — see [`UNIVERSE-V1.md`](./UNIVERSE-V1.md).

See also: [`PLAN-VAULT-V1.md`](./PLAN-VAULT-V1.md) (secrets), maestro-v1,
helm-v2 `contextDigest.js` / `controlScope.js`.

---

## 1. Problem

Today **agent context** is scattered:

| Piece | Where |
|-------|-------|
| Operator briefing | `users.briefing` (helm-v2) |
| Control scope (CF domains…) | `.env` + `controlScope.js` |
| Session digest | `CONTEXT.md` / `_kovzu/` (helm) |
| Task mission | `tasks.context_json` + prompt (maestro) |
| Standards / skills | `agentSkills.js` (generic, code) |
| Error lessons | `lessons` (maestro, partial) |

**Missing:**

1. No **versioned catalog** of infrastructure descriptions to digest before a run.
2. No stable **concatenation recipe** (what to include, in what order).
3. No explicit link between **chat_id / conversation** ↔ context snapshot so a sub can resume with the exact same briefing.
4. No documented **iterative** loop: maestro builds infra-v2 piece by piece until "stable".

---

## 2. Role of codex-v1 (vs vault, maestro, helm)

```
                    ┌─────────────┐
   human ──────────▶│  helm-v2    │  chat, voice, briefing edition
                    └──────┬──────┘
                           │ reads / writes slices
                    ┌──────▼──────┐
                    │  codex-v1   │  context registry + infra (versioned text)
                    │  - slices   │
                    │  - recipes  │
                    │  - digests  │
                    └──────┬──────┘
                           │ GET digest before run
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        maestro-v1    helm prime    subs (bridge)
        (task run)    (session)     (dedicated chat_id)
              │
              │ secrets = names only
              ▼
        vault-v1  (passwords — never in the digest)
```

| Layer | Question | Project |
|-------|----------|---------|
| **Secrets** | Which password / token? | `vault-v1` |
| **Context** | What should the agent be briefed about? | `codex-v1` |
| **Execution** | Who launches what, when? | `maestro-v1` |
| **Human** | Who dialogues? | `helm-v2` |

---

## 3. Concepts (English code names)

| Concept | Description |
|---------|-------------|
| **slice** | Named piece of context (briefing, infra blueprint, local standard…) |
| **recipe** | Order and concatenation rules of slices for a run type |
| **digest** | Final assembled text, hashed/versioned, ready to inject |
| **binding** | Link `chat_id` or `task_id` ↔ digest_id (exact resumption) |
| **blueprint** | Description of a target infra brick (e.g. "infra-v2 scheduler") |
| **stability** | Human "OK" marker on a brick — end of maestro iteration |

---

## 4. Types of Slices

| Type | Example | Scope | LLM |
|------|---------|-------|-----|
| `operator_briefing` | Zephir presentation, preferences | user / global | yes |
| `control_scope` | Controlled Cloudflare domains (no token) | deployment | yes |
| `infra_blueprint` | Spec of an infra-v2 brick | project | yes |
| `agent_norm` | Local rules (not generic code skills) | global / app | yes |
| `task_context` | Workspace snapshot, key files | task | yes |
| `lesson` | Past error + fix | app / lane | yes |
| `secret_ref` | **Reference** `CLOUDFLARE_API_TOKEN` exists | global | **name only** |

Secret **values** remain in **vault**; codex only stores references.

---

## 5. Digest Recipe (before agent launch)

Example for `maestro task run`:

```
1. agent_norm.global
2. control_scope.deployment
3. infra_blueprint.<target>        # if infra task
4. operator_briefing.<user>        # optional depending on lane
5. task_context.<task_id>
6. lessons.matching.<signature>    # 0..n
7. secret_refs                     # variable names, never values
8. footer maestro (RUN-REPORT…)    # unchanged on maestro side
```

Target API:

```
POST /api/digest/assemble
{
  "recipe": "maestro_task_run",
  "task_id": 42,
  "chat_id": "gbs-h1/maestro-v1/task-42",   # optional — resume
  "user_id": 3,
  "blueprint_id": "infra-v2-scheduler"
}
→ { "digest_id": "…", "text": "…", "version": 7 }
```

The subordinate receives the digest **once** upon inject; the bridge `chat_id` remains dedicated
(`{node}/{user}/task-{id}`) for conversation continuity.

---

## 6. Iterative Loop maestro → infra-v2

Goal: use **maestro** to build **infra-v2** (or any target)
through iterations until human validation.

```
human drafts blueprint in codex
        │
        ▼
maestro task (infra lane) — digest assembled from codex
        │
        ▼
subordinate executes in target workspace
        │
        ▼
run report (maestro-report JSON) + lesson on failure
        │
        ▼
human marks blueprint slice "stability: ok" OR new iteration
        │
        └──▶ next task on the next brick
```

**Rule:** one brick = one versioned blueprint slice; no big-bang infrastructure overhaul.
Maestro orchestrates; codex **memorizes** what agents were instructed and what is stable.

---

## 7. Storage (V1 Proposal)

| Option | Content | Encrypted? |
|--------|---------|------------|
| MariaDB `codex-v1` | slices, recipes, digests (text), bindings | no (no secrets) |
| `mds/` files in repo | infra blueprints in git (option) | no |
| `vault-v1` | passwords only | yes |

No mixing of vault/codex in database. If a slice contains a secret by mistake → rejected upon ingestion.

---

## 8. Phases (Small steps on h1)

### Phase 0 — Doc + Schema

- [ ] `tb app sudo/way/noweb/create codex-v1` (when ready — not before vault pilot if overloaded)
- [ ] Tables: `slices`, `recipes`, `digests`, `bindings`, `stability_marks`
- [ ] `mds/AGENT-CONTEXT.md`, `ARCHITECTURE.md`

### Phase 1 — Slices CRUD + Minimal Assemble

- [ ] `POST /api/slices` — create / version a slice
- [ ] `POST /api/digest/assemble` — `maestro_task_run` recipe hardcoded first
- [ ] Test: maestro `POST /tasks/:id/run` calls codex for prompt prefix
- [ ] Zero plaintext secrets in slices (lint / review)

### Phase 2 — `chat_id` Binding

- [ ] `bindings(chat_id, digest_id)` — resume same briefing on rerun
- [ ] Helm: `digest_id` option on prime (later, not urgent)

### Phase 3 — Infra-v2 Blueprints

- [ ] `infra_blueprint` type + simple admin UI (list, version, mark stable)
- [ ] First loop: a pilot brick (e.g. "vault render hook")
- [ ] Maestro lessons → auto-suggest new `lesson` slice (manual first)

### Phase 4 — Helm Briefing Integration

- [ ] **Optionally** migrate `users.briefing` to `operator_briefing` slice
- [ ] Helm continues to work if codex is down (SQL briefing fallback)

---

## 9. Non-goals for V1

- Replacing maestro or helm
- Storing passwords (→ vault)
- Mandatory migration of existing briefings
- Elaborate zeruxfaq-like mini-EDMS UI
- Multi-machine / HA

---

## 10. Why a separate name (`codex-v1`)?

| If extending vault | Problem |
|--------------------|---------|
| Same app | Security risk: LLM digest alongside secrets |
| Same "vault" name | Human confusion: "is it encrypted? agent-visible?" |
| Everything in maestro | Mixing orchestration and knowledge catalog |

**`codex-v1`** = codex / registry of contextual knowledge **intended for agents**.
**`vault-v1`** = **locked** vault.

Two repos, two turbinobash apps, two ports — clear responsibilities.

---

## 11. Turbinobash + Docker Link (like vault)

| Runtime | How subordinate receives digest |
|---------|---------------------------------|
| **PM2 / bridge** | Injected into prompt on `run` (maestro / helm) |
| **Container** (future) | `GET /api/digest/assemble` at boot entrypoint → file or env `CODEX_DIGEST_PATH` |

Same logic as vault: **one codex truth**, multiple delivery modes.

---

*Last revision: 2026-07-24 — separate project from vault; maestro iterations → infra-v2.*
