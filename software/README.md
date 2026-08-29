# SHAPER OS V1.13

> **Sovereign, Fractal, and Autonomous Infrastructure for AI Agents**

---

## 🧭 SHAPER OS — 5 Levels of Understanding

### Level 1 — Everyone
SHAPER OS allows computer systems to operate more autonomously.

It gives AI agents an environment in which they can observe what is happening, execute tasks, detect problems, and, whenever possible, solve them without human intervention.

The human retains control whenever an action exceeds what the system is authorized to do.

---

### Level 2 — Technical User
SHAPER OS transforms an infrastructure into a collection of autonomous spaces called **"universes"**.

Each universe possesses its own services, agents, rules, dependencies, and context.

It can execute background workloads asynchronously, monitor its own state, produce structured logs, and notify a human whenever a strategic decision is required.

The infrastructure is described primarily through intentions and conventions, then materialized automatically.

---

### Level 3 — Developer / DevOps
SHAPER OS is a **declarative orchestration layer** for agentic environments.

An architecture is described by its topology, dependencies, capabilities, and deployment rules.

SHAPER then materializes this intention into executable services, manages their boot order, lifecycle, processing queues, observability, and automated validation.

Code progressively becomes the materialization of an architecture described in intentions, rather than the starting point of the system.

---

### Level 4 — Architect
SHAPER OS introduces a discrete unit of execution and responsibility called a **"universe"**.

A universe has an explicit perimeter, context, resources, dependencies, and operational responsibility.

Its agent can observe and repair its own perimeter whenever the action remains within its authority level.

When an intervention exceeds this perimeter, it is escalated to the **parent universe**.

The parent can then instantiate an ephemeral development or test environment, perform or delegate the repair, verify the outcome, and promote the validated version.

Security, dependencies, networking, observability, and lifecycle thus become explicit, first-class properties of the universe.

---

### Level 5 — SHAPER Vision
SHAPER OS is a **fractal architecture** for building multi-level autonomous agentic systems.

A universe can contain other universes and apply the exact same mechanisms to each of them.

Each level possesses its own responsibility, context, capabilities, and authority boundaries.

A system can thus be constructed recursively:

$$\text{Brick} \longrightarrow \text{Universe} \longrightarrow \text{Parent Universe} \longrightarrow \text{Host} \longrightarrow \text{Fleet}$$

governed by the same continuous cycle:

$$\text{intention} \longrightarrow \text{materialization} \longrightarrow \text{execution} \longrightarrow \text{observation} \longrightarrow \text{proof} \longrightarrow \text{repair} \longrightarrow \text{validation} \longrightarrow \text{promotion}$$

The goal is no longer merely having an AI write lines of code.

The goal is to allow an infrastructure to **understand its architecture, execute its intentions, observe its state, maintain itself, and escalate decisions** it is not authorized to make alone.

SHAPER OS thus shifts infrastructure from a model where humans manually program and administer every component, to a model where humans define intentions, rules, and responsibilities, while autonomous agents operate the system within the explicit boundaries granted to them.

---

## 🛍️ SHAPER OS — Example of a Fractal SaaS for Managing Client Applications

### Level 1 — The Idea in One Sentence
Imagine a SaaS capable of **automatically managing client applications**, whatever technology each of them happens to run on.

Each application has its own environment and dedicated AI agent, capable of observing it, performing tasks, reporting issues, and resolving problems autonomously whenever possible.

---

### Level 2 — The Client
A business owner runs one line of business on one application.

They want to be able to request:
> *"Update my product catalog."*  
> *"Analyze recent checkout errors."*  
> *"Redesign this landing page."*  
> *"Find out why order processing is lagging."*  
> *"Prepare and stage the next version of the website."*

That universe's agent understands its local environment, conventions, tools, and operational history.

It performs actions that fall within its granted authority.

If an operation is too significant or potentially risky, it is escalated to the superior level.

The store owner never has to manage low-level technical plumbing directly.

---

### Level 3 — Managing Multiple Stores
The same client may own 10, 50, or 500 stores.

A **Store Management Universe (Parent Universe)** is created.

This parent universe does not micromanage every detail of every store directly.

Instead, it supervises its child universes:

```text
Store Manager Universe (Parent)
│
├── Store Universe A (Child)
├── Store Universe B (Child)
├── Store Universe C (Child)
├── Store Universe D (Child)
└── ...
```

Each store remains fully autonomous:
It holds its own context, agents, services, and isolated environment.

The manager observes their aggregate health, receives their alerts, and intervenes cold whenever a problem exceeds the child's local responsibility.

---

### Level 4 — The SaaS Platform Itself
Now imagine commercializing this system to multiple clients.

We have multiple clients, and each client operates multiple stores.

The SaaS platform operates a higher-level universe capable of managing its clients' universes:

```text
SHAPER SaaS Platform (Grandparent)
│
├── Client A Universe
│   ├── Child universe #1
│   ├── Child universe #2
│   └── Child universe #3
│
├── Client B Universe
│   ├── Child universe #1
│   └── Child universe #2
│
└── Client C Universe
    ├── Child universe #1
    ├── Child universe #2
    └── Child universe #3
```

This is where the **fractal nature** emerges:
* The mechanism used to manage a single universe is the same mechanism used to manage a cluster of them.
* The mechanism used to manage a client is the same mechanism used to manage the entire SaaS platform.
* The structure repeats identically across every level.

---

### Level 5 — The SHAPER Abstraction
Critically, SHAPER does not depend on the underlying technology powering each child universe — which is exactly why the base repository names none of them.

A child universe can run a packaged product, a bespoke in-house application, or a technology that does not exist yet. The base does not know, and must not: the brick that knows lives in the catalogue, and the universe that assembles it declares it in its own manifest.

What changes is the **universe specialization**.

The governance and responsibility contract remains invariant:

```text
Universe
│
├── context
├── rules
├── capabilities
├── dependencies
├── agents
├── services
├── observability
└── responsibility perimeter
```

* A universe built on a packaged product carries that product's CLI and runtime.
* A universe built on a hosted service carries the bridge that talks to its API.
* A universe built on bespoke code carries its own dedicated bridges and microservices.

Each of those specialisations is a **catalogue** brick. None of them is named in
the base, because the base would then have to be right about a product it does
not ship.

**SHAPER provides the common foundation; the universe provides the specialization.**

---

### The Fundamental Consequence

We do not build one fragmented system per technology:
* Not a system for a packaged product,
* Plus a system for a hosted service,
* Plus a system for bespoke code,
* Plus a system for whatever comes next.

We build **a single universal universe model capable of hosting and orchestrating all of them.**

This allows adding intermediate organizational tiers seamlessly:

```text
SaaS Platform
│
├── Enterprise Client
│   │
│   ├── Regional Brand Group
│   │   │
│   │   ├── Individual Child Universe
│   │   │   ├── Business brick (from the catalogue)
│   │   │   ├── AI Agent
│   │   │   ├── Queue
│   │   │   └── Microservices
│   │   │
│   │   └── Individual Child Universe
│   │
│   └── ...
│
└── Enterprise Client
```

Or recursively:

$$\text{SaaS} \longrightarrow \text{Brand Group} \longrightarrow \text{Client} \longrightarrow \text{Project} \longrightarrow \text{Store} \longrightarrow \text{Service} \longrightarrow \text{Agent}$$

Each tier operates with its own perimeter, context, and explicit authority level.

---

### The Key Takeaway

SHAPER is not merely building **agents that manage online stores**.

It establishes an architecture in which **every environment becomes responsible for itself, while remaining observable and governable by the environment supervising it.**

* A store manages its own workload.
* A store group supervises its stores.
* A client manages their environments.
* The SaaS platform orchestrates its clients.
* And every level operates on the exact same recursive principles.

**This fractal recursivity is what transforms a simple agent automating a single store into a resilient agentic infrastructure capable of operating an entire enterprise.**

---

## Step 0 — Feed this repo to your AI agent (do this first)

Shaper OS is installed **with** an IDE agent (Cursor, Claude Code, etc.) — not by hand-copying a 50-step tutorial.

1. **Clone** and open the folder in your IDE:

   ```bash
   git clone https://github.com/xavdp-pro/SHAPER-OS-V1.13.git
   cd SHAPER-OS-V1.13
   ```

2. **Paste this intent** to your agent (full version: [`examples/agent-KEY-COLLECTION-INTENT.md`](../examples/agent-KEY-COLLECTION-INTENT.md)):

   > You are my Shaper OS install agent. Read `AGENTS.md`, `LAW.md`, `START-HERE.md`, and `KEYS-AND-ACCOUNTS.md`. Generate vault keys locally. Tell me which external API keys I need. For each one, open the correct vendor page (use your browser tool) and guide me step by step. Write secrets only to `software/.env` — never to git. Then run the install pipeline and stop on any red test.

3. **Let the agent work:**
   - **Tier-a (local DEV):** agent generates `VAULT_MASTER_KEY` + `VAULT_TOKEN` — **no paid signups**
   - **Tier-b (voice + public URL, later):** agent opens the right sites and helps you paste Deepgram, Groq, Cloudflare keys

**All vendor URLs and checklists:** [`KEYS-AND-ACCOUNTS.md`](../docs/human/KEYS-AND-ACCOUNTS.md)

| Tier | External signups | Agent opens |
| :--- | :--- | :--- |
| **a — local stack** | None | — (generates vault keys with `openssl`) |
| **b — voice + tunnel** | Deepgram, Groq, Cloudflare | [Deepgram console](https://console.deepgram.com/) · [Groq keys](https://console.groq.com/keys) · [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) |

OpenCode free models need **no API key** for tier-a — see [OpenCode Zen](https://opencode.ai/docs/zen/).

---

**One pillar. Your business. Your assistant.**

Install once on **your** Linux machine. Then shape what you actually need — ERP, CRM, online shop, association back-office, automations, voice cockpit — with an **AI assistant dedicated to your context**, not a generic chatbot.

**Full install path:** [`START-HERE.md`](../docs/human/START-HERE.md) · **Agent instructions:** [`AGENTS.md`](../AGENTS.md)

**See it applied to real businesses:** [shaper.xavdp.pro](https://shaper.xavdp.pro)

---

## In 30 seconds

| | |
| :--- | :--- |
| **What it is** | A small **operating system** for agents that *do work* — secrets, audit log, jobs, scheduler, optional voice console |
| **What it is not** | A fixed CRM, a fixed ERP, or ChatGPT in a tab |
| **What you get** | A **foundation** you own; on top, **your** tools — limited only by your process and imagination |
| **Who it is for** | Owner, association, freelancer, small team — anyone who outgrew spreadsheets + ten SaaS tabs |

You talk or type. The agent reads **your** context, acts (or queues work), logs everything, answers. Screens are optional.

---

## The pillar — then whatever you need

Shaper OS is the **technical floor** you do not rebuild for every project:

- Encrypted **vault** (API keys, mail, integrations)
- **Audit log** (who did what, when)
- **Job queue** + **scheduler** (background work, beats, follow-ups)
- **AI bridge** wired to **your** business rules (`ctx-universe.md`)
- Optional **operator console** + voice (`/console`) — for you, not for your end customers

On that floor you — or an IDE agent — **shape the tool you lack today**:

- Something **ERP-like** — stock, orders, suppliers, invoicing
- A **CRM** — clients, pipeline, projects, mail triage, follow-ups
- An **online shop** or catalog — products, payments, fulfillment hooks
- **Association / NGO back-office** — members, dues, events, volunteers
- **Automations** — imports, alerts, recurring reports, syncs between tools you keep
- **Voice ops** — “what’s overdue?”, “queue this sync”, “summarize yesterday”
- A **weird vertical** no SaaS fits — your exceptions stay first-class

Same bricks underneath. New **universe** = new manifest + data + your rules — not a new SaaS subscription.

---

## Concrete examples (same pillar, different businesses)

| You need… | What you shape on top | The pillar handles… |
| :--- | :--- | :--- |
| **Light ERP** | Orders, stock, billing, supplier CSV | Secrets, jobs, audit, scheduled sync |
| **CRM / freelance hub** | Clients, projects, IMAP, follow-ups | Mail beats, queue, agent, console |
| **Online shop** | Catalog, Stripe, orders, shipping status | Vault, logger, web app (your code, your brand) |
| **Association / club** | Members, dues, events, mailing lists | Scheduler, audit, optional public site separate from console |
| **Field service (construction, maintenance)** | Quotes, sites, photos, planning | Voice console + mobile-friendly app you build |
| **Phone reception / booking** | Voice → slot → confirm → log | Bridge + queue + your booking app |
| **Training / coaching business** | Courses, payments, CMS, certificates | Universe pattern + Stripe + content |
| **“Nothing fits us”** | Exact workflow, your language, your edge cases | Fractal reuse — imagination is the limit |

**Duplicate** a proven setup for a second brand or client. **Rebuild TEST from zero** to prove disaster recovery. **Tag PROD** when tests are green.

Client-facing shops and portals stay **your apps** (perimeter 3). The operator cockpit stays **yours** (perimeter 2). Secrets and boot stay **boring and reliable** (perimeter 1).

---

## What’s in this repository

```
SHAPER-OS-V1.13/
├── doctrine/                    ← 6 master doctrine documents
├── START-HERE.md, LAW.md, …     ← install kit
├── software/                    ← packages, bricks, npm test, build scripts
└── <your-universe>-dev/         ← you create this (config + data only)
```

**Tier-a (local DEV):** vault · logger · OpenCode bridge · queue · maestro  
**Tier-b (optional):** Helm `/console` + voice · Cloudflare tunnel  

Everything for a first install is **here** — no second private repo required (V1.7).

---

## Security (useful paranoia, not theatre)

| We do | We don’t |
| :--- | :--- |
| Agent-generated vault keys; **no secrets in git** | Hardcoded API keys in scripts |
| Encrypt secrets · log every agent action | Trust the LLM with raw passwords in chat |
| Tests green **before** deploy; live tests **after** stack up | Skip failing tests or stub to green |
| DEV/TEST use stubs or dedicated mailboxes | Point tests at production inboxes |
| Data on **your** volumes / your VPS | Lock you into one vendor’s cloud |

Honest scope: this stops sloppy deploys, leaked repos, and architecture drift — not a nation-state on your LAN. Voice/tier-b uses **your** Deepgram/Groq keys and tunnel token locally.

Law: [`LAW.md`](./LAW.md) · [`software/RULES.md`](./RULES.md)

---

## From GitHub to your business

| Here (GitHub) | There ([shaper.xavdp.pro](https://shaper.xavdp.pro)) |
| :--- | :--- |
| Open pillar — install, test, fork the method (CC BY-SA 4.0) | Human conversation → **your** foundation shaped for **your** activity |
| For builders and IDE agents | For owners who want a tool that fits — delegation or autonomy |
| `git clone` + green tests | Live demo, discovery call, concrete path forward |

Same idea: **foundation first, then build on top** — ERP, CRM, shop, association tool, automation — until it matches how you really work.

**Looking for short- and long-term missions** — install, shape, or operate Shaper OS for your business (infra, ERP/CRM, shop, automation, voice).  
**Contact:** [xavier@xavdp.pro](mailto:xavier@xavdp.pro) · [LinkedIn](https://www.linkedin.com/in/xavier-de-poorter) · [shaper.xavdp.pro](https://shaper.xavdp.pro)

---

## Quick start

```bash
git clone https://github.com/xavdp-pro/SHAPER-OS-V1.13.git
cd SHAPER-OS-V1.13
cp .env.example software/.env
# IDE agent: generate VAULT_MASTER_KEY + VAULT_TOKEN — see START-HERE.md
cd software && npm run vault:bootstrap && npm test
bash scripts/build-all-bricks.sh
# then universe + podman-up — full path in START-HERE.md
```

**Read order:** [`LAW.md`](./LAW.md) → [`START-HERE.md`](../docs/human/START-HERE.md) → [`PROOF.md`](../docs/human/PROOF.md) → [`CONCEPTS.md`](../docs/human/CONCEPTS.md)

---

## Not much business code — it runs on written intent

This repo **does** ship tested foundation code (vault, logger, queue, scheduler, bridge).  
What it **does not** ship is a fixed ERP, CRM, or shop as thousands of lines of app logic.

**Your business tool is mostly text files.** You declare *what* you want and *what must never happen*. An IDE agent (or you) reads those files and **generates or adapts the code at deploy time**. When the model improves, the intent stays; only the synthesis changes.

> **Human declares intent, rules, and invariants — the agent materializes the code.**

That is the core of the [manifest model](./MANIFESTO.md).

### Manifest stack (one universe = one folder)

| File | Who reads it | What it says |
| :--- | :--- | :--- |
| **`INTENT.md`** | Deploy agent | Objective + 4–6 invariants (security, logging, lifecycle) |
| **`manifest.json`** | Scripts + deploy agent | Which bricks to wire, boot order, where to specialize (vault file, task JSON, volumes) |
| **`AGENT-DEPLOY.md`** | Deploy agent | What it may do autonomously on this machine |
| **`context/ctx-universe.md`** | Runtime assistant | Your business rules, tone, workflows — **not** install instructions |

**Deploy order:** `INTENT.md` → `manifest.json` → `AGENT-DEPLOY.md`  
**Runtime order:** beats / jobs read `ctx-universe.md` only

### What `manifest.json` contains (summary)

A universe manifest is a short JSON contract — not a codebase:

- **`bricks`** — reusable engines already in `software/bricks/` (vault, logger, bridge, queue, maestro, optional helm…)
- **`ref` + `intent`** — pointer to each brick and its own `INTENT.md`
- **`specialize`** — *your* parameters only: vault bootstrap path, log volume, maestro tasks file, model choice
- **`bootOrder`** — which services start together and in what sequence

Example tier-a manifest: [`manifest.tier-a.json`](../manifest.tier-a.json) — five bricks, no copy of their source.

New CRM, new shop, new association back-office = **new universe folder** (intent + manifest + context + data). Same pillar underneath. Containers and glue code are **disposable**; structure, data, and declared intent are **permanent**.

Full doctrine: [`software/MANIFESTO.md`](./MANIFESTO.md) · architecture: [`software/docs/UNIVERSE-ARCHITECTURE.md`](./docs/UNIVERSE-ARCHITECTURE.md)

---

**Author:** Xavier DE POORTER / XDP LLC · **Missions:** short & long term — [xavier@xavdp.pro](mailto:xavier@xavdp.pro) · [LinkedIn](https://www.linkedin.com/in/xavier-de-poorter) · **License:** [CC BY-SA 4.0](../LICENSE)  
**AI-assisted:** see [`NOTICE.md`](../NOTICE.md)
