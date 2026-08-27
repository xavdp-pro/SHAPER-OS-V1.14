# SHAPER OS — Inventaire parallèle Objectifs / Fonctionnalités

> **Scan** : 2026-08-19 · workspace `REMOTE2/`  
> **Loi canonique** : [`PERIMETERS.md`](./PERIMETERS.md) — taxonomie **P1 / P2 / P3**.  
> **Index doc** : [`DOC-INDEX.md`](./DOC-INDEX.md).  
> **Hors scope UI** : `/talk` et `/voice` **retirés** (redirect `/console`). Voix opérateur **dans** `/console` = **P2**.  
> **Convention** : objectif (pourquoi) ↔ fonction (quoi / où).  
> **Statut** : `vivant` · `partiel` · `vision` · `retiré` · `absent` (doc/script promis mais pas dans le repo).

---

## 0. Trois périmètres (vue d’ensemble)

| Périmètre | Objectif | Composants clés | Statut |
| :--- | :--- | :--- | :--- |
| **P1 — Socle minimal** | Boot souverain : secrets, audit, auth, jobs génériques | vault, logger, auth, db, queue | vivant |
| **P2 — Agentique** | Beats, bridges, cockpit, mémoire organisme | maestro, agent, mail-agent, bridges, helm, ged, rag | vivant (rag/qdrant partiel) |
| **P3 — Métier / clients** | Outils pérennes hors socle et hors KovZu | market-intelligence, enterprise-chat, ocr, univ-* | vision |

- Helm `/console` = **P2**. **`enterprise-chat`** = **P3** (chat portails clients, ≠ KovZu).
- **`market-intelligence`** = **P3** (veille / scraper métier).
- UNIV7/8/9 = sandboxes **P1+P2**, pas P3.

---

## 0b. Doctrine OS (loi transverse)

| Objectif | Fonctionnalité | Statut |
| :--- | :--- | :--- |
| Intent-driven engineering | INTENT.md (4–6 invariants) + silence = agent décide | vivant |
| Zéro token idle | Beats Maestro ; inject LLM si handler le décide | vivant |
| Générique vs spécifique | Rule 0B · GENERIC vs SPECIFIC INTENT | vivant |
| Graphe de dépendances | `topology.json` (boot P1+P2) | vivant |
| Validateur topology CLI | `scripts/shaper-deps.mjs doctor` | **absent** (doc TOPOLOGY-INTENT) |
| Pipeline materialization | Rule 0E : intent → materialize → test → registry → deploy | vivant |
| Cockpit ≠ clients | Rule 0F · PERIMETERS P2 vs P3 | vivant |
| Trois périmètres | [`PERIMETERS.md`](./PERIMETERS.md) | vivant |
| PRA (3 clocks: cache / rebuild / data) | `pra-univ7-rebuild.mjs` + tests UNIV* | vivant |
| Bootstrap OS complet | `bootstrap-shaper-os.sh` (`npm run bootstrap`) | **absent** |
| Distillation UNIV-X → SHAPER-OS | MANIFESTO §6 | vivant |

---

## 1. P1 — Socle minimal

### 1.1 Vault

| Objectif | Fonctionnalité | Statut |
| :--- | :--- | :--- |
| Secrets souverains | AES-256-GCM · `@shaper/pkg-vault` · `brick-vault` | vivant |
| CRUD HTTP | `/api/secrets`, health | vivant |
| Bootstrap | `npm run vault:bootstrap` | vivant |

### 1.2 Logger

| Objectif | Fonctionnalité | Statut |
| :--- | :--- | :--- |
| Audit append-only | JSONL · `@shaper/pkg-logger` · `brick-logger` | vivant |
| Ingest / events | `/api/ingest`, `/api/events`, `/api/events/last` | vivant |

### 1.3 Auth

| Objectif | Fonctionnalité | Statut |
| :--- | :--- | :--- |
| Bearer stateless | `@shaper/pkg-auth` (paquet, exécuté dans le service protégé) | vivant |

### 1.4 Queue

| Objectif | Fonctionnalité | Statut |
| :--- | :--- | :--- |
| Jobs async opaques | `@shaper/pkg-queue` · `brick-queue` · SSE | vivant |
| Worker agent.inject | `QUEUE_AUTO_DISPATCH` → bridge | vivant |

### 1.5 DB (Turbinobash)

| Objectif | Fonctionnalité | Statut |
| :--- | :--- | :--- |
| `user = database = slug` | `@shaper/pkg-db` (catalogue) | vivant — hors socle |
| Brick MariaDB | `brick-mariadb` | vivant |

### 1.6 P1 planifié

| Objectif | Fonctionnalité | Statut |
| :--- | :--- | :--- |
| WAF edge | `@shaper/waf` | vision |
| Télémétrie | `log-sentinel` | vision |
| Quadlets racine | `quadlet/*.container` | absent |

---

## 2. P2 — Couche agentique (packages)

### 2.1 Maestro

| Objectif | Fonctionnalité | Statut |
| :--- | :--- | :--- |
| Cadence déterministe | `@shaper/pkg-maestro` · `brick-maestro` | vivant |
| Registre + tick | `/api/pods`, `/api/pods/:slug/tick` | vivant |

### 2.2 Agent

| Objectif | Fonctionnalité | Statut |
| :--- | :--- | :--- |
| 1 image, N tâches | `@shaper/pkg-agent-runtime` (embarqué dans `brick-maestro`) · `task-schedule.json` | vivant |
| Beat handler | `createAgentBeatHandler`, probe bridge health | vivant |
| Bridge-agnostique | agy, opencode, cursor, claude (URL param) | vivant |

### 2.3 Mail-agent

| Objectif | Fonctionnalité | Statut |
| :--- | :--- | :--- |
| IMAP vault-only | `@shaper/pkg-mail-agent` · checkpoint | vivant |

### 2.4 Bridges (Rule 8)

| Objectif | Fonctionnalité | Statut |
| :--- | :--- | :--- |
| Antigravity | `@shaper/pkg-bridge-agy` · `brick-bridge-agy` | vivant |
| OpenCode free | `@shaper/pkg-bridge-opencode` · `opencode-bridge` | vivant |
| Claude au socle | `@shaper/bridge-claude` | absent (Helm routes seulement) |

### 2.5 GED organisme

| Objectif | Fonctionnalité | Statut |
| :--- | :--- | :--- |
| Hub docs opérateur | `@shaper/pkg-ged-engine` · `brick-ged` · `:8660` | vivant |
| Stack UNIV8/9 | conteneur ged dans manifest | partiel |

### 2.6 RAG / Qdrant

| Objectif | Fonctionnalité | Statut |
| :--- | :--- | :--- |
| Index + search | `@shaper/pkg-rag` · API Helm `/api/rag/*` | vivant |
| Vecteurs | `brick-qdrant` | partiel (pas déployé UNIV8/9) |
| topology.json | `@shaper/pkg-rag` absent de `minimalSocle` | partiel |

### 2.7 Codex (planifié P2)

| Objectif | Fonctionnalité | Statut |
| :--- | :--- | :--- |
| Registre contexte agent | `codex-v1` (PLAN-CODEX-V1) | vision |

---

## 3. P2 — Cockpit Helm / KovZu

**Retiré** : `/talk`, `/voice` → redirect `/console`.  
**Actif** : voix dans `/console` (STT/TTS, ack Groq).

### 3.1 Surface

| Objectif | Fonctionnalité | Statut |
| :--- | :--- | :--- |
| Console opérateur | `/console` · chat CLI · timeline | vivant |
| Admin | `/admin/{maestro,socle,agent,cli,briefing,voices,users}` | vivant |
| i18n | FR / EN / ES | vivant |

### 3.2 Chat multi-CLI

| Objectif | Fonctionnalité | Statut |
| :--- | :--- | :--- |
| Plugins | agy · cursor · claude · opencode | vivant |
| Inject + SSE | `/api/inject`, `/api/events` | vivant |
| Sessions / timeline / workspaces | routes conversations, timeline, workspace | vivant |
| Browser / neko | `/api/browser/*` | partiel |

### 3.3 Voix console

| Objectif | Fonctionnalité | Statut |
| :--- | :--- | :--- |
| STT / TTS | Deepgram, Cartesia, Groq ack | vivant |
| Admin voix | Voices, aliases, catalog | vivant |

### 3.4 Admin socle

| Objectif | Fonctionnalité | Statut |
| :--- | :--- | :--- |
| Health | `/api/socle/health` | vivant |
| Maestro UI | `/api/maestro/tasks`, run-now | vivant |
| Proxy GED | `/api/ged` | vivant |

### 3.5 Déploiement

| Objectif | Fonctionnalité | Statut |
| :--- | :--- | :--- |
| Image | `brick-helm` · `:8650` | vivant |
| Tunnel | cloudflared → `ia.example.com` | vivant |
| MariaDB embarqué | UNIV9 | vivant |

---

## 4. P2 — Univers test (P1+P2)

| Objectif | Fonctionnalité | Statut |
| :--- | :--- | :--- |
| Template | `universes/_template/` | vivant |
| UNIV7 | PRA BTP · mail zoutik + storm-watch | vivant |
| UNIV8 | stack Podman + Helm + OpenCode | vivant |
| UNIV9 | Helm tout-en-un + MariaDB | vivant |
| Factory | `univ-factory.mjs` | partiel |
| Doublons miroir | `SHAPER-OS/universes/univ*` vs `UNIV*` | partiel (dérive) |
| UNIV9 INTENT.md | manifest seulement | partiel |

### Instances agentiques UNIV7 (P2)

| Instance | Rôle | Statut |
| :--- | :--- | :--- |
| `mail-contact-zoutik-shop` | IMAP test 300s | vivant |
| `ops-univ7-storm-watch` | inject ops BTP 300s | vivant |

---

## 5. P3 — Métier / outils clients

| Objectif | Fonctionnalité | Statut |
| :--- | :--- | :--- |
| Veille marché | `market-intelligence` | vision |
| Chat portails clients | `enterprise-chat` (**≠** KovZu) | vision |
| OCR métier | `ocr-engine` | vision |
| Showcase RBAC | `wikiuniv-v1` | vision |
| ERP verticaux | univ-sinistre, artisan, immo | vision |
| POC CRM | app séparée (VISION phase 5) | vision |
| Helm Desk | mobile → desktop WS (phase 4) | vision |
| Outillage scaffold | `shaper-tool-scaffold.mjs`, `shaper-sandbox.sh` | vivant |

**Protocole** : sandbox → brick dédiée → volume `/data/<slug>/` → jamais dans KovZu.

---

## 6. Host, flotte, usine

| Objectif | Fonctionnalité | Statut |
| :--- | :--- | :--- |
| skel LXC | `skel/etc/*` | vivant |
| Build bricks | `build-all-bricks.sh` (8 scripts) | vivant |
| PRA rebuild | `pra-univ7-rebuild.mjs` | vivant |
| Snapshots | `snapshot-universe.sh` / restore | vivant |
| Bootstrap OS | `bootstrap-shaper-os.sh` | **absent** |
| shaper-deps | validate topology | **absent** |

---

## 7. Couverture globale

| Objectif | Statut |
| :--- | :--- |
| P1 socle opérationnel | vivant |
| P2 agentique + KovZu | vivant (rag/qdrant partiel) |
| P3 métier | vision |
| Talk `/talk` | **retiré** |
| Doc Talk (SPEC_ZEPHIR) | **supprimée en V1.11** — la voix vit dans `/console` |

---

## 8. Où ça vit

| Périmètre | Chemin |
| :--- | :--- |
| Loi | `docs/PERIMETERS.md` |
| Index | `docs/DOC-INDEX.md` |
| Packages | `packages/` |
| Bricks | `bricks/` |
| Graphe | `topology.json` |
| KovZu | `bricks/brick-helm/` |
| Sandboxes | `UNIV7/` `UNIV8/` `UNIV9/` |
