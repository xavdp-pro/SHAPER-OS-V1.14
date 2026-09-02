# SHAPER-OS — Convergence State

> **What this document is for.**
> The rules state the **target**. This file states **where we actually are**.
> A rule is **never** weakened, shortened or deleted to fit the code: the gap is written down here. That is what lets us hold an ambitious doctrine and zero contradiction at the same time.
>
> **Phase 1 — articulate, and verify that it works end to end.**
> **Phase 2 — hardening**, once the whole picture is in hand, and at the latest before the first universe serving a real client.

Last verified: **22 August 2026**, by reading the code (`grep` across `packages/`, `bricks/`, `universes/`), not by taking anyone's word for it. The maker-and-governor section was verified on **2 September 2026** the same way.

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
| **27** | Convergence guard + escalation channel | ⬜ | For Maestro: no reconciliation engine, therefore no `observed-state.json`. For the governor's ledger (`pkg-governor`, 2 September 2026): `DEGRADED` and `REAPED` exist, backoff and `maxHealingAttempts` bound the governor's own reap offers, a refused reap rests — see the maker-and-governor section below for what still binds by reading. |
| **28** | WAF validated against an attack corpus | ⬜ | No WAF. Moot until the web chain exists. |
| **Pipeline** | Document understanding (brick-pipeline) | ⬜ | Fully a target. Today extraction lives in `packages/pkg-rag` and runs **inside the GED container**, synchronously: measured, a 20 MB file freezes that container for 4.3 s. PDF extraction is genuinely solved (per-font ToUnicode); OCR, vision, deskewing, legibility, type recognition and multiplexing all remain to be built. |
| **32-33** | Founding method: a perfect base before specialisation, fractal client fork | ✅ | Method rules, applied rather than "implemented". Writing the doctrine before the code is that method in action. |
| **29** | Constructive integrity | ✅ | Respected: recent fixes (auth, deployment) arrived with their tests. |
| **30** | Snapshot before migration | ⬜ | No fleet migration to date. The rule is waiting for its first case. |
| **31** | Declared data lifecycle | ⬜ | No `dataLifecycle` in any existing manifest. To be added to `_template`. |

---

## Maker and governor — the gaps declared on 2 September 2026

Verified by reading `software/packages/pkg-governor/index.js`,
`software/universes/_maker-template/poller.mjs` and the shipped `lxd-*`
recipes on the branch that carries the maker-and-governor amendments of
Rules 11, 27, 36 and 37 (the verdict of 2 September). Each line is a gap
the doctrine page names as TARGET; none is a promise anywhere else.

| Rule | Subject | Status | What the code actually does |
| :---: | :--- | :---: | :--- |
| **37** | Ledger columns and states | 🟡 | Rule 37 was amended in this release to the row and the automaton `pkg-governor` has always held (`id … events[]`, five states, REAPED terminal, carrier = `pkg-governor`), and `lexicon-and-code-agree.test.js` holds the rule, the lexicon and the code's `STATES` to one set of names. **Until this release is tagged**, the previous reading — (class, tag, machine, env, state, bucket), four states, contract with `brick-forge` — is what every earlier tag says; a reader of an older tag must take the code, not the rule. Ratified by v1.13.35. One clause of the amended rule binds by reading only: `desire()` guards `prod` and nothing else — the four-name rank `dev`, `test`, `demo`, `prod` is not enforced, `env` is not among the required fields, and an unknown `env` (`staging`, a typo) is treated as one a robot may end. TARGET: refuse an `env` outside the four, as a typed fact. |
| **26** | The governor's storage | 🟡 | `createFileStorage` in `pkg-governor` is a JSONL journal on disk, read back in full at boot: the package's **reference adapter**, and the demo governor's transitional storage. Rule 26 and Rule 37 place the ledger in the governing universe's database; the `storage` slot is the seam, and no database adapter is written. A real governor binds its own (`pkg-governor/INTENT.md`). |
| **37 / 10** | Matrix maturity | ⬜ | The doctrine's invariant `maturity(matrix) ≥ environment(instance)` has no carrier: `grep -rni maturity` over `pkg-governor` and `_maker-template` finds nothing, the row has no maturity field, no manifest sits beside `<sha>.tar.gz`, the maker's inventory is a list of bare digests, and `desire()` accepts any `env` with any `digest`. TARGET: a `matrices` table {digest, maturity, promotedAt} in the governor and a refusal in `desire()`. The invariant binds by reading. |
| **23** | Lanes set from above | ⬜ | The maker template's invariant 4 says its lanes are set from above. Today `poller.mjs` declares `lanes` (default 1) at every poll and `pkg-governor` records them (`maker.lanes = lanes ?? maker.lanes`); `poll()` returns all the work a host owes and the maker truncates to its own lanes. The from-above form — lanes fixed at enrolment, echoed in the poll answer, never more work handed than lanes — is not built. |
| **27** | Silence heard, `manifest.json` of the maker | ⬜ | `silentMakers()` computes which hosts are quiet past an interval and has no caller outside its tests; the poll interval stays local to `poller.mjs` and is not declared to the governor. The maker template lists a `manifest.json` with an `alerting` channel in its document map and ships none — `_maker-template/` holds `INTENT.md`, `poller.mjs`, `recipes/`. The silence is computed, not heard; Rule 27's channel exists by reading. The `verify` check on alerting cannot see a universe that has no manifest at all. |
| **37** | Drift of a living instance | ⬜ | `poll()` derives work from a row's state and deadline only. PURRING is written on STAMPED (and again on VALIDATED or ADOPTED, `updatedAt` re-dated at every transition), but the row carries no `lastPurr`, and `validate` is offered once per life — `needsValidation()` returns false as soon as a VALIDATED or VALIDATION_FAILED event exists: after it nothing observes the instance, the maker's inventory is of matrices, not of instances, and a container that died after its birth stays PURRING forever. Rule 37 says PURRING is dated on every on-time beat. TARGET: the maker declares at every poll the instances it actually runs (by row id, from `lxc list`), the governor re-dates PURRING, and a missing instance becomes stamp work. |
| **11 / 36** | The maker lives in an LXC | ⬜ | Ruled 31 August 2026, not built: the shipped `lxd-*` recipes call `lxc` on the host directly, and `poller.mjs` asks under `os.hostname()`, which inside an LXC is the container's own name — the label the maker's invariant 5 forbids. The LXC form needs a hop whose arguments never cross a remote shell (the recipe travels to the host and reads its positions from stdin as one JSON line, never as an ssh command string) and an identity asked of the HOST, tested with the hostile account string before it ships. Until then the maker runs on the host it acts on, and no key travels in `lxd-stamp.sh` today (`grep -i 'ssh\|authorized\|file push'` finds nothing beyond the matrix import): the Parent's public key as a file in the stamp, as Rule 36 states it, is TARGET with the LXC form. |
| **11** | One matrix, three host kinds | ⬜ | `lxd-stamp.sh` imports a single file — LXD's unified tarball (`metadata.yaml` + `rootfs/`); `pct create` and plain LXC consume a bare rootfs. The sha256 the recipe verifies names the stored file. Whether one pivot serves the three families of Rule 11 — a bare rootfs hashed, wrapped at import by each stamp — is decided by the second recipe (`proxmox-*` or `liblxc-*`), with its proof in `recipes/README.md`. "One truth" across host kinds binds by reading until then. |

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
