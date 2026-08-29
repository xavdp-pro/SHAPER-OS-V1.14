# SHAPER OS — Documentation Index

> **Read order for agents and humans** — updated 2026-08-19.

| Priority | Document | Role |
| :---: | :--- | :--- |
| 1 | [`PERIMETERS.md`](./PERIMETERS.md) | **Canonical law** — P1 / P2 / P3 taxonomy |
| 2 | [`../README.md`](../README.md) | Repository layout, quickstart, package list |
| 3 | [`../RULES.md`](../RULES.md) | Engineering invariants |
| 4 | [`../topology.json`](../topology.json) | Boot graph (P1+P2 nodes; see PERIMETERS for strict P1) |
| 5 | [`FUNCTIONAL-INVENTORY.md`](./FUNCTIONAL-INVENTORY.md) | Parallel objectives / features catalogue |
| 6 | [`UNIVERSE-ARCHITECTURE.md`](./UNIVERSE-ARCHITECTURE.md) | Universe manifest fractal model |
| 7 | [`GOVERNANCE-FRACTAL.md`](./GOVERNANCE-FRACTAL.md) | Deploy levels 0–3 + P1/P2/P3 mapping |
| 8 | [`../MANIFESTO.md`](../MANIFESTO.md) | KovZu belly vs Shaper Way (P2 vs P3) |
| 9 | [`TOPOLOGY-INTENT.md`](./TOPOLOGY-INTENT.md) | Topology manifest protocol |

### Doctrine corpus (canonical, lives at the repository root)

The master corpus is **not** duplicated here. Until v1.8 nine of these documents
existed twice, byte for byte, in `doctrine/` and in `software/docs/` — which left
an agent no way to know which copy was authoritative. The mirrors are gone; these
are the originals.

| Document | Role |
| :--- | :--- |
| [`../../doctrine/README.md`](../../doctrine/README.md) | Corpus index |
| [`../../doctrine/AGENT-CLIS.md`](../../doctrine/AGENT-CLIS.md) | Agent CLI matrix |
| [`../../doctrine/DOCUMENT-PIPELINE.md`](../../doctrine/DOCUMENT-PIPELINE.md) | Multi-witness document pipeline |
| [`../../doctrine/FRACTAL-TERRAFORM-AND-CORRECTION-LAW.md`](../../doctrine/FRACTAL-TERRAFORM-AND-CORRECTION-LAW.md) | Fractal terraform + correction law |
| [`../../doctrine/FRACTAL-ARCHITECTURE-BY-EXAMPLE.md`](../../doctrine/FRACTAL-ARCHITECTURE-BY-EXAMPLE.md) | Worked fractal SaaS case |
| [`../../doctrine/SOVEREIGN-WEB-CHAIN-WAF-AND-CACHE.md`](../../doctrine/SOVEREIGN-WEB-CHAIN-WAF-AND-CACHE.md) | Sovereign web chain, WAF, cache |
| [`../../doctrine/REAL-INFRASTRUCTURE-CAPACITY-PLANNING-SAAS.md`](../../doctrine/REAL-INFRASTRUCTURE-CAPACITY-PLANNING-SAAS.md) | Capacity planning |
| [`../../doctrine/CONVERGENCE-STATE.md`](../../doctrine/CONVERGENCE-STATE.md) · [`../../doctrine/CONVERGENCE-PROPOSAL-STEADY-STATE.md`](../../doctrine/CONVERGENCE-PROPOSAL-STEADY-STATE.md) | Where the code actually stands vs the target |
| [`../../doctrine/VOCABULARY-AND-PITCH.md`](../../doctrine/VOCABULARY-AND-PITCH.md) | Vocabulary and pitch |

### Agent entry documents (repository root)

| Document | Role |
| :--- | :--- |
| [`../../AGENTS.md`](../../AGENTS.md) | Entry door — routes an agent by capability class |
| [`../../docs/agent/BOOT-CONTRACT.md`](../../docs/agent/BOOT-CONTRACT.md) | Granted authority and hard stops |
| [`../../docs/agent/PRINCIPLES.md`](../../docs/agent/PRINCIPLES.md) | Ten generative principles |
| [`../../docs/agent/PHASES.md`](../../docs/agent/PHASES.md) | Seven phases, and which rules bind in each |
| [`../../docs/agent/RUNBOOK-EXPLICIT.md`](../../docs/agent/RUNBOOK-EXPLICIT.md) | Literal steps for fast / light models |
| [`../../docs/COGNITION.md`](../../docs/architecture/COGNITION.md) | Required reasoning depth and throughput |
| [`../../docs/BRICKS.md`](../../docs/architecture/BRICKS.md) | Brick taxonomy |

### Helm / KovZu (P2 cockpit)

| Document | Role |
| :--- | :--- |
| Helm product docs | Moved with `brick-helm` to the [`SHAPER-OS-BRICKS`](https://github.com/xavdp-pro/SHAPER-OS-BRICKS-V1.13) catalogue |



### Historical / archived (do not treat as active law)

| Document | Status |
| :--- | :--- |

### Planned tooling (referenced in docs, not yet in repo)

| Tool | Purpose |
| :--- | :--- |
| `scripts/shaper-deps.mjs` | Topology validator CLI |
| `scripts/bootstrap-shaper-os.sh` | Full OS cold bootstrap |

---

## Hors dépôt

La correspondance entre agents (handoffs, briefs de test), les journaux de session datés et
les rapports de validation ponctuels ne vivent **pas** dans ce dépôt : ils décrivent un
moment de travail, pas le système. Ils sont rangés dans `REMOTE3/Travaux/`
(`handoffs/`, `journaux/`, `rapports/`).

Ce dépôt ne contient que ce qui décrit **SHAPER-OS lui-même** : la loi, la doctrine, les
intents, l'architecture et le code.

## What left this index in V1.11

| Document | Where it went, and why |
| :--- | :--- |
| `HELM-WEB-CHAT.md` | To the catalogue, in `bricks/brick-helm/docs/`. The base documented a brick it does not ship, so it could not stay right about it. |
| `EXPERIMENTS.md` | Out of the repository. An experiment is a moment of work, not a description of the system (`../universes/README.md`). |
| `SPEC_ZEPHIR_TALK.md` | Deleted. It had been marked OBSOLETE since 2026-08-19 with "do not implement from it" at the top — and dead configuration is read by an agent as if it were true. |
