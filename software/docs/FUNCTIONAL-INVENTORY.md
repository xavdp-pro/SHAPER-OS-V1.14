# SHAPER OS — Parallel Inventory of Objectives / Features

> **Scan**: 2026-08-19 · workspace `REMOTE2/`  
> **Canonical law**: [`PERIMETERS.md`](./PERIMETERS.md) — **P1 / P2 / P3** taxonomy.  
> **Doc index**: [`DOC-INDEX.md`](./DOC-INDEX.md).  
> **Out of UI scope**: `/talk` and `/voice` **removed** (redirect to `/console`). Operator voice **inside** `/console` = **P2**.  
> **Convention**: objective (why) ↔ feature (what / where).  
> **Status**: `live` · `partial` · `vision` · `retired` · `absent` (doc/script promised but not in the repo).

---

## 0. Three perimeters (overview)

| Perimeter | Objective | Key components | Status |
| :--- | :--- | :--- | :--- |
| **P1 — Minimal socle** | Sovereign boot: secrets, audit, auth, generic jobs | vault, logger, auth, db, queue | live |
| **P2 — Agentic** | Beats, bridges, cockpit, organism memory | maestro, agent, mail-agent, bridges, helm, ged, rag | live (rag/qdrant partial) |
| **P3 — Business / clients** | Durable tools outside the socle and outside KovZu | market-intelligence, enterprise-chat, ocr, univ-* | vision |

- Helm `/console` = **P2**. **`enterprise-chat`** = **P3** (client-portal chat, ≠ KovZu).
- **`market-intelligence`** = **P3** (business watch / scraper).
- UNIV7/8/9 = **P1+P2** sandboxes, not P3.

---

## 0b. OS doctrine (transversal law)

| Objective | Feature | Status |
| :--- | :--- | :--- |
| Intent-driven engineering | INTENT.md (4–6 invariants) + silence = the agent decides | live |
| Zero idle tokens | Maestro beats; LLM inject if the handler decides | live |
| Generic vs specific | Rule 0B · GENERIC vs SPECIFIC INTENT | live |
| Dependency graph | `topology.json` (P1+P2 boot) | live |
| Topology CLI validator | `scripts/shaper-deps.mjs doctor` | **absent** (doc TOPOLOGY-INTENT) |
| Materialization pipeline | Rule 0E: intent → materialize → test → registry → deploy | live |
| Cockpit ≠ clients | Rule 0F · PERIMETERS P2 vs P3 | live |
| Three perimeters | [`PERIMETERS.md`](./PERIMETERS.md) | live |
| PRA (3 clocks: cache / rebuild / data) | `pra-univ7-rebuild.mjs` + UNIV* tests | live |
| Full OS bootstrap | `bootstrap-shaper-os.sh` (`npm run bootstrap`) | **absent** |
| Distillation UNIV-X → SHAPER-OS | MANIFESTO §6 | live |

---

## 1. P1 — Minimal socle

### 1.1 Vault

| Objective | Feature | Status |
| :--- | :--- | :--- |
| Sovereign secrets | AES-256-GCM · `@shaper/pkg-vault` · `brick-vault` | live |
| HTTP CRUD | `/api/secrets`, health | live |
| Bootstrap | `npm run vault:bootstrap` | live |

### 1.2 Logger

| Objective | Feature | Status |
| :--- | :--- | :--- |
| Append-only audit | JSONL · `@shaper/pkg-logger` · `brick-logger` | live |
| Ingest / events | `/api/ingest`, `/api/events`, `/api/events/last` | live |

### 1.3 Auth

| Objective | Feature | Status |
| :--- | :--- | :--- |
| Stateless Bearer | `@shaper/pkg-auth` (package, executed inside the protected service) | live |

### 1.4 Queue

| Objective | Feature | Status |
| :--- | :--- | :--- |
| Opaque async jobs | `@shaper/pkg-queue` · `brick-queue` · SSE | live |
| agent.inject worker | `QUEUE_AUTO_DISPATCH` → bridge | live |

### 1.5 DB (Turbinobash)

| Objective | Feature | Status |
| :--- | :--- | :--- |
| `user = database = slug` | `@shaper/pkg-db` (catalogue) | live — outside the socle |
| MariaDB brick | `brick-mariadb` | live |

### 1.6 Planned P1

| Objective | Feature | Status |
| :--- | :--- | :--- |
| Edge WAF | `@shaper/waf` | vision |
| Telemetry | `log-sentinel` | vision |
| Root quadlets | `quadlet/*.container` | absent |

---

## 2. P2 — Agentic layer (packages)

### 2.1 Maestro

| Objective | Feature | Status |
| :--- | :--- | :--- |
| Deterministic cadence | `@shaper/pkg-maestro` · `brick-maestro` | live |
| Registry + tick | `/api/pods`, `/api/pods/:slug/tick` | live |

### 2.2 Agent

| Objective | Feature | Status |
| :--- | :--- | :--- |
| 1 image, N tasks | `@shaper/pkg-agent-runtime` (embedded in `brick-maestro`) · `task-schedule.json` | live |
| Beat handler | `createAgentBeatHandler`, bridge health probe | live |
| Bridge-agnostic | agy, opencode, cursor, claude (URL param) | live |

### 2.3 Mail-agent

| Objective | Feature | Status |
| :--- | :--- | :--- |
| Vault-only IMAP | `@shaper/pkg-mail-agent` · checkpoint | live |

### 2.4 Bridges (Rule 8)

| Objective | Feature | Status |
| :--- | :--- | :--- |
| Antigravity | `@shaper/pkg-bridge-agy` · `brick-bridge-agy` | live |
| OpenCode free | `@shaper/pkg-bridge-opencode` · `opencode-bridge` | live |
| Claude in the socle | `@shaper/bridge-claude` | absent (Helm routes only) |

### 2.5 Organism GED

| Objective | Feature | Status |
| :--- | :--- | :--- |
| Operator document hub | `@shaper/pkg-ged-engine` · `brick-ged` · `:8660` | live |
| UNIV8/9 stack | ged container in the manifest | partial |

### 2.6 RAG / Qdrant

| Objective | Feature | Status |
| :--- | :--- | :--- |
| Index + search | `@shaper/pkg-rag` · Helm API `/api/rag/*` | live |
| Vectors | `brick-qdrant` | partial (not deployed in UNIV8/9) |
| topology.json | `@shaper/pkg-rag` absent from `minimalSocle` | partial |

### 2.7 Codex (planned P2)

| Objective | Feature | Status |
| :--- | :--- | :--- |
| Agent context registry | `codex-v1` (PLAN-CODEX-V1) | vision |

---

## 3. P2 — Helm / KovZu cockpit

**Removed**: `/talk`, `/voice` → redirect to `/console`.  
**Active**: voice inside `/console` (STT/TTS, Groq ack).

### 3.1 Surface

| Objective | Feature | Status |
| :--- | :--- | :--- |
| Operator console | `/console` · CLI chat · timeline | live |
| Admin | `/admin/{maestro,socle,agent,cli,briefing,voices,users}` | live |
| i18n | FR / EN / ES | live |

### 3.2 Multi-CLI chat

| Objective | Feature | Status |
| :--- | :--- | :--- |
| Plugins | agy · cursor · claude · opencode | live |
| Inject + SSE | `/api/inject`, `/api/events` | live |
| Sessions / timeline / workspaces | conversations, timeline, workspace routes | live |
| Browser / neko | `/api/browser/*` | partial |

### 3.3 Console voice

| Objective | Feature | Status |
| :--- | :--- | :--- |
| STT / TTS | Deepgram, Cartesia, Groq ack | live |
| Voice admin | Voices, aliases, catalog | live |

### 3.4 Socle admin

| Objective | Feature | Status |
| :--- | :--- | :--- |
| Health | `/api/socle/health` | live |
| Maestro UI | `/api/maestro/tasks`, run-now | live |
| GED proxy | `/api/ged` | live |

### 3.5 Deployment

| Objective | Feature | Status |
| :--- | :--- | :--- |
| Image | `brick-helm` · `:8650` | live |
| Tunnel | cloudflared → `ia.example.com` | live |
| Embedded MariaDB | UNIV9 | live |

---

## 4. P2 — Test universes (P1+P2)

| Objective | Feature | Status |
| :--- | :--- | :--- |
| Template | `universes/_template/` | live |
| UNIV7 | PRA BTP · zoutik mail + storm-watch | live |
| UNIV8 | Podman stack + Helm + OpenCode | live |
| UNIV9 | All-in-one Helm + MariaDB | live |
| Factory | none — a universe class is born by `docs/agent/UNIVERSE-REPO-BIRTH.md`, a procedure, not a generator; the factory script left on 2 September 2026 (it wrote `apps/` and `quadlet/`, a frame the base does not have, and was run by nothing) | retired |
| Mirror duplicates | `SHAPER-OS/universes/univ*` vs `UNIV*` | partial (drift) |
| UNIV9 INTENT.md | manifest only | partial |

### UNIV7 agentic instances (P2)

| Instance | Role | Status |
| :--- | :--- | :--- |
| `mail-contact-zoutik-shop` | IMAP test 300s | live |
| `ops-univ7-storm-watch` | BTP ops inject 300s | live |

---

## 5. P3 — Business / client tools

| Objective | Feature | Status |
| :--- | :--- | :--- |
| Market watch | `market-intelligence` | vision |
| Client-portal chat | `enterprise-chat` (**≠** KovZu) | vision |
| Business OCR | `ocr-engine` | vision |
| RBAC showcase | `wikiuniv-v1` | vision |
| Vertical ERPs | univ-sinistre, artisan, immo | vision |
| CRM POC | separate app (VISION phase 5) | vision |
| Helm Desk | mobile → desktop WS (phase 4) | vision |
| Scaffold tooling | `shaper-tool-scaffold.mjs` (writes `packages/pkg-<slug>` + `bricks/brick-<slug>`, from a universe class repository, never from the base), `shaper-sandbox.sh` | live |

**Protocol**: sandbox → dedicated brick → volume `/data/<slug>/` → never inside KovZu.

---

## 6. Host, fleet, factory

| Objective | Feature | Status |
| :--- | :--- | :--- |
| LXC skel | `skel/etc/*` | live |
| Brick builds | `build-all-bricks.sh` (8 scripts) | live |
| PRA rebuild | `pra-univ7-rebuild.mjs` | live |
| Snapshots | `snapshot-universe.sh` / restore | live |
| OS bootstrap | `bootstrap-shaper-os.sh` | **absent** |
| shaper-deps | validate topology | **absent** |

---

## 7. Global coverage

| Objective | Status |
| :--- | :--- |
| P1 socle operational | live |
| P2 agentic + KovZu | live (rag/qdrant partial) |
| P3 business | vision |
| Talk `/talk` | **retired** |
| Talk doc (SPEC_ZEPHIR) | **removed in V1.11** — voice lives in `/console` |

---

## 8. Where it lives

| Perimeter | Path |
| :--- | :--- |
| Law | `docs/PERIMETERS.md` |
| Index | `docs/DOC-INDEX.md` |
| Packages | `packages/` |
| Bricks | `bricks/` |
| Graph | `topology.json` |
| KovZu | `bricks/brick-helm/` |
| Sandboxes | `UNIV7/` `UNIV8/` `UNIV9/` |
