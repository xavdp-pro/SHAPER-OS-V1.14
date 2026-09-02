# SHAPER OS & UNIV — Fundamental Engineering Rules & Architecture Invariants

This file is the **canon**. It is read in full, never summarised, never replaced by a
pointer to itself. Rules are added, never removed to fit what the code currently does —
when doctrine and code diverge, the gap is recorded in
[`doctrine/CONVERGENCE-STATE.md`](../doctrine/CONVERGENCE-STATE.md).

---

## How to read this file

**Rule numbers are identifiers, not priorities.** They are stable because 240+ references
across the repository point at them. Their order is the order in which they were written,
so a low number means "written early", not "matters more".

**If you read only six rules before touching anything**, read these — they are what shape
judgement rather than convention:

| Rule | What it changes about how you work |
| :--- | :--- |
| **0G** | No fake, no fallback. A thing that cannot be done is reported, never simulated. |
| **0A** | Which perimeter you are in — P1 socle, P2 agents, P3 business — decides what you may touch. |
| **0B** | Nothing environment-specific is ever hardcoded. Everything is a parameter. |
| **32** | Perfect the generic base first; business specifics go on top of it, never into it. |
| **23** | Never modify your own running infrastructure. Repair comes from the level above. |
| **20** | Nothing is `COMPLETED` without passing the verification contract for its type. |

**Then go where your work is:**

| You are… | Read |
| :--- | :--- |
| building or changing a brick | 0A, 0B, 0C, 0D, 0E, 32, 33 |
| deploying or operating | 3, 10, 11, 12, 13, 16, 25, 27, 30 |
| working on agents, bridges, delegation | 0F, 0H, 0K, 6, 7, 8, 19, 21, 23, 24 |
| handling documents or data | 20, 22, 26, 31, and `doctrine/DOCUMENT-PIPELINE.md` |
| shipping to a client | 0G, 0J, 10, 18, 19, 25, 31, 33 |

---

## Binding force is uniform. Consequence is not.

These two statements are different, and only the first is about obedience:

1. **Every rule is mandatory.** None is a suggestion, none is skipped for convenience,
   none is optional because it is inconvenient today. That is [`LAW.md`](../LAW.md).
2. **Violations do not cost the same.** Claiming they do would be visibly false, and an
   agent that senses the falseness starts ranking rules silently by its own criteria —
   which is worse than an explicit ranking. So here is the explicit one.

What separates the tiers is **reversibility**, not importance:

| Tier | A violation costs | Rules |
| :--- | :--- | :--- |
| **Irreversible / systemic** | Data that does not come back, a promise broken to a client, a system dead in flight | 0G · 10 (duration clause) · 22 · 23 · 26 · 30 |
| **Structural** | The architecture degrades — repairable, but expensive | 0A · 0B · 0D · 0E · 19 · 20 · 21 · 25 · 27 · 32 · 33 |
| **Convention** | A rename, a reformat, a rewritten commit message | 0 · 1 · 2 · 14 · 15 |

**Two situations where this matters, and only two:**

* **Two rules collide.** The higher tier wins, and **the arbitration is written down** — a
  genuine collision usually means one of the two rules is badly worded and needs fixing.
* **Time pressure forces a trade-off.** A convention can wait for the next commit. An
  irreversible rule never waits, and "we were in a hurry" is not a reason that exists here.

Outside those two cases, the tiers change nothing: you comply with all of them.

---

### Rule 0: Language & Collaboration Protocol
* **English for All Technical Assets**: 100% of source code, variable/function names, API schemas, JSON payloads, Git commit messages, branch names, technical specifications, and repository documentation (`README.md`, `RULES.md`, `ctx-universe.md`) MUST be written strictly in **English**.
* **French for Human-Agent Pair Programming**: All strategic discussions, planning sessions, architectural reflections, live brainstormings, and human interactions are conducted fluently in **French**.

---

### Rule 0A: Three Perimeters Taxonomy (P1 / P2 / P3)

Every component, package, brick, or app MUST be classified into **exactly one** perimeter before design or deploy. Canonical source: [`docs/PERIMETERS.md`](./docs/PERIMETERS.md).

| Perimeter | Objective | Examples |
| :--- | :--- | :--- |
| **P1 — Minimal socle** | Secrets, audit, auth, generic jobs, boot — zero business logic, zero mandatory LLM | `@shaper/pkg-vault`, `@shaper/pkg-logger`, `@shaper/pkg-auth`, `@shaper/pkg-queue`, `@shaper/pkg-db` |
| **P2 — Agentic** | Deterministic beats, bridges, operator cockpit (KovZu organism) | `@shaper/pkg-maestro`, `@shaper/pkg-mail-agent`, bridges, `brick-helm`, `@shaper/pkg-ged-engine`, `@shaper/pkg-rag` |
| **P3 — Business / client tools** | Persistent vertical apps **outside** P1+P2 — separate port, volume, lifecycle | `market-intelligence`, `enterprise-chat`, `univ-sinistre`, CRM POC |

* **Rule 0F alignment**: KovZu / Helm is **P2 only**. Client ERPs, scrapers, and scoped client chat are **P3** — never merged into the cockpit.
* **Test universes** (`UNIV7`, `UNIV8`, `UNIV9`) prove **P1+P2** — they are not P3 verticals.
* **Removed UI**: `/talk` and `/voice` redirect to `/console`. Operator voice STT/TTS inside `/console` remains **P2**.

---

### Rule 0B: Universal Parametric Genericity Invariant (Zero Hardcoding)
* **Everything Behaves as a Parameterized Function**: Every script, engine, deployment workflow, container blueprint, and documentation guide MUST be engineered as a pure, parametric abstraction that receives its parameters via CLI arguments, environment variables, or configuration manifests.
* **Multi-Infrastructure Portability**: All components must run interchangeably on Proxmox VE, LXD, raw KVM, standalone bare-metal Debian, or cloud VPS instances (Hetzner, OVH, Scaleway, AWS, home-lab) without modifying source code.
* **Zero Hardcoded Environment Residue**: Never hardcode specific IP addresses, hypervisor node names, private subnets, tenant domains, or static credentials into code, scripts, or specifications.
* **Mandatory Intent Header Classification (Generic vs Specific)**: Every `INTENT.md` or blueprint document in SHAPER OS MUST declare its exact classification at the very top header:
  * `> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)` for reusable abstract bricks in `SHAPER-OS/`.
  * `> **Intent Classification**: SPECIFIC INTENT (Universe: <univ_slug>)` for concrete instantiated deployments in experimental sandboxes or apps.
* **Strict Distinction: Abstract Specs vs Concrete Examples**: Technical documentation must always define abstract parameterized interfaces first (e.g. `<CLIENT_MESH_IP>`, `<GATEWAY_HOST>`, `<DOMAIN_NAME>`).
* **Explicit Demarcation of Specialized Examples**: Following any generic documentation, specialized real-world implementation examples (e.g. a specific Proxmox hypervisor, cloud node, or demonstrator) MAY be provided, but MUST ALWAYS be explicitly labeled under a dedicated section header: `### Illustrative Example (Non-Binding / Demonstration Only)`. There must be zero ambiguity between universal contracts and specific illustrative cases.

---

### Rule 0C: Declarative Agent-First Simplicity (High-Signal Intent)
* **Mandatory Declarative Standard**: All future system blueprints, container specifications, agent tasks, and workflow documentations in SHAPER OS MUST ALWAYS follow the **Pure Declarative Intent Format** (4-6 high-signal bullet points defining Invariants, Environment, Runtime, and Security) rather than verbose imperative code blocks.
* **Intent Over Boilerplate**: With modern autonomous AI agents, documentation must state the high-level intent, core invariants, and mandatory constraints clearly in plain language rather than drowning the reader in hundreds of lines of rigid low-level boilerplate.
* **The Justified Golden Snippet Exception**: While verbose boilerplate is forbidden, **including critical minimal code snippets or exact declarations is strictly permitted and encouraged when justified** (e.g. when days of research yielded a vital 2-line solution for LXC capabilities, WireGuard flags, or subtle configs). Alternatively, store companion code in dedicated `examples/` folders.
* **Dynamic Runtime Adaptability ("Dynamic in the Interpreted Sense")**: Architecture rules are protective guardrails, not rigid handcuffs. Systems and agents must adapt fluidly to runtime context (evaluating parameters dynamically like an interpreted engine) rather than hitting static compile-time walls.
* **Human as the Dynamic Compass**: The human operator provides live strategic direction and intent. The AI agent must maintain a matching dynamic mindset: adapting its execution path and tooling pragmatically to the human's guidance.
* **Minimalist Documentation Rule**: Keep documents lean, readable, high-signal, and focused strictly on the *What*, the *Why*, and the *Contract Invariants*. Less noise equals zero token waste, zero hallucinations, and maximum agility.

---

### Rule 0D: Dual Intent & Topology Manifest Protocol (INTENT.md + JSON)

SHAPER OS uses **two complementary layers** — never one replacing the other:

| Layer | File | Audience | Purpose |
| :--- | :--- | :--- | :--- |
| **Declarative Intent** | `INTENT.md` | Humans & AI agents | Philosophy, invariants, security boundaries, parameterized contract |
| **Topology Manifest** | `topology.json` (repo root) or local `deps.json` | Scripts, CI, agents, Quadlet tooling | Machine-readable dependency graph, boot order, ports, `requires` / `provides` |

* **INTENT.md is mandatory** for every `@shaper/*` package and every `brick-*` directory. It answers *What* and *Why*.
* **JSON manifests are mandatory at ecosystem level** via the canonical root file [`topology.json`](./topology.json). It answers *Who depends on Whom* and *In what order*.
* **Optional local `deps.json`** MAY exist inside a `packages/<name>/` or `bricks/brick-<name>/` directory when a component needs to declare overrides for a specific universe — but the root `topology.json` remains the master graph.
* **Zero duplication of philosophy in JSON**: JSON files MUST NOT repeat INTENT prose. They carry only structured fields: `id`, `type`, `requires`, `optional`, `provides`, `port`, `bootAfter`.
* **Agent-Synthesized Defaults**: Business rules and deploy details are **not** stored in `topology.json` unless a human explicitly requests an override. Silence = agent decides freely, as long as each brick `INTENT.md` invariants are respected.
* **Override Protocol**: When a human states a specific constraint (port, path, schema, dependency), add it to `topology.json` or a local `deps.json`. Never preemptively.
* **Validation**: Any `doctor`, bootstrap, or deploy script MUST read `topology.json` for ordering — never hardcode dependency chains in shell scripts. The validator CLI `scripts/shaper-deps.mjs` is **planned** (see [`docs/TOPOLOGY-INTENT.md`](./docs/TOPOLOGY-INTENT.md)); until it ships, validate manually against `topology.json` and package `imports`.

---

### Rule 0E: Materialization Pipeline (INTENT → Podman → Proof → Registry)

**Primary deployable unit**: `brick-<name>/` (INTENT + Podman image). A `packages/@shaper/*` NPM brick is **optional** — extract code only when it stabilizes or needs fast unit tests.

| Step | Who | What |
| :--- | :--- | :--- |
| 1. **INTENT** | Human | Declares objective + invariants (the law) |
| 2. **Materialize** | Agent | Builds Podman image + entrypoint (vibe-code). Silence = agent decides all unspecified details |
| 3. **Test** | Agent + Human | Unit (`node --test`) → contract (Podman alone) → integration (Podman + stack peers). Must pass before registry |
| 4. **Registry** | Human validates | Tag immutable image (`v1.x.y`), push to mesh registry. Prod never pulls floating `latest` |
| 5. **Deploy** | Quadlet | Pulls tagged image, boots per `topology.json` graph |

* **Trust model**: INTENT = law. Agent = creativity within the law. Tests = proof. Registry tag = frozen artifact you trust — not the agent's last run.
* **Package extraction**: `packages/` is a **stabilization artifact**, not a prerequisite to deploy. Start with INTENT + Podman; extract `@shaper/*` when reuse or test speed warrants it.
* **Machine-readable steps**: See `materializationPipeline` in [`topology.json`](./topology.json) for CI/doctor scripts.

---

### Rule 0F: Strict Distinction Between Operator Cockpit (KovZu / SHAPER-OS) and Client-Facing Tools

* **KovZu is the Operator & Sovereign Cockpit Only**:
  * The KovZu / Helm-v2 web console is strictly the **internal operating system cockpit** for the human administrator/operator, supervisor, and autonomous AI agents (OpenCode, Maestro, Zephir).
  * KovZu provides agent control, timelines, live audio orchestration, system logs, vault secrets, database engines, and universe administration.
* **Client Tools are Strictly Distinct Applications**:
  * Any client-facing software, vertical business portals, customer dashboards, mini-apps, external deliverable widgets, or end-user interfaces (e.g. `univ-sinistre`, `univ-immo`, customer tracking UI) MUST BE built, deployed, and served as **standalone, distinct applications/containers**.
  * Client tools MUST NEVER pollute, overload, or be merged into the KovZu operator console.
  * KovZu acts as the engine, API provider, and intelligence orchestrator behind the scenes, while client tools consume standard REST/SSE/WebSocket endpoints with their own distinct UX, authentication boundaries, and client branding.

---

### Rule 0G: Strict "NO FAKE, NO FALLBACK" Testing & Validation Invariant

* **Zero Simulation / Zero Mock in Integration Tests**:
  * Tests MUST NEVER simulate, fake, mock, or emulate real operations when validating system capabilities, container runtimes, APIs, or AI agent autonomy.
  * No mock servers, no synthetic HTTP stubs for core services, no dummy return values masquerading as real execution.
* **Real Environment Execution Only**:
  * Every test MUST hit the **real running services** (the real Vault AES encryption, the real Logger JSONL file on disk, the real Queue memory/redis, the real GED filesystem, the real Qdrant vector engine, the real Podman runtime).
  * If a command is tested (e.g. `podman run --rm alpine uname -a`), it MUST actually spin up the real container and return real kernel output.
* **Zero Silent Fallback / Fail Hard**:
  * Tests and test runners MUST NEVER silently swallow errors, fall back to simulated success, or catch exceptions just to output a green checkmark.
  * If a service or command fails, the test MUST fail hard, emit the exact raw error, and force a real architectural resolution.
* **Agent Self-Validation Contract**:
  * When the AI agent proves it can execute a task (e.g. configuring a mailbox in the Vault, querying the cluster, analyzing a document in `/data/ged/`), it must execute the real shell/API commands and verify the real state on disk / in memory. Fake results, invented numbers, or simulated completions are strictly forbidden.

---

### Rule 0H: Universal Interchangeable CLI Matrix & Human-Arbitrated Economics

* **All AI Agent CLIs Are Interchangeable Commodities**:
  * SHAPER OS is strictly agnostic to the underlying AI agent CLI (`opencode`, `cursor-cli`, `claude-code`, `codex`, `openrouter`, `ollama`).
  * The system decouples the intelligence engine from the orchestration fabric via standard Bridge interfaces (`/api/conversations/*`, SSE streams). Swapping an engine requires zero structural or architectural changes.
* **No Engine Is Named In This Canon**:
  * A rule that names a model expires with that model. The authority on engine
    selection is [`docs/architecture/COGNITION.md`](../docs/architecture/COGNITION.md): work declares the reasoning
    depth and throughput it requires, and the deployment measures which engines
    actually satisfy it **from the target host**.
  * Concrete engine names, versions and prices live in the **measured runtime
    matrix** produced at each deployment — never in a tracked rule, an INTENT, or
    a brick. Published benchmarks are advisory; measured availability decides.
* **Human-Governed Economic & Mission Arbitration**:
  * The choice of engine belongs to the **human operator**, adjusted according to
    budget, privacy and task complexity. The arbitration is expressed in **classes**,
    which outlive the products that populate them:
    * **Class F — Free / default bootstrap**: reachable at zero cost, no paid key. The default for routine administration, tests and orchestration.
    * **Class L — Local / air-gapped**: runs entirely inside the perimeter. Throughput is traded for sovereignty; a cloud fallback from this class is a violation, not a convenience.
    * **Class P — Paid, balanced**: commercial engines for fast professional iteration.
    * **Class E — Paid, frontier**: the deepest reasoning available, for high-stakes work that justifies its cost.
    * **Class A — Aggregator**: multi-provider routing across several of the above.
  * A class is a budget and a privacy posture, not a brand. Mapping a class to a
    concrete engine is a deployment-time decision, recorded with the measurement
    that justified it.
* **Bridge Compatibility Invariant**:
  * Every CLI runtime connects to the universal KovZu / Helm cockpit and receives identical context digests (`_kovzu/CONTEXT.md`, `topology.json`, persistent memory).

---

### Rule 0I: Pure IA-Driven Installation Doctrine (Zero Installer Monoliths / Pure Intent Synthesis)

* **Zero Rigid Installation Programs ("No Hardcoded Installers")**:
  * SHAPER OS strictly forbids writing monolithic, rigid installation programs, closed binaries, or brittle procedural shell wizards that assume fixed paths, hypervisor quirks, or rigid hardware layouts.
* **Everything Starts from Declarative INTENT**:
  * The human or architect declares the **INTENT** (`INTENT.md`, `topology.json`, security boundaries, required invariants).
* **The AI Agent Directly Fabricates and Shapes the Socle**:
  * Installation is a 100% **IA-Driven Process**: the autonomous AI agent (Antigravity at meta-level, or OpenCode / Zephir in-container) reads the declarative intent, probes the physical host and runtime limits (`cgroups`, RAM, disk, kernel version, existing packages), and **synthesizes, provisions, and configures the environment on the fly**.
* **Dynamic Synthesis Over Fragile Scripts**:
  * If a dependency is missing, the AI agent resolves and installs the exact right package for that specific OS runtime (`apt`, `apk`, `pip`, `npm`).
  * If an environment configuration or port needs adjustment, the AI agent adapts dynamically without failing compile-time checks.
  * **Summary**: The human sets the *What* and the *Why* (Intent); the AI agent dynamically constructs and validates the *How* (Materialization).

---

### Rule 0J: The Human Vibe-Coder & AI Agent Contract — Strict `.env` Verification, Key Propagation, and the Standard vs Freestyle Guarantee

* **Human Vibe-Coder & AI Agent Partnership**:
  * The human vibe-coder is the visionary project owner and sovereign director.
  * The AI agent is the meticulous technical co-pilot and strict executor.
* **Strict `.env` Pre-Flight Verification & Mandatory Halt**:
  * **Pre-Flight Inspection**: Before building images, launching containers (`podman-up.sh`), or running tests, the AI agent **MUST ALWAYS inspect the `.env`** (at repository root, `software/.env`, or universe directory).
  * **Zero Blind Execution**: The AI agent MUST NEVER start deployment blindly hoping secrets exist or using dummy placeholders that return 401s.
  * **Proactive Key Reclamation**: If any required secret (`VAULT_MASTER_KEY`, `JWT_SECRET`, `DEEPGRAM_API_KEY`, `GROQ_API_KEY`, Cloudflare tunnel token) is missing or empty, the AI agent **MUST HALT IMMEDIATELY**, explain which key is missing, provide the exact vendor signup/console URL, and wait for the human to paste it.
* **Multi-Podman Key Propagation**:
  * The AI agent is strictly responsible for copying and propagating the validated `.env` across all universe and Podman runtime directories (`software/.env`, `deploy/env`, `deploy/<univ_slug>.env`).
* **The "Standard vs Freestyle" Guarantee & Responsibility Matrix**:
  * **Standard Recipe ("La Sauce Robuste")**: When the human respects the checklist and provides a complete, valid `.env`, the entire Shaper OS deployment pipeline is guaranteed to be **100% deterministic, predictable, autonomous, and green from end to end**.
  * **Freestyle Mode ("Liberté Totale")**: The human user is 100% free to go freestyle, test with partial keys, run experimental stacks, or customize rules. However, managing degraded/inactive services in freestyle mode is the **user's full responsibility with their AI agent**. The core baseline cannot be considered failing if the standard formula was bypassed.

---

### Rule 0K: Inter-Container Token Synchronization, Anti-Silence Guarantee & Reborn Presentation Invariant

* **Deterministic Inter-Container Token Sync**:
  * **Priority to `.env`**: Whenever `podman-up.sh` runs, `OPENCODE_BRIDGE_TOKEN` or `CLI_BRIDGE_TOKEN` from `.env` MUST strictly overwrite any stale token on disk (`/root/.config/opencode-bridge/token`).
  * **Shared Auth Contract**: Helm, Bridge, Queue, and Maestro MUST strictly share the identical authentication token to eliminate `HTTP 502 Unauthorized` errors on control actions (`/reset`, `/clear`, `/stop`, `/inject`).
* **Anti-Silence & Guaranteed Final Response**:
  * **Zero Orphaned Runs**: In any bridge adapter (`opencode-bridge`, etc.), the `session.idle` event MUST NEVER emit an empty text payload.
  * **Error Surfacing**: If a tool or model aborts (`MessageAbortedError`, bash timeout, etc.), the error MUST be surfaced explicitly as the assistant's final text (`⚠️ Erreur outil...`).
  * **Fallback Conclusion**: If a session concludes without a text part, a default completion summary is automatically emitted so the UI bubble and Deepgram voice engine are never starved or hung.
* **Reborn (Session Prime) Invariant**:
  * **Clean Rebirth**: Triggering Reborn (via UI button or voice keyword « reborn ») MUST wipe previous conversation turns on the bridge, flush the local timeline, and immediately re-inject the official Presentation Briefing (*"Bonjour [Nom] ! Je suis Zephir..."*).
  * **UI Timeline Retention**: The UI MUST preserve the freshly returned Prime run without blanking out.
* **Mandatory Closed-Loop Test Validation**:
  * Any agent modifying a pipeline MUST execute that pipeline's own closed-loop
    test and confirm 100% success — a unit suite proves the parts, and only a
    closed loop proves that the parts still form a path.
  * **The test belongs to the brick, not to this rule.** Until V1.12 this rule
    named two scripts by path, `test-voice-player.mjs` and
    `test-e2e-business-flow.mjs`, which exercised Helm and the voice pipeline —
    a catalogue product the base does not ship. The base cannot keep a test for
    a brick it has no copy of, and it cannot stay right about one. The closed
    loop for `brick-helm` lives in the `SHAPER-OS-BRICKS` catalogue, beside it.

---

### Rule 1: Canonical Naming Conventions & the Universe Repo Grammar

*Amended in V1.13. The previous text demanded `univ-` on every repository "with
no exceptions" while the ecosystem's own base (`SHAPER-OS`) and catalogue
(`SHAPER-OS-BRICKS`) violated it from the first day. A rule the canon itself
cannot obey is a defect; the amendment names the real repo kinds instead.*

* **The universe class repo grammar**: `univ-<projet>-<classe>`, where
  **projet is ONE word, no hyphen** — everything after the first word is the
  class, which may be composite. One-line parse:
  `^univ-[a-z0-9]+(-[a-z0-9]+)+$`. A single-class project takes `-core`
  (`univ-mailo-core`): five characters against a future rename, settled.
* **The five repo kinds, exhaustively** — every git repository in the
  ecosystem is exactly one of these, and nothing else exists:

| Kind | Naming | Example |
| :--- | :--- | :--- |
| The base | `SHAPER-OS` (versioned folder/repo) | `SHAPER-OS-V1.13` |
| The catalogue | `SHAPER-OS-BRICKS` | `SHAPER-OS-BRICKS-V1.13` |
| A universe class | `univ-<projet>-<classe>` | `univ-boutik-shop` |
| A fork's catalogue | `<projet>-bricks` (Rule 33 forks only) | `fortex-bricks` |
| The fleet map | `<scope>-fleet` | `shaper-fleet`, `fortex-fleet` |

* **The mirror rule (Rule 33 forks)**: a fork swaps **only the projet word**
  and keeps every classe word, repo kind and file name verbatim
  (`univ-boutik-shop → univ-fortex-shop`). A fork costs zero new vocabulary,
  and `shaper verify` can hold it via the repo-level `forkedFrom`.
* **Classes have repos; instances never do.** An instance is a ledger row +
  a vault + volumes. Runtime instance names follow the triumvirate lifecycle
  (`<slug>-dev`, `<slug>-test`, `<slug>-prod`, Rule 36); the DNS-level
  instance grammar is `pkg-fleet-dns`'s contract.
* **Package and brick prefixes are unchanged**:

| Element Type | Scope / Layer | Canonical Naming Convention | Real-World Examples |
| :--- | :--- | :--- | :--- |
| Composable Logic Bricks | NPM Scope `@shaper/` | `@shaper/<brick>` | `@shaper/pkg-vault`, `@shaper/pkg-logger`, `@shaper/pkg-queue` (**P1**); `@shaper/pkg-maestro`, `@shaper/pkg-mail-agent`, bridges (**P2**) |
| Deployable bricks | OCI images | `brick-<name>` / `img-<name>` | `brick-vault`, `brick-forge`, `img-logger` |

* **Brick Isolation Invariant**: A `@shaper/*` package never has knowledge of the universe consuming it (zero coupling, 100% isolated unit test coverage).
* **The meta-rule this grammar serves**: *the identifier says WHAT a thing is;
  structured data (manifest, LINEAGE.md, ledger row, fleet.yml) says where it
  comes from and where it sits.* No slug ever encodes graph position,
  perimeter, or lineage — those live in data, so the graph can evolve without
  a rename (see Rule 37).

---

### Rule 2: Atomic Git Commits per Package & Feature, With Declared Authorship
* **Every commit produced with an agent names both parties.** The **human** is the
  commit author — they decided it — and the **agent** is named in a
  `Co-Authored-By` trailer with its engine and version. A repository whose entire
  doctrine rests on provenance cannot keep a history that hides who wrote what.
  * Shape: `Co-Authored-By: <engine and version> <noreply@vendor>`
  * Several agents on one commit: several trailers.
  * **No vendor is named here on purpose.** Listing two would read as the two
    sanctioned ones, and this canon names no engine (Rule 7). Write whichever
    engine actually wrote the change — that is the whole point of the trailer.
  * `NOTICE.md` already declares AI-assisted authorship for the kit as a whole.
    This is the same statement at the granularity where it is actually useful:
    the change.
* **Why it is a rule and not etiquette**: when a defect is found six months later,
  the first useful question is what produced it — a human decision, an agent
  derivation, or a misunderstanding between the two. An unsigned history answers
  none of them, and the answer cannot be reconstructed afterwards.
* **Enforced**: the repository suite fails on a commit that carries no agent
  trailer. It was added the day the operator noticed that some commits declared
  their agent and others did not — including, by accident, several of mine.
* Every time a LEGO brick, component, or package is updated and certified, execute an atomic commit immediately:
  ```bash
  git add <path> && git commit -m "feat(<scope>): descriptive commit message"
  ```
* Maintain a clean, linear, and verifiable commit history on `origin/master`.

---

### Rule 3: Proactive Podman Images & Quadlets Management
* Whenever software or configuration changes impact a container:
  1. Rebuild the corresponding Podman image.
  2. Push / tag the image to **the machine's registry** — an infrastructure
     prerequisite, one per machine, asked of the operator and never invented
     (`SHAPER_REGISTRY`, RUNBOOK step 0b).
  3. Reload Quadlets via Systemd: `systemctl daemon-reload && systemctl restart <service>`.

  ### Illustrative Example (Non-Binding / Demonstration Only)
  A mesh deployment may name its registry `10.87.78.3:5000`. That address is
  one deployment's value, never this canon's — Rule 0B forbids a hardcoded IP
  outside a header exactly like this one, and until V1.13.1 this rule carried
  it bare (beta finding H8).

---

### Rule 4: Standard Turbinobash Layout & On-Demand Database Isolation
* **Plesk-like CLI Hosting Heritage**: SHAPER OS inherits the battle-tested, sovereign hosting philosophy of **Turbinobash (`tb`)**—a lightweight, CLI-first alternative to bloated control panels (like Plesk or cPanel) providing zero-friction app deployment, reverse-proxying, user isolation, and automated database provisioning.
* **Official Turbinobash Documentation & Repositories**:
  * Core Hosting Engine: [https://github.com/xavdp-pro/turbinobash-web](https://github.com/xavdp-pro/turbinobash-web)
  * LXC & Containers Module: [https://github.com/xavdp-pro/turbinobash-web-lx](https://github.com/xavdp-pro/turbinobash-web-lx)
* **Standard Turbinobash File Structure (`/apps/<slug>/`)**: Every deployed application or service brick adheres strictly to the canonical Turbinobash filesystem hierarchy — **same spirit under Podman**: persist what must survive in bind-mounted volumes, never mix cache with backups:
  ```
  /apps/<slug>/          # or <univ>/ for a Podman universe
  ├── app/               # Code (git) — not a substitute for volume backup
  ├── etc/mysql/localhost/passwd
  ├── log/               # Append-only JSONL
  ├── sav/               # Persistent volumes (bind-mounted into Podman) — MUST be backed up
  └── nosav/             # Cache, node_modules, image layers, bulky regenerable files — EXCLUDED from backups
  ```
* **On-Demand Isolated Database Convention (`user = database = slug`)**:
  * **On-Demand Only**: A container or service instantiates a MariaDB database **strictly if and only if it requires relational state storage**.
  * **Strict Isolation Invariant**: Whenever a database is required, it must follow `user = database = <slug>`. No shared default credentials.
  * **Password Resolution Order**:
    1. Primary source of truth: read directly from `/apps/<slug>/etc/mysql/localhost/passwd`.
    2. Fallback (Dev / CI testing): read from `process.env.MYSQL_PASSWORD`.
* **Continuous Architectural Traceability**: Document every architectural choice with *What* (concise description) and *Why* (business rationale).

---

### Rule 5: 100% Native Unit & Contract Tests (node --test)
* 100% test pass rate required prior to any staging or production deployment.
* Zero external bloated testing frameworks; use the native Node.js test runner (`node --test test/*.test.js`).
* Cold-boot execution time under 2000ms.

---

### Rule 6: Targeted Agent Bootstrapping (Token Optimization & Zero Idle Waste)
* Every AI agent is bootstrapped with an isolated, targeted context file (`ctx-universe.md`).
* Never re-inject entire system rulebooks into execution prompts; send only the short delta/instruction.
* Leverage prompt caching, local deterministic idempotence checkpoints (`checkpoint.json`), and zero token consumption when idle.

---

<a id="rule-7"></a>
### Rule 7: Engine Defaults Are Measured, Never Declared
* **No default model is written in this canon.** The rule that used to live here
  named specific models and their flags; every one of them aged, and the canon
  aged with them. A default that must be edited when a vendor ships a new version
  is not a rule, it is a cache.
* **What is binding instead**:
  * Each brick declares the cognition its work requires — capacity class, depth
    `D0`–`D4`, throughput `T0`–`T3`, degradation policy — in its `INTENT.md`
    ([`docs/architecture/COGNITION.md`](../docs/architecture/COGNITION.md)).
  * At every deployment the agent enumerates the engines actually reachable from
    the target host, sends a bounded ping, measures, and selects the **cheapest
    engine that satisfies the declared depth and throughput**.
  * **Cost and performance are two cursors, reconciled by fact and by
    declaration — never by a hidden formula.** *(Amended after the first
    production deployment: the operator observed that the most performant
    engine is sometimes cheap and sometimes not — a single hard-coded
    "cheapest wins" policy encodes an arbitration the law has no right to
    make.)* The procedure:
    1. **The contract eliminates.** An engine that fails the declared depth,
       throughput or correctness probe is out at any price.
    2. **Dominance eliminates.** An engine both more expensive AND less
       performant than another measured engine is discarded — that is a fact,
       not a policy. What remains is the frontier, where every choice is
       legitimate.
    3. **The universe declares its cursor** (`enginePolicy` in its manifest;
       absent means `frugal`):
       `frugal` — the cheapest engine on the frontier. Dominance makes it
       automatically the fastest of the cheapest, so free-tier ties resolve
       to measured speed, as before.
       `swift` — the most performant engine on the frontier; for voice and
       real-time universes, where a slow engine is useless at any price.
       `budget: <max cost per task>` — the most performant engine under a
       ceiling the operator declares. The number comes from the operator,
       never from this canon: a weighting constant invented here would be an
       unmeasured figure, and Rule 10 forbids those.
    **The probe is the contract.** An engine is measured on the shape of the
    work the universe will ask of it — for the base, write-a-file-then-reply,
    never a bare echo: an engine has passed the ping and then hung on the
    real task, answering generic text once stopped (v1.13.17 sealing run).
    Performance is **measured from the target host** — correctness on a
    bounded probe and observed latency/throughput — never a figure read from
    a vendor page or a public ranking. Published speed has already been wrong
    here: the fastest model on paper timed out twice from inside an LXC while
    a slower one did the work.
  * **The measurement is part of the deployment, not a preliminary.** An engine
    adopted without a recorded ping is an undocumented dependency, even when it
    answers: a healthy bridge proves the bridge, never the model behind it.
  * The selected engine, its measurement and the moment of measurement are
    written to the deployment log. **An engine chosen without a recorded
    measurement is an undocumented dependency** and fails Rule 0G.
* **Execution flags** belong to the bridge that wraps the CLI (Rule 34), declared
  and pinned in its image — not in this canon.
* **Ultra-fast engines** remain reserved for acknowledgment and voice micro-tasks
  and are never exposed as general agent chat models (Rule 0H, Rule 0K).

---

### Rule 8: Universal Agent Container Contract
Every containerized AI agent must satisfy four core HTTP endpoints:
1. `GET /api/health` — Service readiness & DB connection.
2. `POST /api/inject` — Dynamic context ingestion (`ctx-universe.md`).
3. `GET /api/events` — Real-time Server-Sent Events (SSE) stream.
4. `GET /api/metrics` — JSONL structured event logging & latency tracking.

---

### Rule 9: Strict Mailbox Isolation (Test/Dev vs Prod)
* All IMAP synchronization, categorization, and message testing must strictly target dedicated test mailboxes.
* Absolute protection against data corruption or unintended message operations in production.
* Centralized AES-256 encrypted credential storage in `vault-engine`.

---

<a id="rule-10"></a>
### Rule 10: The Universe Triumvirat & Cold-Boot PRA (three clocks)
Every business universe `<slug>` operates across three strictly decoupled lifecycle stages:
1. `univ-<slug>-dev`: Fast prototyping and vibe-coding on the `dev` branch.
2. `univ-<slug>-test` (or `univ-test1`, `univ-test2`, `univ-testX` in parallel):
   - **The real PRA test is strictly FROM SCRATCH**: blank LXC container, WireGuard split-mesh attachment, Podman stack boot, Vault injection, and 100% test execution.
   - **From scratch includes the images** *(V1.13.7)*: a TEST universe sets `SHAPER_FORCE_REBUILD=1` and builds every image from source. Reusing what the registry already serves is right when operating (Rule 0E) and hollow when proving — it turns a clean-sheet run into a claim about a build nobody performed (Rule 0G, Pillar 1 *creation ex nihilo*). The slow clock is the measurement, not an obstacle.
   - **Mandatory Destroy-After-Test Rule**: Once the test cycle is verified, the ephemeral test container **MUST BE DESTROYED** (`pct destroy <vmid>` or `lxc delete --force`) to guarantee zero residue and prove continuous cold recovery.
3. `univ-<slug>-prod`: Initialized once, then atomic hot-updated via Git release tags (`v1.x.y`) and Quadlet reloads without service disruption.

**PRA duration — three clocks (do not quote “&lt; 120s” alone):**

| Clock | Condition | Duration |
| :--- | :--- | :--- |
| **1** | Podman images already in **our registry / local cache** | **Fast** stack deploy (this is the short clock) |
| **2** | Images **rebuilt or pulled from zero** (no cache) | **Longer** — build/pull + start |
| **3** | Plus **data restore** | A **delta** proportional to volume (`sav/`, DB dumps, GED, files) |

Never tell a client or write in this repo that restore is “under 120 seconds” without stating which clock. The historical “&lt; 120s” figure was a **target for core start when images are cached**, not a blank-host SLA, and **not including data**. LXC/`apt` provisioning is extra on every clock.

* **Zero Duration Figure — Say "fast and structured", Never a Number**:
  * No document, pitch, README, doctrine page, or client-facing sentence in this repository states a restore or cold-boot duration — **not even to dismiss it**. A number quoted in order to be refuted still gets lifted out of its paragraph and quoted back as a promise.
  * The sanctioned formulation is qualitative: **restore is fast and structured**. *Fast* because nothing has to be reinvented — the fractal pattern is identical at every level and the bricks are already built. *Structured* because it always follows the same deterministic order (encrypted socle → orchestration → restitution), with zero hidden state and zero manual step.
  * The reason no figure is given is itself part of the message: the delay depends on cached vs rebuilt images, on host provisioning, and above all on **the volume of data to put back** — which has nothing in common between an empty TEST universe and years of production.
  * **Single exception**: a measured observation inside an operational log or deployment note, which MUST state its exact conditions (cache state, data volume, what is excluded) and MUST be explicitly labelled as an observation, never an engagement.
  * We promise the method. Never the stopwatch.

---

<a id="rule-11"></a>
### Rule 11: Two Levels of Containment, and Only Two

* **LXC is the universe. Podman is the brick. There is no third level.**
  A universe is a *system* container — its own init, its own filesystem, its own
  package set — because that is what can be snapshotted, exported and restored as
  one thing. A brick is an *application* container built from an immutable image.
  Podman inside podman works, and has been verified to work three levels deep;
  it is forbidden anyway, because it adds an image store and a namespace layer
  without adding a boundary this architecture uses, and it moves the universe's
  largest state — the image store — into the one layer podman cannot back up as
  a whole. Depth comes from nesting **universes**, never from nesting runtimes.

* **Three host families, one contract.** The host provides a nesting-capable
  container; how it is created is the host's business, and a document that
  covers only one family MUST say which in its first paragraph. Each family
  has ONE token: it is the `kind` of a machine in the fleet map
  (`docs/architecture/FLEET.md`) and the prefix of the maker's frozen recipes
  (`<kind>-<work>.sh`, `software/universes/_maker-template/`). The token is
  the only spelling of the family, everywhere.
  * **`proxmox` — a Proxmox node** — `pct create`, and `features: nesting=1,keyctl=1` in
    `/etc/pve/lxc/<ID>.conf`. Verify the Debian 13 template is present
    (`pveam list local`) before creating anything.
  * **`lxd` — Debian/Ubuntu with native LXC/LXD** — `lxc launch`, profile `podman-univ`:
    `security.nesting`, `security.privileged`,
    `linux.kernel_modules: overlay,nf_nat,ip_tables,ip6_tables,fuse,tun`.
  * **`liblxc` — Debian with plain LXC** (the `lxc-*` tools over the library,
    no LXD daemon; amended 2 September 2026, maker-and-governor verdict, D2).
    The same three concerns as the `lxd` family — nesting, the privilege
    model, the host modules — spelled in the container's `config` instead of
    a profile, and with an unprivileged idmap where the `lxd` profile runs
    privileged: nesting
    (`lxc.include = /usr/share/lxc/config/nesting.conf`, and the AppArmor
    profile that allows it), an **unprivileged idmap** (`lxc.idmap = u 0
    <subuid> 65536` / `g …`, the ranges granted in `/etc/subuid` and
    `/etc/subgid`), and the same host modules loaded
    (`overlay,nf_nat,ip_tables,ip6_tables,fuse,tun`). The exact lines are
    fixed by the first `liblxc-stamp.sh`, proven on terrain before it ships
    (`recipes/README.md`): this rule names the family's contract, not the
    recipe. **The token is `liblxc`, never `lxc`**: `lxc` is the name of LXD's
    client binary, the very command the `lxd` recipes call — a family named
    `lxc` would read as the other family's command, on every page and in
    every recipe name.
  * **A bare host with none of the three** — the agent halts and asks. Installing a
    hypervisor is an architecture decision (storage backend, pool size, bridge,
    firewall), not a package install, and a host may be bare on purpose. The
    agent states exactly which commands the human should run, and stops.

* **Presence of a tool is not proof of a capability.** An agent declares a host
  fit to carry a universe only after launching a throwaway nested container and
  running a container inside it — the same proof for the three families:
  `lxc launch`, `pct create` or `lxc-create`/`lxc-start` for the throwaway,
  and a podman container born inside it, observed. `lxc` being installed
  says nothing about whether podman runs inside it; podman being installed
  says nothing about whether a `RUN` step will execute — on one workstation
  every build failed at `RUN` because the session bus carried no systemd,
  which no inventory of binaries would ever have revealed. An agent that
  lists binaries manufactures confidence; an agent that launches and
  observes produces a verdict.

* **First boot, inside the container**: `apt-get update && apt-get dist-upgrade
  -y && apt-get clean`, then inject `skel/etc/{bash.bashrc,inputrc}`. Host kernel
  modules are loaded via `/etc/modules-load.d/lxc-podman.conf`.

* **Field lessons (proven in production, 1 September 2026).** The first night
  this rule ran for real — two universes rebuilt as podman bricks, one complete
  birth measured end to end — is recorded in
  [`docs/proof/proof-rule-11-in-production.md`](../docs/proof/proof-rule-11-in-production.md).
  Four of what it found are constraints of this rule; each is held by a test
  that names its anchor.

  <a id="rule-11-nftables-inside-the-universe"></a>
  * **nftables is part of the universe's first boot.** Podman's nested
    network (netavark) programs the firewall through nftables; without it the
    first container with a network dies with an error that names neither
    nftables nor nesting. Every provisioner and every literal install line
    inside the LXC installs `nftables` beside `podman`. A universe that does
    not carry it is not fit to hold a brick, whatever `podman --version`
    says (see *Presence of a tool is not proof of a capability*).

  <a id="rule-11-read-profiles-with-config-show"></a>
  * **A profile is read from the applied configuration, never from
    `lxc info`.** `lxc info` lists no profile; an idempotence check built on it
    passed every time and the next run tried to add a profile already present
    (`Duplicate profile found`). `lxc config show <ct>` (or `lxc profile show`)
    lists what is applied; on Proxmox the analogue is `pct config <vmid>`.
    A check whose condition can never be true is not a check.

  <a id="rule-11-nesting-needs-a-restart"></a>
  * **Nesting does not apply to a running container.** `lxc config set <ct>
    security.nesting=true` (or a profile added, or `pct set --features`) on a
    launched container takes effect only after `lxc restart` (`pct reboot`).
    Until that restart the container behaves as if it had no nesting, and
    the symptom to expect is the one the LXC guide documents for that case
    (`Permission denied` on the first image) — so a script that sets nesting
    on an existing container restarts it in the same breath, and a profile
    is given at launch whenever it can be.

  <a id="rule-11-declared-ports-are-free"></a>
  * **A declared port is a claim on the whole universe.** Bricks run with
    `--network host` so that `localhost` stays valid across the universe;
    the price is that a port the manifest declares is a port nothing else in
    the LXC may hold. A container born before this rule still carried an
    apt-installed MariaDB on 3306; the podman brick crash-looped and the only
    place the cause was visible was the brick's own journal. Before a deploy,
    the manifest's ports are compared with the sockets already listening
    (`ss -ltn`, or `/proc/net/tcp`), and a held port is a halt that names the
    port and its holder. What holds it is stopped and disabled by the human,
    never worked around with a second port. The one holder that is not a
    defect is the universe's own brick left running by a previous deploy —
    `podman-up.sh` replaces it by design — and the gate tells the two apart
    by the running containers' names, never by the process alone.

* **What is restored, and what is merely rebuilt.** A universe's restorable
  identity is its `manifest.json`, its `cfg-image-lock.json` and its volumes.
  Images are never backed up: they are rebuilt from source at the recorded
  commit, or pulled by the digest the lock names. A backup containing images is
  backing up a derivative, and hiding that the original may no longer be
  reproducible. Restoration ends with the universe's own `deploy/proof.sh` — a
  restore nobody proved is a claim (Rule 33).

---

<a id="rule-12"></a>
### Rule 12: Secure Archive Distribution & Cold Recovery
* All archive transfers (`PROJECT.tar.bz2`, `REMOTE.tar.bz2`) must follow:
  * Multi-threaded compression (`pbzip2` or `tar -cjf`).
  * Zero directory listing (`autoindex off`).
  * Mandatory HTTP Basic Auth (`auth_basic` with hashed credentials).
  * End-to-end TLS encryption via Cloudflare Tunnel.
* **What a backup archive never contains, and what it never lies about** *(V1.13)*:
  * **The key that opens the coffer does not travel with the coffer.** A backup
    carries `data/vault/vault.enc`; it never carries `.env`, because `.env` holds
    `VAULT_MASTER_KEY`, and an archive holding both is the vault in clear text
    for whoever holds the archive. The key is restored from the operator's own
    key material (`KEYS-AND-ACCOUNTS.md`), never from a backup. Until V1.13
    `backup-local.sh` put both in the same tarball.
  * **The backup's encryption key is its own key.** `PRA_ENCRYPTION_KEY` is
    generated for backups and for nothing else; it is required, and it is
    refused when it equals `VAULT_MASTER_KEY`. A backup encrypted with the
    vault's master key hands the vault's key to whoever breaks one backup.
    The key reaches `openssl` through the environment (`-pass env:`), never as
    a command-line argument readable by every process on the host — the same
    rule as a database password, which travels in `MYSQL_PWD`, never as `-p`.
  * **A dump that was not taken is announced, never written empty.** The
    client is `mariadb-dump`, or `mysqldump` where only that one exists — a
    script that knows one name dumps nothing on the other host. A dump with no
    client, or no database declared for the universe, prints `SKIP` and says
    why; a dump whose client fails, or whose output is empty, fails the backup.
    `2>/dev/null || true` on a dump is a zero-byte `.sql` archived as the
    database.
  * **The archive command's failure is the backup's failure.** A `tar` that
    ends in `|| true` followed by `{"status":"ok"}` is a report about a file
    nobody checked. The status line is printed after the archive exists, has a
    size and has a checksum, or it is not printed.
  * **A failure after the archive is complete keeps the archive.** Cleanup
    on exit removes a partial archive, never a complete one that has been
    announced: a rotation that cannot run is a failure, reported over an
    archive that stays — "Backup created" on the log and an empty directory
    on disk is a data loss caused by housekeeping.
  * **A dump that failed leaves nothing behind.** The dump is written under
    a `.part` name and renamed only once it has a size; a client that dies
    half-way leaves no `.sql` for the next snapshot to archive as the
    database. A partial file left on disk is the empty-dump defect moved one
    run later.
  * **`.env` in every spelling.** `.env`, `.env.local`, `.env.<slug>`,
    `deploy/env`, `<slug>.env` — Rule 0J propagates the same key under all of
    them, and the exclusion is `.env*` and `*.env`, never the bare name.
  * **How the script calls the client is proven with a recorder.** The
    guard tests run the real scripts, the real `tar` and the real `openssl`
    against a throwaway layout; the one substitute is a recorder standing in
    for `mariadb-dump`/`mysqldump` on a PATH built from scratch, because what
    is under test is the call — which client name, where the password
    travels, what a failing or empty client does to the backup — and not
    what MariaDB answers. What MariaDB answers is the live test's business
    (Rule 0G), and the recorder never stands in for it there.

---

### Rule 13: Hybrid WireGuard Private Mesh Network & Mandatory Peer Naming
* All distributed nodes (universe hosts, cloud VPS, bare-metal Proxmox) join the private encrypted mesh:
  * Central gateway on subnet `10.87.78.0/24` (or configured mesh subnet).
  * Dynamic peer key registration.
  * Persistent keepalive (`PersistentKeepalive = 25`) for firewall/NAT traversal.
* **Mandatory Human-Readable Peer Comments**: Because raw WireGuard only uses cryptographic hashes, every AI agent or engineer registering a peer on the gateway (`wg0.conf`) MUST ALWAYS precede the `[Peer]` block with an explicit comment tag:
  ```ini
  ### Client <hostname> (CT <vmid> on <host>)
  [Peer]
  PublicKey = <CLIENT_PUBLIC_KEY>
  AllowedIPs = <CLIENT_MESH_IP>/32
  ```
  Anonymous or untagged peer blocks are strictly prohibited to ensure instant auditability and DNS mapping.

---

### Rule 14: Efficient Podman Vision Containers (vision-neko)
* **Priority to Blind Mode (0 LLM Tokens / 5ms)**: Use deterministic X11 commands (`neko-desk control <deskId> launch|paste|key|exec`) for standard application launching and document conversions.
* **Multimodal Visual Mode via MCP (`neko-desk`)**: Use screenshots and cursor actions only when interacting with legacy graphical interfaces lacking programmatic APIs.

---

### Rule 15: Media Art Direction & Industrial Realism
* Natural warm sunlight, healthy green vegetation, genuine professional expressions, and dual representation of human operators and sustainable infrastructure.

---

<a id="rule-16"></a>
### Rule 16: Multi-level backup (container → files tar.bz2 → database → git → S3)
This set is **enough**. Missing a level is a hole. Same idea as turbinobash-web (`tb app sudo/backup` + `/var/sav1/`) — **adapted to Podman / Shaper OS**.

| Level | What | How (Shaper / Podman spirit) |
| :--- | :--- | :--- |
| **1. Infra — entire container** | The LXC/CT (or VM) as a whole | Host snapshot (`vzdump` / ZFS / Proxmox). Recovers the machine, not a substitute for inner levels. |
| **2. Files — persistent volumes** | Only what must survive a recreate | Archive **Podman bind-mounts** (`<univ>/sav/*`, `/data/<slug>/` persistent volumes) as **`tar.bz2`** (pbzip2), like turbinobash app backups. **Exclude `nosav/`**, caches, image layers, `node_modules`. |
| **3. Database** | Relational / vector state, consistent | `mariadb-dump` — the official MariaDB image ships `mariadb` and `mariadb-dump`, not `mysql` and `mysqldump`; a script falls back to `mysqldump` only where that name still exists (proven on terrain, 1 September 2026: two calls in one file disagreed on the name before they were made to agree). Plus Qdrant snapshot, JSONL rotate if needed. Do not rely on a live volume tar alone for a crash-consistent DB. |
| **4. Git** | Code and architecture | Immutable tagged repo. Never treat git as a data backup. |
| **5. S3 / R2** | Off-site copy of 2+3 (and optionally 1) | Encrypted archives (AES-256-GCM), cold bucket (Cloudflare R2 / Glacier-class). Copies **the tar.bz2 and dumps**, not a second git clone pretending to be backup. |

**Files (level 2) are the volumes, not the overlay.** Recreating the Podman container from a tagged image + restoring `sav/*.tar.bz2` + DB dump **is** the inner restore. Level 1 is the outer safety net (CT gone). With 1–5 together, PCA/PRA data path is covered.

Rule 12 (archive hygiene: no autoindex, basic auth, TLS) applies to any `tar.bz2` that leaves the host.

---

### Rule 17: Mandatory TTS Phonetic Dictionary, Acronym Expansion & Fine Word Karaoke
* **Universal TTS Text Normalization (`ttsFormat.js`)**: When text is dispatched to the AI TTS synthesizer (Deepgram Aura, Cartesia, ElevenLabs), all text MUST be formatted via `formatTextForTts(text, locale)`:
  * **Acronym Expansion**: Technical acronyms (`API`, `SQL`, `GED`, `URL`, `SSH`, `HTTP`, `HTTPS`, `CSV`, `PDF`, `TTS`, `STT`, `LLM`, `IA`, `UI`, `UX`, `OS`, `RAM`, `CPU`, `DB`, `IP`, `CLI`, `JSON`, `SDK`, `DNS`, etc.) are converted to hyphenated letters (`A-P-I`, `S-Q-L`, `G-E-D`, `C-S-V`, `J-S-O-N`) to force clean, natural letter-by-letter pronunciation instead of garbled phonetics.
  * **Markdown & Artifact Stripping for Voice**: Code blocks (`` ``` ``), inline backticks, image links (`![...]`), raw markdown URLs, and emotion tags (`[calm]`, `[excited]`) are cleanly stripped from the spoken audio pipeline while preserving full rich markdown in the written chat bubble.
  * **Locale Symbol Expansion**: Symbols like `%`, `&`, `@`, `+` are expanded into their natural locale equivalents (`pour cent`, `et`, `arobase`).
* **Strict Fine-Grained Word-by-Word Karaoke Invariant**:
  * **Zero Giant Block Highlighting**: Surlignage by entire sentences/paragraphs (`grain: 'sentence'`) is strictly forbidden. The player and markdown viewer MUST always enforce fine word granularity (`grain: 'word'`).
  * **Clock-Synchronized Word Weighting**: For streaming providers without native word timestamps (e.g. Deepgram Aura), timings are computed via `estimateKaraokeWords` based on word length and punctuation weight, dynamically rescaled against actual PCM playback duration.
  * **Fluid Visual Reading**: In `MarkdownContent.jsx` and `InlineKaraokeText.jsx`, only the exact word currently being spoken (`activeIndex`) is illuminated in real-time, providing a smooth, realistic, and responsive reading experience.

---

### Rule 18: Primary Admin Account Onboarding Protocol (Zero Unsolicited Dummy Users)
* **Explicit Human Prompting Upon Setup Completion**: Whenever an AI agent or deployer completes the bootstrap and health checks of a new SHAPER OS / Helm universe:
  1. The agent MUST explicitly ask the human operator for their desired primary Admin credentials:
     * Preferred **Email address** (e.g. `xavier@xavdp.pro` or custom).
     * **First Name / Display Name** (e.g. `Xavier`).
     * Secure **Password**.
  2. The agent MUST NOT leave unverified, dummy, or hardcoded mock users in the system database.
  3. The agent provisions the account in MariaDB (`users` table) with `role: 'admin'`, seeds their dedicated workspace directory (`/data/opencode-ws/<User>`), generates the sovereign `CONTEXT.md`, and confirms the login URL to the human.
* **Zero Legacy Demo Clutter**: Demo guest accounts from older sandboxes (such as `ivonne`) are strictly prohibited in the default base source code, registries, and production instances.

---

### Rule 19: Dual Semantic Register & The Toggle Law (Zero Jargon in Simple Mode)
* **Two Abstraction Levels for Every Output**:
  * **Simple Mode (Décideur / Business User)**: Natural language focused strictly on actions, results, and deliverables (e.g. *"Bilan Dupont généré et classé dans la GED"*). Internal system jargon (`P1`, `P2`, `P3`, `Maestro`, `KovZu`, `Podman`, `Redis`, `Tokens`, `Endpoints`) is strictly banned. Allowed positive anchor words: *Souveraineté, Autonomie, Sur-mesure, Livrable, Sécurisé, Validé*.
  * **Technical Mode (CTO / Developer)**: Full observability, job IDs, execution trees, HTTP status codes, queue metrics, and JSONL log streams.
* **Structural Contract, Not Just Vocabulary**: Avoiding jargon is necessary but not sufficient. Every Simple Mode restitution MUST answer three questions in order: (1) *what was done*, (2) *what artefact it produced and where it is*, (3) *what decision, if any, is expected from the human*. A message that respects the word ban but leaves the reader unable to act violates this rule.

---

### Rule 20: Typed Closed-Loop Quality Gate (Verification Before Delivery)
* **Pre-Delivery Verification by Livrable Type**:
  * No job or generated output can transition to status `COMPLETED` in `@shaper/pkg-queue` without passing its typed verification contract:
    * **Code & Scripts**: Native unit test suite (`node --test`), linter, ephemeral sandbox.
    * **Documents & Spreadsheets (PDF, XLSX, DOCX)**: Schema validation, mandatory metadata presence, arithmetic consistency checks (e.g. Totals HT + VAT = TTC).
    * **Data & Imports (CSV, JSON)**: Column typing, primary key uniqueness, provenance validation.
    * **System Actions & External Dispatch**: Payload schema check, dry-run simulation when supported.
  * In case of failure, the job transitions to self-correction or alerts the operator with explicit machine-verifiable diagnostics.
* **Isolation Is Required by the Contract Type, Not by the Rule**: an ephemeral sandbox exists to contain **execution**, so it is mandatory only where the verification actually runs the artefact — the `code` contract. Documents, data and actions are verified by schema, arithmetic, typing and provenance checks, which execute nothing untrusted and therefore run in the verifying process itself. Demanding a container for those buys no safety and costs privilege, deployment weight and latency. A brick that only produces documents must not be granted runtime access in the name of this rule.
* **No Untyped Deliverable**: A job whose output type has no declared verification contract MUST NOT be silently marked `COMPLETED`. It is held in `NEEDS_CONTRACT` and escalated to the human, who declares the contract once — thereafter it is reusable for that type. Rule 0G applies: an absent contract is never a reason to pass.
* **Activation Is Staged, and the Gap Is Declared**: strict refusal is enabled per universe with `QUALITY_GATE_ENFORCE=1` and belongs to the **hardening phase**, not to build-out. Until a universe enables it, the gate records `NEEDS_CONTRACT` and lets the job through. This is a **declared temporary state, not the target behaviour** — writing it down here is what keeps the canon honest while the product is being articulated. No universe serving a real client ships with the gate off.

---

### Rule 21: Distributed Multi-Agent Delegation Matrix (Abstract Capacity Classes)
* **Abstract Capacity Classes (Vendor-Agnostic)**:
  * Maestro is an orchestrator, supervisor, and auditor; it NEVER executes heavy transformation code directly.
  * **`heavy-engineering`**: High-reasoning architecture, multi-file refactoring, autonomous code generation.
  * **`rapid-iteration-ui`**: Interactive GUI components and visual refinement.
  * **`infra-ops`**: Vulnerability scans, system administration, container orchestration.
  * **`fast-eval`**: Streaming acknowledgments, low-latency text classification.
  * *The concrete mapping from capacity classes to actual execution engines (e.g. CLI agents, local ONNX models, bridge daemons) is declared in `manifest.json` and can be changed without modifying the doctrine.*
* **Human-in-the-Loop Classes Are Not Auto-Dispatchable**: A capacity class whose engine requires a human at the keyboard (interactive IDE) is declared `interactive: true` in the manifest. Maestro never auto-dispatches to it; it queues the task as `AWAITING_HUMAN` and notifies the operator. Autonomous classes and interactive classes are never mixed in one dispatch decision.

---

### Rule 22: Automatic Semantic Memory Ingestion & Multi-Tenant Vector Isolation (RAG)
* **Continuous Passive Knowledge Capitalization**:
  * Any validated file deposited in `/data/ged` emits an asynchronous event that triggers automatic chunking and vector embedding into Qdrant using a sovereign local model (`all-MiniLM-L6-v2` via ONNX).
  * **No silent degradation**: if the sovereign embedding model is unavailable, ingestion fails loudly and the document is queued as `PENDING_EMBED`. A lexical or hash-based placeholder vector MUST NEVER be written into a semantic collection (Rule 0G).
* **Strict Multi-Tenant Isolation**:
  * Each Universe owns its isolated Qdrant collection. An agent can only query its own vector namespace.
  * Parent Supervisor universes only consume aggregated metrics and structured summaries; they NEVER access raw child vector collections directly.

---

### Rule 23: External Healing Law (Parent Repairs Child)
* **Zero Self-Destructive In-Flight Modification**:
  * An AI agent NEVER modifies its own active infrastructure files, its bridge server, or its running process during execution (scie la branche sur laquelle il est assis).
  * Any structural repair, recovery, or update on an Agent of Level $K$ is MANDATORILY performed by the Parent Supervisor Agent of Level $K+1$ (or by the human operator) operating out-of-band at cold boot.

---

### Rule 24: Root Guardian Law (Sentinel / Human Repairs Root)
* **Out-of-Band Root Supervision**:
  * For the Root Universe of a fractal tree (Level $N$, with no parent in the tree), integrity monitoring and emergency patching are performed by a **Sentinel Sidecar Agent** or by the **Human Operator using an external IDE (Cursor, Antigravity, Claude Code)** via an isolated control channel.

---

### Rule 25: Canary Deployment & Downward Rollback (Anti-Propagation)
* **Progressive Fleet Updates**:
  * Whenever a Parent Universe distributes a configuration or brick update to its child fleet:
    1. **Canary (1/N)**: Deploy to 1 pilot child universe only.
    2. **Observation Period**: Monitor logs and health for $T$ minutes (bake time, default 5 min).
    3. **Phased Rollout**: If the canary passes its gate → deploy to 10%, then 100% of the fleet.
    4. **Automatic Rollback**: At the first failure on the canary, immediately roll back without touching the rest of the fleet.
* **The Canary Gate Is the Typed Gate (R20), Not the Health Port**:
  * A `200 OK` on `/api/health` is a liveness signal, never a validation signal. A canary is declared green only when it has produced at least one real deliverable of its universe's nominal type **and that deliverable passed its Rule 20 typed verification contract**.
  * Bake time without a produced-and-verified deliverable does not count as green: the rollout stops and escalates rather than proceeding blind.

---

### Rule 26: Complete Database Isolation (MariaDB per Universe)
* **Zero Domino Effect on Data**:
  * To guarantee total blast radius isolation, each Universe operates its own isolated MariaDB database/instance.
  * The Central SaaS database holds exclusively the node inventory registry and global billing data.

---

### Rule 27: Reconciliation Convergence Guard (Anti-Flapping & Terminal Degraded State)
* **A Reconciliation Loop That Cannot Give Up Is a Storm Generator**: The Maestro reconciliation engine (desired `manifest.json` ↔ observed `sav/state/observed-state.json`) MUST bound its own corrective action.
  * **Exponential Backoff**: Repair attempts on the same drift signature back off (e.g. 30s → 1m → 2m → 4m), never retry at fixed beat cadence.
  * **Bounded Attempts**: After `maxHealingAttempts` (default 5) on the same drift signature, the supervisor STOPS attempting repair.
  * **Terminal `DEGRADED` State**: The child universe is marked `DEGRADED` in the parent registry, its drift signature and last diagnostic are recorded, and the human operator is alerted. `DEGRADED` is a resting state, not a retry state — it never self-clears.
  * **How a `DEGRADED` row is left** (amended 2 September 2026, maker-and-governor verdict, with Rule 37's ledger): a DEGRADED row leaves that state by its account's explicit new ask, for the environments a robot may end (`dev`, `test`, `demo`) — the broken row's deadline becomes now, a maker reaps whatever half-exists and reports `REAPED`, and a fresh row is born beside it; the broken one was a failure the account was stuck behind, not a life to protect. A **`prod`** row leaves it only by human or Root Guardian action: a robot's re-ask is refused as a typed fact carrying the row id, no twin is born, and the reap recipe refuses to end a production universe (exit 4, reported `REAP_REFUSED` — a fact, not a failure) so that the row rests and the alarm leaves out of band. The same bounds apply to the governor's own offers: a reap that failed is offered again under exponential backoff and never beyond `maxHealingAttempts`; a reap that was refused is never offered again.
  * **Fleet-Wide Circuit Breaker**: If more than 20% of a fleet enters `DEGRADED` within one bake window, the parent suspends ALL reconciliation and rollout activity on that fleet and escalates. A systemic fault must never be amplified N times.
* **The Escalation Channel Is Declared, Never Assumed**: "Alert the operator" is meaningless until the channel exists. Each universe declares its `alerting` channel in `manifest.json` — mobile push, mail, Telegram, or an existing prod-alerting relay. The channel depends on what is being watched and is decided case by case; the doctrine imposes only the contract:
  * It reaches a **human out-of-band** — never a UI nobody is looking at.
  * It is **tested at deploy time** like any other brick: an unverified alert path is an absent alert path (Rule 0G).
  * A universe with no declared channel MUST NOT be promoted beyond DEV.
* **Rationale**: Without these bounds, one invalid manifest on a 50-child fleet produces 50 simultaneous restart loops — the reconciliation engine becomes the outage.

---

### Rule 28: Sovereign WAF Rule Validation (No Unproven Guardian)
* **An AI-Generated Allow-List Is a Hypothesis, Not a Defence**: The sovereign WAF/aiguilleur allow-list is synthesized by the parent agent that knows the application's legitimate routes. It is therefore an artefact like any other and falls under Rule 20.
  * **Mandatory Attack Corpus**: Before any WAF ruleset reaches production, it MUST pass a versioned attack corpus stored in the repository — at minimum: SQLi, XSS, path traversal (`../`), verb violation on a `GET`-only route, and rate-limit saturation.
  * **Mandatory Legitimate Corpus**: The same ruleset MUST let through a versioned corpus of legitimate business requests. A WAF that blocks real customers is an outage, not a protection.
  * **No Silent Rule Drift**: Any regeneration of the allow-list re-runs both corpora and is deployed to the fleet under Rule 25 (canary first).
* **Scope Discipline**: The sovereign layer's uncontested role is **routing** (aiguillage universe → container) and **precomputed cache serving**. Generic attack signature filtering SHOULD delegate to a maintained engine (OWASP CRS via Coraza / ModSecurity) rather than being reimplemented; the doctrine forbids presenting a hand-rolled signature filter as equivalent protection.

---

---

### Rule 29: Constructive Integrity (Every Fixed Bug Becomes a Test)
* **The System Grows a Memory of Its Own Failures**: Any resolved defect — in code, in a manifest, in a WAF rule, in an agent prompt — MANDATORILY gives birth to a new non-regression test committed alongside the fix.
* **No Fix Without Proof**: A patch whose accompanying test would still pass on the unpatched code does not demonstrate anything and is rejected.
* **A Correction Lives Where It Survives**: A defect met while deploying or operating a universe is corrected in the **generic path** — the brick, the package, the template, the example deploy script — never only in the universe where it appeared. Its test is placed where it will still run after that universe is gone.
  * **Why this is a rule and not advice**: a `-test` universe is destroyed by Rule 10, and a `-dev` one is disposable by design. A fix written into an instance is deleted with the instance, and the next clean sheet meets the same wall having learnt nothing. This is not hypothetical: the v1.7 clean-sheet verdict records *missing Queue persistence directory* among its corrections, that correction was written into `univ-v17-test`'s own deploy script, and four days later the v1.8 clean-sheet deployment stopped on the identical defect.
  * **The test decides where the fix belongs**: if the non-regression test would disappear with a universe, the fix is in the wrong place. Move both.
  * **A universe may still specialise**: this forbids *correcting* in an instance, not *parameterising* one. When a defect is genuinely specific to one deployment, say so in that universe's INTENT and explain why the generic path is right as it stands.
* **Antifragility Contract**: This is what makes the fractal tree antifragile rather than merely resilient — each incident permanently raises the floor for every universe instantiated afterwards. That floor only rises where the correction outlives the universe that found it.

---

### Rule 30: Snapshot Before Migration (Data-Bearing Changes Are Not Canary-able)
* **Why This Rule Is Separate from Rule 25**: The canary protects against a bad configuration, because a configuration can be rolled back. A database migration **carries data**: rolling back the code does not bring back a dropped column. Progressive rollout is necessary here but not sufficient.
* **The Non-Negotiable Sequence**:
  1. **Full snapshot first** — the universe's MariaDB dump plus its `sav/` volumes, taken immediately before the change, never a nightly backup "close enough".
  2. **Verified restore** — the snapshot is restored into an ephemeral sandbox and proven loadable. An unverified backup is not a backup (Rule 0G).
  3. **Only then** apply the migration, canary first per Rule 25.
  4. **Rollback = restore the snapshot**, not "run the reverse script".
* **Preferred Refinement (Expand / Contract)**: where feasible, make the change non-destructive in stages — add the new column, write to both, migrate readers, and only drop the old column in a later release once every universe in the fleet is confirmed migrated. Destructive and reversible steps never travel in the same deployment.
* **Fleet Scope**: a schema change across N per-universe databases (Rule 26) is N migrations, each with its own snapshot. One shared migration transaction across the fleet is forbidden — it would recreate the common point of failure Rule 26 exists to remove.

---

### Rule 31: Declared Data Lifecycle (Per Universe, Not a Universal Policy)
* **The Doctrine Forces the Declaration, Not the Policy**: retention and erasure requirements depend entirely on the client and the use case. A personal mail-processing robot needs none; a universe holding a client's customer records needs a documented one. Imposing a single global policy would be wrong in both directions.
* **Every Universe Declares Its `dataLifecycle` in `manifest.json`**, with at minimum:
  * `personalData`: `true` / `false` — does this universe hold data about identifiable people?
  * `retention`: duration or `unlimited`, per data class (GED documents, JSONL logs, vector collections, database rows).
  * `onTermination`: what is destroyed, what is exported to the client, and in what format, when the universe is decommissioned.
* **`personalData: false` Is a Valid and Common Answer** — but it must be written down, not left silent. Silence is not a declaration.
* **Erasure Is Fractal**: deleting a client's data means deleting it in every store of that universe — MariaDB rows, `sav/` volumes, GED files, **and its Qdrant collection**. A vector left behind is a leak; the isolation of Rule 22 is what makes this deletion tractable in the first place.

---

### Rule 32: The Perfected Generic Base Comes Before Any Specialisation (Founding Method)
* **How work is framed here, and it is not negotiable**: for each thing we build, we first **delimit a perimeter**, then we make what sits inside it **excellent, generic, extensible and open to what comes next** — a base that will interact with other systems we have not met yet. Business specifics are built *on top of it*, never *into it*.
* **Why it is the founding logic, not a preference**: this is what makes the four promised properties true rather than claimed. A base that is perfected once is **adaptable** (bricks swap instead of being rebuilt), **scalable** (behaviour does not change with volume), **alive** (it improves without a new project), and **multidimensional** (several things advance in parallel). And it is what makes the architecture genuinely **fractal**: the pattern is only worth repeating if the pattern is good.
* **The economic argument is explicit**: time spent perfecting the base is not time lost, it is time bought back on every project that follows. A specific requirement then costs an adaptation, not a rebuild — and often costs nothing at all because the base already covers it.
* **Binding consequences**:
  1. **No client requirement is ever written into a generic brick.** It goes into a P3 application or a declared handler. A brick that carries one client's particularity has stopped being a base.
  2. **A base is finished when it is boring** — when the next specific need is met by configuration and a handler, not by editing it.
  3. **Elasticity is part of "generic"**: the same brick must run modestly on a small VPS and hold up on a large server, by parameter and never by fork. A brick that only works at one scale is not a base.
  4. **When a specialisation forces a change to the base**, that change must be made *generic* before being merged — the particular case reveals a missing capability, it does not authorise a special case.
* **Applies to every agent working on this repository.** Delivering a working specific feature by contaminating a generic brick is a regression, not a delivery, however green the tests are.
* **The total vision is what dictates the steps on the base bricks.** A brick is never perfected in the abstract, against an imagined future — it is perfected **against the whole picture of where the project is going**. Holding the complete vision is what tells us which capability the base must carry, which one it must not, and in what order to build them. This is why the doctrine is written before the code: not as ceremony, but because the map is what turns "make it generic" into a list of concrete steps. An agent that has not read the vision cannot decide what belongs in a base.
* **A stray specific bit is not a catastrophe.** If something slightly specific slips into a brick, the sky does not fall: the day a *more* specific need arrives, we meet that same code again and generalise it then. What must hold is that **the broad lines cover a good part of the perimeter** — enough that we can walk into a client situation and discover the rest from a working base, not from nothing. Perfectionism that blocks delivery is not this rule.
* **The level of exigence is set per thing and per moment.** Not everything deserves the same rigour at the same time, and pretending otherwise stalls the work. Each brick is made robust *at its own level of exigence*, decided by the human. The exigence of the current moment is what governs — today, a robust document pipeline.
* **Why full conformity matters where it does**: it is what guarantees that the bases we already have are conform, functional, and **deploy at will**. Conformity is not decoration, it is what makes redeployment boring.
* **Current sequencing — demonstrate the craft first.** Build-out comes before governance: we show that the wand is handled well, then we add the regulatory and hardening layers on a base that already works. This is not a licence to cut corners on the base — it is the opposite, since the base is precisely what is being demonstrated. What it does defer is everything *around* it: data governance, cost models, compliance. Those are listed with their reopening triggers in `doctrine/README.md`, never dropped silently.

---

### Rule 33: The Client Fractal Fork (Assumed Divergence, Never Contamination)
* **The mechanism**: when a client's needs require it, we take the base bricks and **fork the whole solution fractally** for that client. The fork diverges from the original creation, and **that divergence is assumed** — it is the fruit of shaping something for a real need, not an accident to be repaired.
* **Why this does not contradict Rule 32**: Rule 32 forbids putting a client's particularity **inside a shared generic brick**. Rule 33 authorises **a separate branch of the tree** for that client. The base stays clean for everyone; the client gets exactly what they need. This is precisely what the fractal architecture exists to make possible — a branch has the shape of the tree without being the tree.
* **When to fork, and when not to**:
  * **Do not fork** for a small business need. An artisan's CRM is met with base bricks, a P3 application and declared handlers. Forking there would be paying a permanent cost for a temporary difference.
  * **Fork** when a client imposes requirements that reach into the socle itself — strict security posture, role systems, information compartmentation, regulatory constraints. Those cannot live as a configuration flag on everyone else's base.
* **Obligations of a fork**:
  1. It states **what it diverged from** — the base version it was cut at — and **why**. A fork whose origin is unknown cannot be maintained.
  2. It stays inside the law: forking the solution never means abandoning `RULES.md`.
  3. **A generic improvement discovered in a fork travels back to the base.** The particular case revealed a missing capability (Rule 32); the fork keeps its particularity, the base gains the capability.
* **Security posture arrives with the client that demands it.** Total-paranoia mode — hardened roles, compartmentation, audited surfaces — is applied on the fork of the client who requires it, not imposed on every base from the start. Security work genuinely slows build-out; doing the preliminary work first is what buys back the time to then focus on paranoia, on effective interfaces, and on what survives in production.

---

### Rule 34: A Bridge Ships Everything Its CLI Needs (Prerequisites Are Declared, Pinned and Proven)

A bridge exists to run a command-line agent. A bridge whose CLI **cannot start** answers `ok` on `/api/health` and does nothing — the most expensive failure shape there is, because everything downstream believes it.

* **The image carries the prerequisites, not the operator's memory.** Every runtime dependency of the CLI — interpreter, shell, fonts, language data, system libraries — belongs in the brick's image and is **pinned**. If a CLI needs something absent, it is the brick's duty to install it, declared in its `INTENT.md`. An operator who must remember to install something by hand has been handed a landmine.

* **A prerequisite is proven, never assumed.** The brick's health must establish that the CLI is **executable**, by running its own version command, not that a path was configured. `which` proves a string; running proves a binary. An image that only builds or only runs on some machines is not an artefact you can tag (Rule 0E).

* **Three traps that cost a session each, and are now law:**
  1. **Never mount a symlink into a container.** It arrives pointing at a path that does not exist there. Mount the resolved target.
  2. **Never mount a launcher without its siblings.** Modern CLIs ship as a small script that executes files beside it; mount the whole version directory or nothing.
  3. **Never assume the base image has a shell.** A launcher beginning `#!/usr/bin/env bash` fails on Alpine with `can't execute 'bash'`, and the exit code will not say so plainly.

* **A CLI may be bound to its host, and that is a finding, not a defect.** Verified on `agy`: identical credentials, identical model, identical moment — succeeds on the host, refused as quota-exhausted inside a container. When a CLI cannot be containerised, its bridge **runs on the host** and the universe points at it. The universe declares the address; it never assumes the address is inside itself.

* **What a bridge must publish about its CLI**: the binary it resolved, the version it obtained by running it, and whether authentication is present. `stubMode` must be visible and must never be the silent default — a simulated bridge that looks live is a lie with a long fuse.


---

### Rule 35: Experience Corrects the Intent, Not Only the Code (Constructive Integrity, Upstream)

Rule 29 requires that every bug resolved gives birth to a regression test. That protects the code. It does not protect the **next universe**, which is built from `INTENT.md` and not from our test suite.

* **A problem experienced updates the brick's `INTENT.md`.** Not a changelog of incidents — the *invariant the incident revealed*, stated as the brick's intent so anyone materialising it again starts from what we learned. A fix that lives only in code is a lesson one refactor away from being lost.

* **Write the constraint, not the anecdote.** "A missing CLI is a state, not a crash" belongs in the intent. "On 23 August the cursor bridge died" does not; it belongs in the commit that fixed it.

* **The test proves it today, the intent carries it forward.** Both are required, and they are not substitutes: a test constrains this implementation, an intent constrains every future one.

* **When a rule and the code disagree, the code is what changes** — unless the rule itself was found wrong, in which case it is amended deliberately, never quietly softened to match what was built (see `CONVERGENCE-STATE.md`).

---

<a id="rule-36"></a>
### Rule 36: Fractal SSH Authority & Ephemeral Sandbox Access Law (Clean-Sheet Dev/Test Promotion)

* **Parent Authority Over Child Lifecycle**: To supervise, develop, and test improvements on a child universe without risking production, the Parent Universe ($K+1$) has the explicit authority to instantiate, access, and destroy child environments ($K$). An agent never mutates its own vital organs in-flight (Rule 23); its supervisor operates the lifecycle.
* **Cryptographic SSH Asymmetry**:
  * The Parent generates an **Ed25519 SSH authority key pair** stored in its Vault or `sav/ssh/id_ed25519`. The private key **never** leaves the Parent.
  * When an ephemeral child container is provisioned, the bootstrap mechanism automatically appends the Parent's public key (`id_ed25519.pub`) into `/root/.ssh/authorized_keys`.
* **Dynamic Suffix & Environment Separation**:
  * **`*-prod` (Nominal)**: Permanent production universe, dedicated port base (e.g. `9200`), persistent encrypted `sav/`, production DNS/tunnel (`app.example.com`).
  * **`*-dev` (Ephemeral Dev)**: Sandbox for active coding and prompt tuning, offset port base (e.g. `9300`), scratch storage, dev DNS/tunnel (`app-dev.example.com`).
  * **`*-test` (Clean-Sheet Validation)**: Rebuilt **from scratch** on a blank container to eliminate caching artifacts. Runs 100% unit tests + Rule 29 regression test + Rule 20 typed deliverable on test DNS/tunnel (`app-test.example.com`).
* **Canary Promotion & Garbage Collection**:
  * Once the clean-sheet `-test` container passes 100% green, the git commit/tag is promoted to production via the canary protocol (Rule 25).
  * Immediately after promotion, the Parent executes complete destruction (`podman rm -f` / `lxc delete`) of the `-dev` and `-test` containers, releasing all ports, memory, and scratch volumes (Universe Garbage Collector).
* **The maker is the Parent's hand** (amended 2 September 2026, maker-and-governor verdict): in the fractal of Rule 11, the level $K+1$ of an instance is its **governor and the makers that governor enrolled** — the tandem, root from underneath, brought each maker into being and declared it (the maker template's invariant 7). The authority this rule grants — to instantiate, access and destroy a child — is held by the **maker organ of that level**, in its vault, on the one machine it acts on: never by the governor, which writes rows and holds no key to any host, and **it never leaves the level** — no private key crosses down into a child, none climbs up into a ledger. The Parent's public key reaches a child through the stamp recipe, as a file, never as a command built from the row. Birth and end (`lxc launch` / `lxc delete`, `pct create` / `pct destroy`) are the maker's gestures on a ledger row; the garbage collection above is the same gesture, driven by the row's deadline. The host's own SSH door is the tandem's, from underneath; it is not the maker's, and the maker holds no inbound door of its own.


---

<a id="rule-37"></a>
### Rule 37: The Tree Speaks (Lexicon Closure, Manifest Lineage Fields & the Fleet Map)

*Born in V1.13 from the ZEST convergence: five project archetypes were designed
independently against the same grammar, then judged by three adversarial
critics. The grammar held at every scale; every failure was a synonym. This
rule is what killed the synonyms, and it keeps them dead.*

* **Three manifest fields carry all lineage — never the slug**:
  * `perimeter`: `P1` | `P2` | `P3`, **mandatory on every declared brick**.
    Perimeter means **LAYER, never OWNER** — a client-specific brick can be P1.
  * `source`: `base` | `catalogue` | `fork` | `native`, mandatory.
    `native` = a P3 brick scaffolded inside the class repo (the
    `shaper-tool-scaffold` path); `fork` = inherited from a standard brick and
    specialised.
  * `forkedFrom`: `{ "package": "@shaper/pkg-x", "atVersion": "x.y.z" }` —
    **mandatory when `source` is `fork`**, forbidden otherwise. A Rule 33 fork
    repo additionally declares repo-level lineage in its manifest root:
    `"forkedFrom": { "repo": "<upstream>", "atTag": "vX.Y.Z" }` — this is what
    lets `shaper verify` enforce the mirror rule by machine.
* **One state machine, one set of names, everywhere**:
  `DESIRED → RECONCILING → PURRING → DEGRADED`, plus the terminal `REAPED`
  (amended 2 September 2026, maker-and-governor verdict: five states, the
  ones `pkg-governor` has always held).
  * **PURRING** is the healthy state, and it is **dated**: the universe writes
    it to its `status.json` on every on-time beat when observed == desired.
    Silence is ambiguous between "fine" and "dead and unable to say so"; a
    stale `lastPurr` timestamp is the alarm. `running`, `green`, `OK` and
    every other synonym are forbidden as state words.
  * **drift** is the ONLY word for observed != desired, and the only repair
    trigger. Rule 27 governs the repair ladder and the resting `DEGRADED`.
  * **DEGRADED** rests; it never self-clears. It is left in two ways only
    (Rule 27): by its account's explicit new ask, for the environments a
    robot may end (`dev`, `test`, `demo`) — the broken row's deadline
    becomes now, a maker reaps whatever half-exists, a fresh row is born —
    or, for a `prod` row, by human or Root Guardian action alone.
  * **REAPED** is the end: a maker ended the universe on the row's deadline
    and looked (the reap recipe verifies the absence, it does not assume
    it), or a human ended it. Terminal, and dated by its event. *Prevents*:
    a reaped row still counted as living — its account blocked forever
    behind a slot nothing frees, its matrix pinned by a reference no
    instance holds. A state word for "ended" that did not exist was read
    as "still there".
  * `status.json` (per instance: state, lastPurr, lastBackup) is the canonical
    surface; every board, cockpit tile or STATE file is a rendering of it,
    never a rival.
* **The ledger is the only instance store**: one row per instance, in the
  governing universe's database (Rule 26). The row (amended 2 September
  2026, maker-and-governor verdict): `id`, `account`, `klass`, `matrix`,
  `digest`, `machine`, `env`, `state`, `params`, `deadlineAt`, `createdAt`,
  `updatedAt`, `events[]`. What changed from the first reading (class, tag,
  machine, env, state, bucket), and why: `tag` became `matrix` + `digest`,
  because an instance is born from an artefact, not from a repo tag — five
  builds of one commit are five fingerprints, and the digest is what the
  maker proves it holds; `bucket` is derivable (`r2://<id>`) and never
  stored; `id` was missing while the instance's name derives from it;
  `account` is who asked, and with `klass` it is the idempotence key (one
  live row per account and class); `deadlineAt` is the only clock a robot
  reads — a row past it yields reap work, never a timer inside a robot;
  `params` is the typed slot a recipe reads (a flat object of scalars under
  an allow-list the product declares per class; immutable on a living row,
  like its digest; carried to the recipe as `SHAPER_PARAM_<KEY>` on an
  environment the maker builds, never as argv); `events[]` are the dated
  facts makers reported, from which every transition is derived by one
  table. `env` ranks `dev`, `test`, `demo`, `prod`: the first three are
  environments a robot may end; `demo` is what a row carries when it names
  none, and it is not production. **The canonical ledger contract ships
  with `pkg-governor` (BINDING**: `software/packages/pkg-governor/INTENT.md`,
  its `STATES`, its `EVENT_TRANSITIONS` and its work kinds — stamp, reap,
  validate, adopt); it no longer waits for `brick-forge`, which never
  carried it. A standalone universe governs itself: its ledger lives in its
  own database — which means a standalone class that will hold its own
  ledger takes the `+data` profile option (the default `agent` profile
  carries no database brick). The package's JSONL journal is its reference
  adapter, not the database this rule names: the gap is recorded in
  `doctrine/CONVERGENCE-STATE.md` until a governor binds its own.
  "placement" survives only as the name of the machine-assignment column.
  Tag precedence: **fleet.yml = the default for new instances and the PRA
  floor; the ledger row = the truth, which may lag during a canary; an audit
  task reconciles them.**
* **The fleet map**: one tiny repo (`<scope>-fleet`) holding one `fleet.yml` —
  base, catalogue and every class repo pinned to an **immutable tag**
  (Rule 0E), plus the `machines:` inventory. Instances NEVER appear in it;
  R2 buckets are derivable (`r2://<instance-id>`), never enumerated. `-dev`
  bypasses the fleet map by law; `-test` and `-prod` are guarded by it: a
  universe repo not registered in its fleet map is refused promotion. A
  sovereign fork (Rule 33) keeps its own mirrored fleet map — a client's PRA
  never hinges on the vendor's repo.
* **Lexicon closure**: the vocabulary of this architecture is the prefix table
  (Rule 1, canonical in `docs/architecture/NAMING.md`) plus sixteen words —
  class, instance, ledger, drift, PURRING (and its state machine), status.json,
  board, fleet map, forge, forkedFrom, the mirror rule, source/perimeter, and,
  by the amendment of 2 September 2026 (maker-and-governor verdict, §10),
  governor, maker, matrix, REAPED. A new noun enters only by amending this
  rule, with the failure it prevents written beside it — as here:
  * **governor** — the universe that holds a ledger and makes it respected:
    it writes what should exist, dates what makers report, and never dials
    out. *Prevents*: "the SaaS" and "the manager" naming two things — the
    product and the organ — and the maker learning which one it serves.
  * **maker** — the hand of a machine, one per machine: it asks its governor
    what should exist on its host, runs a frozen recipe with typed
    positions, reports a fact, never decides. *Prevents*: a script on a host
    whose state nobody knows, and a form field reaching a shell.
  * **matrix** — the locked, content-addressed artefact (sha256) from which
    instances are stamped; baked by the tandem from a class, never by a
    robot. *Prevents*: "image" meaning both a podman image and a universe
    archive, and five builds of one commit giving five fingerprints.
  * **REAPED** — the fifth, terminal state, above. *Prevents*: a reaped row
    still counted as living, blocking its account and pinning its matrix.
  What does not enter: `stamp`, `reap`, `validate`, `adopt` — kinds of work,
  a table in `pkg-governor`, not nouns of the language. New bricks are not
  new nouns — `brick-forge`, `brick-scraper`, `brick-sso` are the prefix
  system doing its job. The forge's line is bounded by the same amendment:
  `brick-forge` deploys, destroys and repairs BRICKS inside a living universe
  (the podman level; drift at brick level); universes are born and ended by
  the maker, from a ledger row (the LXC level; the gap at instance level).
* **What it protects**: a human juggling several vibecoded projects and a cold
  agent landing in a repo must both answer, from one page — *where is the
  truth?* (the ledger) — *who repairs?* (the forge, on drift, inside a
  universe) — *who births?* (the maker, from a row) — *is everything fine?*
  (the board, rendering status.json) — *how is it all recreated?* (the fleet
  map + R2, Rule 16). A vocabulary that cannot fit on one page has already
  failed them both. `docs/architecture/LEXICON.md` is that page, and the test
  `lexicon-and-code-agree.test.js` holds it, this rule and `pkg-governor`'s
  states to one set of names.
