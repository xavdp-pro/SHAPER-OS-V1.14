# Universe: univ8 — Sovereign Multi-Agent Exploration Universe (OpenCode Stack)

> **Intent Classification**: SPECIFIC INTENT (Universe: univ8)

## 1. Declarative Objective

Deploy and operate the sovereign minimal vital socle via Podman containerized bricks (**Vault**, **Logger**, **Auth**, **Bridge-OpenCode**, **Queue**, and **Maestro**) with isolated volumes, OpenCode CLI embedded directly in the bridge image, asynchronous voluntary job dispatching, and full PRA cold-boot verification.

## 2. Invariants

1. **Zero Hardcoded Secrets & Token Auth**: Mailbox passwords and API tokens reside in Vault and dedicated token files — protected by Bearer auth across bridge and queue.
2. **Embedded OpenCode CLI**: The OpenCode CLI runtime is baked into `shaper-bridge-opencode` without requiring host binaries.
3. **Dual Execution Mode (Cadence + Voluntary Jobs)**: Maestro schedules periodic beats while Queue processes asynchronous user requests via workers.
4. **Continuous JSONL Observability**: 100% of beat pulses, mailbox checks, job lifecycles, and context injections are logged to structured append-only streams inside the Logger container.
5. **Cold-Boot PRA (three clocks)**: Full stack verification from a blank ephemeral sandbox, then teardown. Fast when images are cached; longer when images are built/pulled from zero; plus a data-volume delta. Do not quote “&lt; 120s” alone — see `RULES.md` Rule 10.

## 3. Fractal Layout & Layering

| Layer | Path | Purpose |
| :--- | :--- | :--- |
| **Generic Standard** | `SHAPER-OS/packages/*` | Decoupled reusable logic (`@shaper/vault`, `@shaper/logger`, `@shaper/queue`, `@shaper/maestro`, `@shaper/bridge-opencode`) |
| **Generic Images** | `SHAPER-OS/bricks/*` | Canonical Podman Containerfiles (`shaper-vault`, `shaper-logger`, `shaper-bridge-opencode`, `shaper-queue`, `shaper-maestro`) |
| **Universe Manifest** | `UNIV8/manifest.json` | Declarative topology, brick references, and specialization mappings |
| **Operational Parameters** | `tasks/`, `context/`, `bricks/*/instance.json` | Parameterized operational tasks and business rule definitions |
| **Idempotence State** | `state/checkpoint.json` | Deterministic tracking of processed events / inbox messages |

## 4. Document Map

| File | Audience | Purpose |
| :--- | :--- | :--- |
| `INTENT.md` | Human & AI Agents | Canonical engineering invariants and declarative intent |
| `manifest.json` | Automation & CI/CD | Machine-readable dependency graph and boot layers |
| `AGENT-DEPLOY.md` | Autonomous Deploy Agent | Podman startup commands and verification checklist |
| `context/AGENT-CONTEXT.md` | Runtime AI Agent | Living business persona and operational prompt context |
