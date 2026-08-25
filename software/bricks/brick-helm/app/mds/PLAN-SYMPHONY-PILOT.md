# Plan — Symphony Pilot: Growing Together, Step by Step

**Type:** transversal roadmap — coordinates vault, codex, maestro, helm.
**Principle:** we **pilot together** as we go; no big-bang, no waiting
for one project to be "finished" before connecting the next.
**Policy:** each wave = a playable end-to-end piece on **gbs-h1**.
**Separate repos** (vault ≠ codex) but **single pilot cadence**.
**Universe:** each pilot lives in a universe slug (e.g. `gbs-symphonie`) —
see [`UNIVERSE-V1.md`](./UNIVERSE-V1.md).

See: [`PLAN-VAULT-V1.md`](./PLAN-VAULT-V1.md) · [`PLAN-CODEX-V1.md`](./PLAN-CODEX-V1.md) ·
maestro-v1 `mds/VISION.md`.

---

## 1. The Symphony (Metaphor → Reality)

| Instrument | Project | Role in Orchestra |
|------------|---------|-------------------|
| **Conductor** | `maestro-v1` | Launches runs, schedule, alerts, stream |
| **Musicians** | subs (bridge) | Execute in an isolated workspace |
| **Score** | `codex-v1` | Versioned context, digests, infra briefings |
| **Vault** | `vault-v1` | Secrets — never on the LLM score |
| **Director** | `helm-v2` | Human: chat, voice, briefing, future delegation |

```
helm (human) ──▶ maestro (conductor) ──▶ sub (musician)
                       │                       ▲
                       ├── codex (score)───────┤
                       └── vault (vault)───────┘ env files, not in the prompt
```

**Today (July 2026)** the symphony **is already playing** in a reduced version:
maestro 0.5 (stream, scheduler, conductor), helm-v2 cockpit, scattered context
(SQL briefing, `context_json`, files). Next pilots **enrich**
without rewriting everything.

---

## 2. Golden Rule of the Pilot

> **One wave = one building block tested in real conditions + one maestro task documenting it.**

- No migration of existing setups.
- No full app before the need arises.
- First **pilot folder** or **file**; then **API**; then **UI**.
- Each wave leaves the symphony **playable** — we do not stop maestro to build vault.

---

## 3. Pilot Waves (Suggested Order)

### Wave 0 — Baseline *(already in place)*

| What | State |
|------|-------|
| Maestro tasks / runs / lanes | ✅ |
| Scheduler `at` + `run_after` | ✅ |
| Conductor + subscriptions | ✅ |
| Live stream `TaskStream` | ✅ |
| Helm briefing `users.briefing` | ✅ |
| File secrets `passwd` / `.env` | ✅ (status quo) |

**Next human action:** choose the **first infra brick** to automate
(e.g. vault render hook, or codex blueprint for a lane).

---

### Wave 1 — Pilot Vault (1 secret, 1 file)

**Goal:** prove vault **without touching** production.

| Step | Deliverable |
|------|-------------|
| 1.1 | `/opt/vault-pilot/` folder + `sops` + test `age` key |
| 1.2 | A shared pilot secret (e.g. CF token **test copy**, not prod) |
| 1.3 | `vault render` → **single** target file (e.g. `.vault-pilot/out/test.env`) |
| 1.4 | Maestro task "verify render" (infra lane, run report) |
| 1.5 | Human validates: file OK, prod apps **unchanged** |

**Codex / helm:** nothing. Maestro alone executes and documents.

---

### Wave 2 — Pilot Score (1 slice, without app)

**Goal:** context catalog **before** codex-v1 app.

| Step | Deliverable |
|------|-------------|
| 2.1 | `/apps/codex-pilot/` folder (or `mds/codex-pilot/` in maestro) |
| 2.2 | A file `slices/infra-v2-vault-hook.md` (wave 1 blueprint) |
| 2.3 | Maestro helper or script: concatenates slice + `context_json` on `run` |
| 2.4 | Dedicated `chat_id` `gbs-h1/maestro-v1/task-{id}` — already bridge model |
| 2.5 | Maestro task iterates on brick until `success` run report |
| 2.6 | Human marks "stable" in markdown or a maestro tag |

**Vault:** can remain at wave 1. **Helm:** unchanged.

---

### Wave 3 — Minimal Codex (1 endpoint)

**Goal:** extract helper into small app.

| Step | Deliverable |
|------|-------------|
| 3.1 | `tb app create codex-v1` (turbinobash, h1) |
| 3.2 | `slices` + `digests` tables; import wave 2 pilot slice |
| 3.3 | `POST /api/digest/assemble` — `maestro_task_run` recipe |
| 3.4 | Maestro `dispatchTask` calls codex before sub inject |
| 3.5 | `task_id` ↔ `digest_id` binding in DB |

**Vault:** still separate pilot. No secrets in codex.

---

### Wave 4 — Vault App (1 shared prod secret)

**Goal:** first **real** secret rendered to existing target.

| Step | Deliverable |
|------|-------------|
| 4.1 | `tb app create vault-v1` |
| 4.2 | Manifest: 1 global secret → 1 `etc/...` file of a pilot app |
| 4.3 | `vault render <app>` in maestro cron or post-deploy hook |
| 4.4 | Codex slice "how to read this secret" (names only) |
| 4.5 | Maestro lesson on failure |

**Go criterion:** pilot app reads file as before; single vault source.

---

### Wave 5 — Connected Helm (optional, when stable)

| Step | Deliverable |
|------|-------------|
| 5.1 | Session prime: `digest_id` option or auto from codex |
| 5.2 | Chat → maestro task (CHAT-STREAMING.md) |
| 5.3 | Codex admin UI: list slices, mark stable |

---

## 4. Iteration Loop (Each Wave)

```
1. Write / update slice (codex or pilot file)
2. Create or schedule maestro task (appropriate lane)
3. Run → stream → JSON run report
4. Failure? → lesson + new iteration
5. Success? → mark stable → next wave or next brick
```

It is the **same symphony** growing: the conductor (maestro) does not change
logic; we add scores (codex) and vaults (vault) along the way.

---

## 5. What We Do NOT Do During the Pilot

- ❌ Migrate all 11 `.env` files at once
- ❌ Merge vault + codex into one app
- ❌ Wait for full codex-v1 before first vault render
- ❌ Stop maestro / helm to "prepare infrastructure"
- ❌ Docker / runtime secrets API (after stable turbinobash)

---

## 6. Where Docs Live

| Document | Content |
|----------|---------|
| **This file** | Transversal pilot cadence |
| `PLAN-VAULT-V1.md` | Secrets vault design |
| `PLAN-CODEX-V1.md` | Context registry design |
| maestro `VISION.md` | Symphony vision / lanes / subs |
| maestro `RUN-REPORT.md` | Machine feedback contract |

When a wave is validated, check corresponding phases in vault/codex
and record date at bottom of this file.

---

## 7. Concrete Next Step (Suggestion)

**Wave 1 — start now:**

1. Create `/opt/vault-pilot/` on h1 (structure + pilot README).
2. Maestro task: "document CF secrets state on h1" (reconnaissance, no change).
3. In parallel: write slice `infra-v2-vault-hook.md` (wave 2, file only).

Two small threads, a symphony starting to hold score and vault.

---

*Last revision: 2026-07-24 — integrated pilot, growth in waves.*
