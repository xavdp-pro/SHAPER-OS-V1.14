# docs/ — Where each document lives, and who it is for

Three audiences, three directories. A document lives where its **reader** is, not
where its topic is.

| Directory | Reader | Contents |
| :--- | :--- | :--- |
| [`PREREQUISITES.md`](./PREREQUISITES.md) | Both | What must be true before an agent starts — and the mechanical gate (`npm run preflight`) |
| [`human/`](./human/) | People — owners, operators, engineers | Install, prove, operate, vocabulary, keys and accounts |
| [`agent/`](./agent/) | AI agents, routed by capability | Boot contract, generative principles, process phases, explicit runbook |
| [`architecture/`](./architecture/) | Anyone judging or extending the design | Brick taxonomy, cognition requirements, fractal security model |

## human/

| File | Purpose |
| :--- | :--- |
| [`START-HERE.md`](./human/START-HERE.md) | First install, step by step. This is DEV. |
| [`PROOF.md`](./human/PROOF.md) | The operator loop that proves the system actually works. |
| [`LIFECYCLE.md`](./human/LIFECYCLE.md) | DEV → TEST (destroyed) → PROD, and the three recovery clocks. |
| [`CONCEPTS.md`](./human/CONCEPTS.md) | Fractal model, perimeters, naming. |
| [`GLOSSARY.md`](./human/GLOSSARY.md) | The words, defined once. |
| [`KEYS-AND-ACCOUNTS.md`](./human/KEYS-AND-ACCOUNTS.md) | Which API keys, which vendor consoles, tier-a vs tier-b. |
| [`SERVICES.md`](./human/SERVICES.md) | Ports and boot order at a glance. |
| [`THE-NON-TECHNICAL-OWNER-PROMISE.md`](./human/THE-NON-TECHNICAL-OWNER-PROMISE.md) | What is promised to someone who will not write code. |
| [`VISION.md`](./human/VISION.md) | Voice-first intent. |
| [`REPOS.md`](./human/REPOS.md) · [`SHARE.md`](./human/SHARE.md) | Git remotes; inviting another operator. |

## agent/

Read in the order given by [`../AGENTS.md`](../AGENTS.md) — it routes by model
capability, because a high-abstraction model and a fast light model should not
read the same text.

| File | Purpose |
| :--- | :--- |
| [`BOOT-CONTRACT.md`](./agent/BOOT-CONTRACT.md) | Twelve statements: granted authority, hard stops, the obligation to report corrections back into the repository. **Read first, at every capability level.** |
| [`PRINCIPLES.md`](./agent/PRINCIPLES.md) | Ten principles that generate the 49 rules. Dense. For models that derive. |
| [`PHASES.md`](./agent/PHASES.md) | Seven phases, and which rules bind in each. The ordered spine. |
| [`RUNBOOK-EXPLICIT.md`](./agent/RUNBOOK-EXPLICIT.md) | Literal steps, explicit stops, no derivation required. |
| [`COLD-READ-TEST.md`](./agent/COLD-READ-TEST.md) | For an agent asked to *evaluate* the documentation: seven questions, one report format. |
| [`BETA-DEPLOYMENT-TEST.md`](./agent/BETA-DEPLOYMENT-TEST.md) | For an agent asked to *deploy* and report: you cannot fail it; go all the way and hand the fix over inside the report. |

## architecture/

| File | Purpose |
| :--- | :--- |
| [`UNIVERSE-PROFILES.md`](./architecture/UNIVERSE-PROFILES.md) | Human business archetypes, modular Lego profiles, adaptive WAF, and combination prompt patterns. |
| [`BRICKS.md`](./architecture/BRICKS.md) | Four brick classes, and what breaks without each one. |
| [`MISSING-BRICKS.md`](./architecture/MISSING-BRICKS.md) | Roadmap and detailed technical specifications for all extended and target bricks. |
| [`COGNITION.md`](./architecture/COGNITION.md) | How a brick declares the reasoning depth and throughput its work needs. |
| [`FRACTAL-ARCHITECTURE-AND-SECURITY.md`](./architecture/FRACTAL-ARCHITECTURE-AND-SECURITY.md) | Fractal recursivity, PULL workers, sovereign security model. |
| [`DEFERRED-DECISIONS.md`](./architecture/DEFERRED-DECISIONS.md) | Questions deliberately left open, with the trigger that reopens each one. |

---

**Not here:** the binding law. That is [`../software/RULES.md`](../software/RULES.md)
— 49 rules, read in full, never summarised — with [`../LAW.md`](../LAW.md) as its
one-page condensation and [`../doctrine/`](../doctrine/) as the master corpus.
