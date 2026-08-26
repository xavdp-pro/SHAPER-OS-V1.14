# SHAPER-OS — Convergence State

> **What this document is for.**
> The rules state the **target**. This file states **where we actually are**.
> A rule is **never** weakened, shortened or deleted to fit the code: the gap is written down here. That is what lets us hold an ambitious doctrine and zero contradiction at the same time.
>
> **Phase 1 — articulate, and verify that it works end to end.**
> **Phase 2 — hardening**, once the whole picture is in hand, and at the latest before the first universe serving a real client.

Last verified: **22 August 2026**, by reading the code (`grep` across `packages/`, `bricks/`, `universes/`), not by taking anyone's word for it.

---

## Legend

| Status | Meaning |
| :--- | :--- |
| ✅ **Applied** | The code does what the rule says. |
| 🟡 **Staged** | Implemented, but deliberately non-binding in phase 1. The switch exists and is named. |
| ⬜ **Target** | Not implemented yet. The rule remains the target; no promise is made anywhere else. |
| ⚠️ **Live gap** | The code today does something a rule forbids. **Treat as a priority.** |

---

## State, rule by rule

| Rule | Subject | Status | What the code actually does |
| :---: | :--- | :---: | :--- |
| **0 → 0K** | Engineering conventions, perimeters, native tests | ✅ | Applied. 58/58 unit tests green. |
| **1 → 18** | Naming, git, Podman, disaster recovery, backups, TTS, admin | ✅ | Applied. |
| **19** | Simple / Technical toggle | ⬜ | No `viewMode` in any of the 63 components. Simple mode does not exist yet. |
| **20** | Typed quality gate | 🟡 | `validateQualityGate` is real and tested (arithmetic, file, columns, dry run). **Non-binding by default**: `QUALITY_GATE_ENFORCE=1` turns it on per universe. A deliverable with no contract is recorded as `NEEDS_CONTRACT` and passes — a declared step, not the target. |
| **21** | Capability classes | ⬜ | No class declared in any manifest. The bridge stays generic. |
| **22** | Semantic RAG + per-universe sealing | ⚠️ | **Live gap**: the rule forbids writing a lexical fallback vector into a semantic collection. `generateLocalEmbedding` (djb2 hash of n-grams) is today's default. MiniLM ONNX is absent. Per-universe sealing is not yet verified by code. |
| **23** | External correction (parent repairs child) | ⬜ | Observed as a rule of conduct by the agents; no automatic mechanism. |
| **24** | Root guardian | ✅ | Carried by the tooled human (Cursor / Claude Code / Antigravity), exactly as the rule provides for. |
| **25** | Canary deployment | ⬜ | No fleet, so not yet applicable. To implement before the first Manager universe. |
| **26** | One MariaDB per universe | 🟡 | Isolation respected wherever MariaDB is used (Helm). The **queue** persists to JSONL on a volume, not to a database: `storageAdapter` is planned, no adapter written. |
| **27** | Convergence guard + escalation channel | ⬜ | No reconciliation engine, therefore no `observed-state.json` and no `DEGRADED`. |
| **28** | WAF validated against an attack corpus | ⬜ | No WAF. Moot until the web chain exists. |
| **Pipeline** | Document understanding (brick-pipeline) | ⬜ | Fully a target. Today extraction lives in `packages/pkg-rag` and runs **inside the GED container**, synchronously: measured, a 20 MB file freezes that container for 4.3 s. PDF extraction is genuinely solved (per-font ToUnicode); OCR, vision, deskewing, legibility, type recognition and multiplexing all remain to be built. |
| **32-33** | Founding method: a perfect base before specialisation, fractal client fork | ✅ | Method rules, applied rather than "implemented". Writing the doctrine before the code is that method in action. |
| **29** | Constructive integrity | ✅ | Respected: recent fixes (auth, deployment) arrived with their tests. |
| **30** | Snapshot before migration | ⬜ | No fleet migration to date. The rule is waiting for its first case. |
| **31** | Declared data lifecycle | ⬜ | No `dataLifecycle` in any existing manifest. To be added to `_template`. |

---

## The one live gap to close

**Rule 22 — the fallback embedding.** It is the only place where the code today does what a rule explicitly forbids. Two acceptable ways out, to be decided:

1. **Wire up MiniLM ONNX** (`@xenova/transformers`, ~23 MB model, local, sovereign) and delete `generateLocalEmbedding`.
2. **Or** make indexing fail loudly when no semantic model is available (`PENDING_EMBED`), which the rule already provides for — and use the hash nowhere at all.

What is not acceptable is the present state: a lexical vector written into a collection presented as semantic. That is the very definition of the "fake" that Rule 0G forbids.

---

## How to use this document

* It is updated **when code lands**, never when a rule is written.
* A ⬜ is not shameful debt: it is a target, owned and dated.
* A ⚠️ is a consistency bug and is treated as one.
* **No external promise** — pitch, README, client-facing page — rests on a ⬜ or 🟡 line.
