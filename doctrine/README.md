# 🏛️ SHAPER-OS — Doctrinal Corpus & Strategic Frame

This directory gathers the **7 founding reference documents** and the convergence state of SHAPER-OS, formalised and locked during the August 2026 sessions. It serves as **shared context, doctrinal compass, hardware operations guide and security chain** for the human and for every AI agent (Claude Code, Cursor, Antigravity, OpenCode).

---

## 📚 Recommended reading order for agents

| # | Document | Subject & scope |
| :---: | :--- | :--- |
| **1** | [`VOCABULARY-AND-PITCH.md`](./VOCABULARY-AND-PITCH.md) | **The register and the pitch**: turning adjectives into observable behaviour, cutting the jargon, framing the Simple/Technical toggle. |
| **2** | [`CONVERGENCE-PROPOSAL-STEADY-STATE.md`](./CONVERGENCE-PROPOSAL-STEADY-STATE.md) | **The steady state and Rules 19 to 31**: formal definition, audit matrix, quality gate typed per deliverable, isolated MariaDB, abstract capability classes, sealed RAG, convergence guard and constructive integrity. |
| **3** | [`FRACTAL-ARCHITECTURE-BY-EXAMPLE.md`](./FRACTAL-ARCHITECTURE-BY-EXAMPLE.md) | **The fractal demonstrated by example**: from a single child universe to a fifty-child fleet manager and a three-level platform. |
| **4** | [`FRACTAL-TERRAFORM-AND-CORRECTION-LAW.md`](./FRACTAL-TERRAFORM-AND-CORRECTION-LAW.md) | **Declarative orchestration and survival (R23-R27, R29-R30)**: the continuous reconciliation engine and its convergence guard, the Law of External Correction, the Root Guardian, canary deployment, concrete self-healing examples, the patch protocol, data migrations under snapshot, and constructive integrity. |
| **5** | [`REAL-INFRASTRUCTURE-CAPACITY-PLANNING-SAAS.md`](./REAL-INFRASTRUCTURE-CAPACITY-PLANNING-SAAS.md) | **Real, physical operations**: statistical overcommit (10 Gbit/s), multi-VPS spread, blast-radius isolation, one MariaDB per universe. |
| **6** | [`SOVEREIGN-WEB-CHAIN-WAF-AND-CACHE.md`](./SOVEREIGN-WEB-CHAIN-WAF-AND-CACHE.md) | **The sovereign web chain (R28)**: Cloudflare Zero-Trust → static Nginx → routing WAF and precomputed cache → live Node.js, with a mandatory attack corpus. |
| **7** | [`DOCUMENT-PIPELINE.md`](./DOCUMENT-PIPELINE.md) | **Document understanding**: the page as the unit, three witnesses (native text, OCR, vision), deskewing and legibility, type recognition then business handlers, multiplexing, state in the database, open sources. Brick intent: [`brick-pipeline`](https://github.com/xavdp-pro/SHAPER-OS-BRICKS-V1.13). |
| **8** | [`SECURITY-FOLLOWS-FUNCTION.md`](./SECURITY-FOLLOWS-FUNCTION.md) | **When security work happens and who dictates its depth**: structure defends first, the paranoid pass comes once the symphony plays, sized by the cahier des charges — with the floor that is never deferred. |
| **9** | [`DIRECTION-IS-THE-BOUNDARY.md`](./DIRECTION-IS-THE-BOUNDARY.md) | **The structural half of security-follows-function**: what holds power has no inbound door, what is reachable holds no power. A link that does not exist cannot be misconfigured. |
| **10** | [`THE-SYSTEM-LEARNS-NO-DIALECT.md`](./THE-SYSTEM-LEARNS-NO-DIALECT.md) | **Interoperability is survival, not craftsmanship**: a component serving several variants never branches on the variant, it declares a contract and reads a table. The first silent `if (variant === …)` is a defect. |

---

> ### 📍 Where is the code?
> The documents above state the **target**. The real state of the implementation is kept separately, in [`CONVERGENCE-STATE.md`](./CONVERGENCE-STATE.md), verified by reading the code rather than by taking anyone's word for it.
> **A rule is never weakened to fit the code**: the gap is written in that file. That is what lets us hold an ambitious doctrine and zero contradiction at the same time.

---

## 🎯 The 10 founding pillars

1. **Creation ex nihilo**: the whole edifice deploys from a single Git repository, with no hidden dependency.
2. **The law of the 3 perimeters**: P1 immutable base → P2 Agent/Helm layer → P3 business apps.
3. **Continuous reconciliation engine**: permanent comparison between desired state (`manifest.json`) and observed state (`observed-state.json`) through Maestro.
4. **Quality gate typed per deliverable**: automated validation shaped by what is being delivered (code, document/PDF, data/CSV, action).
5. **Defence in depth and canary deployment**: web filtering through four airlocks, and progressive 1/N rollout across the fleet, so no mistake can ever be collective.
6. **Law of External Correction**: an agent never modifies its own vital organs; repair always comes from the level above (*K+1*), and the root from the out-of-band guardian or the human.
7. **Sovereignty in 3 transparent tiers**: data 100% owned, base 100% owned, intelligence engines modular and swappable.
8. **Convergence guard**: a repair loop that cannot give up becomes the outage. Backoff, bounded attempts, a terminal `DEGRADED` state and a fleet circuit breaker (R27).
9. **A perfect base before specialisation** (Rules 32 and 33): draw a perimeter, make everything inside it excellent and generic, **then** build the business layer on top — never inside. It is **the total vision of the project that dictates the moves** on the base bricks: you do not perfect a brick in the abstract, but against the whole picture — hence doctrine written before code. And when a client demands it, we accept a **fractal fork** of the solution: a separate branch for them, the base intact for everyone else. Time spent perfecting the base is bought back on every project that follows: a specific need then costs an adaptation, often nothing at all. This method is what makes the four promised properties true — adaptable, alive, scalable, multidimensional — instead of merely asserted. A fractal pattern is only worth repeating if it is good.
10. **Constructive integrity**: every bug resolved must give birth to a new regression test (R29). Each incident permanently raises the quality floor of every future universe.

---

## 📌 Source of truth

This **`doctrine/` directory is the single source of truth** for the corpus, and since v1.8 it is the *only* copy. The nine convenience mirrors that used to live under `software/docs/` were byte-identical duplicates, which left an agent no way to know which copy was authoritative; they were removed and `software/docs/DOC-INDEX.md` now references these originals directly.

The binding, executable law remains [`software/RULES.md`](../software/RULES.md) — **Rules 0 to 0K, then 1 to 29**, with no abbreviation and no cross-reference: an agent must be able to read the entire canon in that one file.

---

## 🚧 Deferred decisions (owned, not forgotten)

> **Sequencing in force**: *demonstrate the craft first.* We show the wand is well handled — a base that genuinely works — then add the regulatory and hardening layers on top. This is not permission to rush the base: quite the opposite, since the base is exactly what is being demonstrated. What is deferred is everything around it.

These points were examined and **deliberately set aside for now**. They are recorded here so they are neither rediscovered by accident nor mistaken for oversights.

| Point | Decision | What would reopen it |
| :--- | :--- | :--- |
| **Agent privilege model** | No privilege management for now. An agent has the tools its universe gives it. | The first multi-tenant deployment where universes belonging to **different clients** share a host. |
| **Inference cost management** | No cost model and no quotas for now. | A move to usage-based billing, or the first universe whose LLM cost exceeds its hosting cost. |
| **Fractal depth beyond 3 levels** | Structurally supported, **not claimed**, for lack of a convincing example. | A real case where a 4th level delivers what 3 could not. |
| **GDPR & data governance** | Deferred. The lifecycle stays **declared** per universe (Rule 31), but retention, erasure and the fate of identity-document images are unresolved. | The first document holding a **real client's** personal data, or the first deployment for a third party. Note: this decision can change what we store, and therefore the schema. |
| **Inference cost per document** | Deferred along with cost management in general. **Standing instruction**: log tokens per document from the very first line of code — it cannot be recovered retroactively. | The first 40-page statement, i.e. ~120 agent calls. |
| **Fate of rejected documents** | Unresolved: a document marked unusable has neither a retry queue nor a named recipient. | The first production rejection that nobody notices. |
| **Hardening of controls** | Phase 1 = articulate, and verify it works end to end. Strict mode (blocking gate, mandatory contracts, unconditional checks) is an **owned phase 2**. Permissive defaults are declared, not hidden. | A complete view of the whole system — and at the latest the first universe serving a real client. |

Every other open question raised during the audits has been settled and folded in: restoration timings (Rule 10), escalation channel (Rule 27), data migrations (Rule 30), data lifecycle (Rule 31).
