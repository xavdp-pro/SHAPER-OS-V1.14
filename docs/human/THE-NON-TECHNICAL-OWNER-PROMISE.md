# THE NON-TECHNICAL OWNER PROMISE & AUTONOMOUS DELIVERY PROTOCOL
**SHAPER OS V1.6 — Zero-Broken-Window Standard for Autonomous Business Delivery**

---

## 1. The Core Vision: The Non-Technical Owner Experience

A business owner running a retail shop, a service agency, an association, or an e-commerce brand does not care about Dockerfiles, SSE streams, or database schemas. They have a business to run.

### The Concrete Golden Scenario: "The Sofa Sales Chart"
> **The Story:**
> The owner of a furniture store opens their Shaper OS console and types or speaks:
> *"Sur ma page stats, je veux voir le graphique interactif des ventes de nos canapés (Oslo, Helsinki, Stockholm) du dernier trimestre avec la marge brute."*
>
> **What the Autonomous Agent Does:**
> 1. **Understands Universe Context:** Reads `ctx-universe.md`, knows the catalog, data schema, and workspace layout (`/apps/stats/`).
> 2. **Vibe Codes & Assembles:** Generates the clean, responsive HTML/JS/CSS deliverable with interactive visualization (e.g., Chart.js / SVG).
> 3. **Tests Before Delivery:** Automatically validates the deliverable (checks syntax, loads data, verifies rendering).
> 4. **Delivers with a Smile:** Responds with the exact clickable URL (e.g., `http://127.0.0.1:8650/apps/stats/canapes-q1.html`).
> 5. **Owner Smiles:** The owner clicks the link, sees the exact chart, tweaks one or two details by voice or chat, and the job is done.

---

## 2. The 3-Tier Verification Pyramid

To guarantee that this promise never breaks, the codebase enforces an automated 3-tier validation pyramid that runs continuously:

```mermaid
flowchart BT
    T1["<b>TIER 1 — atomic unit verification</b><br/><i>vault, logger, auth, storage</i>"]
    T2["<b>TIER 2 — inter-brick integration</b><br/><i>queue, maestro, retrieval, streams</i>"]
    T3["<b>TIER 3 — browser end-to-end</b><br/><i>the full user flow, and the delivery</i>"]

    T1 --> T2 --> T3

    classDef t fill:#0d1117,stroke:#3fb950,color:#e6edf3
    class T1,T2,T3 t
```

Each tier can pass while the one above it fails. That is the point: a green unit
suite proves the parts, and only the top tier proves that a person can actually
use what was built.

### Tier 1 — Atomic Brick Verification (100% Deterministic)
Every foundational building block must pass isolated unit tests with zero mock leaks:
- **Vault Engine (`@shaper/pkg-vault-engine`)**: AES-256-GCM encryption/decryption, tamper resistance, disk persistence, Bearer token authentication.
- **Audit Logger (`@shaper/pkg-logger`)**: JSONL event formatting, obligatory field validation, non-blocking ingestion.
- **Job Queue (`@shaper/pkg-queue`)**: Task registration, worker dispatch, auto-recovery on crash, state transitions (`pending` → `running` → `completed` / `failed`).
- **Maestro Scheduler (`@shaper/pkg-maestro`)**: Cron cadence, heartbeat beats, task registry by slug/id.
- **GED Engine (`@shaper/pkg-ged-engine`)**: Multi-format document categorization, metadata provenance, chunking (overlap window), 384-dimensional vector embedding.

### Tier 2 — Inter-Brick Synergy & Pipeline Validation
Validates that services collaborate flawlessly over HTTP/SSE:
- **Queue $\leftrightarrow$ Agent Bridge**: Tasks dispatched by Queue are executed by the bridge and stream progress back.
- **Helm $\leftrightarrow$ OpenCode Bridge**: Real-time SSE streaming maps reasoning, tool execution, and final markdown into the reactive timeline without 401 token dropouts.
- **GED $\leftrightarrow$ Vector Search (Qdrant/Local RAG)**: Uploaded PDF/CSV/Markdown files are chunked, embedded, indexed, and retrieved via cosine similarity search.

### Tier 3 — Playwright Real-Browser E2E Testing
Real Chromium browser tests verifying what the human operator actually sees and experiences:
1. **Authentication & Session Persistence**: Form login with admin credentials, JWT issuance, secure cookie/bearer header storage.
2. **Cockpit UI & Live Status**: Green indicator (`🟢`), Welcome Briefing presentation board, real-time Karaoké speech alignment.
3. **Document Ingestion**: File upload via drag-and-drop or trombone attach, instant preview chips, document query response.
4. **Autonomous Production Delivery**: End-to-end simulation where a prompt triggers deliverable generation, automated verification, and clickable preview rendering.

---

## 3. Rules for Autonomous Agents in Shaper OS

1. **Know Your Universe:** Never assume a generic environment. Read the local universe manifest, know what ports and services are available.
2. **Never Deliver Broken Code:** Always test artifacts and deliverables locally before returning completion to the user.
3. **Clear Human Communication:** State what was done in plain business language, provide direct actionable links, and explain next steps simply.
4. **Zero Silent Hangs:** If an upstream model or tool throws an error, catch it, translate it into friendly French/English, and display it with clear remedy suggestions.

---

## 4. The Human Vibe-Coder Contract & "Standard vs Freestyle" Guarantee

### The Vibe-Coding Principle
The human vibe-coder pairs with the AI agent to shape their business tools. The human provides the vision and API credentials in the root `.env` (`REMOTE3/.env` or `software/.env`). The AI agent validates the environment, proactively requests missing keys, and propagates them across all Podman containers.

### ⚖️ The Guarantee Matrix

| Mode | Conditions | Outcome & Support |
| :--- | :--- | :--- |
| 🛡️ **Standard Recipe ("La Sauce Robuste")** | The human follows the checklist and provides all valid keys (`DEEPGRAM_API_KEY`, `GROQ_API_KEY`, etc.) in `.env`. The AI agent inspects and validates before launching. | **100% Guaranteed Predictability.** All 3 tiers of the pyramid pass, zero 401 errors, full autonomous voice and tool generation. |
| 🎨 **Freestyle Mode ("Liberté Totale")** | The human user decides to omit keys, run partial stacks, change architecture rules, or test while waiting for accounts. | **User's Full Responsibility.** Degraded or inactive features (e.g. browser Web Speech fallback instead of Deepgram HD) are managed directly between the human and their AI agent. |

> [!NOTE]
> Freedom of customization is absolute. But if you deviate from the standard verified checklist, you are in freestyle mode. For 100% guaranteed, rock-solid, zero-friction delivery, provide the complete `.env` and let the agent validate and propagate.
