# SHAPER-OS — Convergence State

> **What this document is for.**
> The rules state the **target**. This file states **where we actually are**.
> A rule is **never** weakened, shortened or deleted to fit the code: the gap is written down here. That is what lets us hold an ambitious doctrine and zero contradiction at the same time.
>
> **Phase 1 — articulate, and verify that it works end to end.**
> **Phase 2 — hardening**, once the whole picture is in hand, and at the latest before the first universe serving a real client.

Each section carries its own verification date, and no section speaks for another:
the rule-by-rule table was re-read on **18 September 2026**, the maker-and-governor
section on **2 September 2026**, the Helm section on **17 September 2026** — every one by
reading the code (`grep` across `packages/`, `bricks/`, `universes/`, and the catalogue
repository where `pkg-rag` and `brick-helm` now live), not by taking anyone's word for it.
A line older than the tree it describes is a warning, not a fact.

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
| **0 → 0K** | Engineering conventions, perimeters, native tests | ✅ | Applied. 558/558 unit tests green, 116 suites (18 September 2026). |
| **1 → 18** | Naming, git, Podman, disaster recovery, backups, TTS, admin | ✅ | Applied. |
| **19** | Simple / Technical toggle | ⬜ | No `viewMode` anywhere. The 63 components are `brick-helm`'s and now live in the catalogue repository; none of them carries one. Simple mode does not exist yet. |
| **20** | Typed quality gate | 🟡 | `validateQualityGate` is real and tested (arithmetic, file, columns, dry run). **Non-binding by default**: `QUALITY_GATE_ENFORCE=1` turns it on per universe. A deliverable with no contract is recorded as `NEEDS_CONTRACT` and passes — a declared step, not the target. |
| **21** | Capability classes | ⬜ | No class declared in any manifest. The bridge stays generic. |
| **22** | Semantic RAG + per-universe sealing | ⚠️ | **Live gap, narrowed on 18 September 2026.** MiniLM ONNX is no longer absent: `pkg-rag/lib/embedder.js` (catalogue) tries `Xenova/all-MiniLM-L6-v2` first, then Ollama, then OpenAI. What the rule still forbids remains: the last branch falls back to `generateLocalEmbedding` (djb2 hash of n-grams) and writes a lexical vector into a collection presented as semantic, silently. Per-universe sealing is still not verified by code. |
| **23** | External correction (parent repairs child) | ⬜ | Observed as a rule of conduct by the agents; no automatic mechanism. |
| **24** | Root guardian | ✅ | Carried by the tooled human (Cursor / Claude Code / Antigravity), exactly as the rule provides for. |
| **25** | Canary deployment | ⬜ | No fleet, so not yet applicable. To implement before the first Manager universe. |
| **26** | One mandatory isolated MariaDB per functional Podman | ⚠️ | Operator correction of 22 September 2026: the boundary is each functional Podman, not one shared database per universe. Every function owns its own MariaDB, credentials, storage, backup and restore proof. Static inventory found no fully conformant existing universe: the base template declares five functional Podmans and no MariaDB; Vox declares eight and no MariaDB; Clinic and SuperSIP still use file/CSV paths; PodMesh manager and control journals use SQLite; demo CRM and SaaS prove only an app-owned companion MariaDB, not the rule across every function. Existing working instances remain untouched and may continue as recorded legacy. Compliance becomes mandatory at their next rebuild, replacement, rematerialisation or promotion. |
| **27** | Convergence guard + escalation channel | ⬜ | For Maestro: no reconciliation engine, therefore no `observed-state.json`. For the governor's ledger (`pkg-governor`, 2 September 2026): `DEGRADED` and `REAPED` exist, backoff and `maxHealingAttempts` bound the governor's own reap offers, a refused reap rests — see the maker-and-governor section below for what still binds by reading. |
| **28** | WAF validated against an attack corpus | ⬜ | No WAF. Moot until the web chain exists. |
| **Pipeline** | Document understanding (brick-pipeline) | ⬜ | Fully a target. Today extraction lives in `packages/pkg-rag` and runs **inside the GED container**, synchronously: measured, a 20 MB file freezes that container for 4.3 s. PDF extraction is genuinely solved (per-font ToUnicode); OCR, vision, deskewing, legibility, type recognition and multiplexing all remain to be built. |
| **32-33** | Founding method: a perfect base before specialisation, fractal client fork | ✅ | Method rules, applied rather than "implemented". Writing the doctrine before the code is that method in action. |
| **29** | Constructive integrity | ✅ | Respected: recent fixes (auth, deployment) arrived with their tests. |
| **30** | Snapshot before migration | ⬜ | No fleet migration to date. The rule is waiting for its first case. |
| **31** | Declared data lifecycle | 🟡 | Corrected on 18 September 2026: `dataLifecycle` is declared in `univ-base/manifest.json` and in `_template/manifest.json`, and the manifest schema carries it. It is not yet required — `pkg-verify` does not refuse a manifest without one, so a universe can still ship silent. |

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
| **26** | The governor's storage | 🟡 | `createFileStorage` in `pkg-governor` is a JSONL journal on disk, read back in full at boot: the package's **reference adapter**, and the demo governor's transitional storage. Rule 26 and Rule 37 place the ledger in the governor functional Podman's own private MariaDB; the `storage` slot is the seam, and no database adapter is written. A real governor binds its own (`pkg-governor/INTENT.md`). |
| **37 / 10** | Matrix maturity | ⬜ | The doctrine's invariant `maturity(matrix) ≥ environment(instance)` has no carrier: `grep -rni maturity` over `pkg-governor` and `_maker-template` finds nothing, the row has no maturity field, no manifest sits beside `<sha>.tar.gz`, the maker's inventory is a list of bare digests, and `desire()` accepts any `env` with any `digest`. TARGET: a `matrices` table {digest, maturity, promotedAt} in the governor and a refusal in `desire()`. The invariant binds by reading. |
| **23** | Lanes set from above | ⬜ | The maker template's invariant 4 says its lanes are set from above. Today `poller.mjs` declares `lanes` (default 1) at every poll and `pkg-governor` records them (`maker.lanes = lanes ?? maker.lanes`); `poll()` returns all the work a host owes and the maker truncates to its own lanes. The from-above form — lanes fixed at enrolment, echoed in the poll answer, never more work handed than lanes — is not built. |
| **27** | Silence heard, `manifest.json` of the maker | ⬜ | `silentMakers()` computes which hosts are quiet past an interval and has no caller outside its tests; the poll interval stays local to `poller.mjs` and is not declared to the governor. The maker template lists a `manifest.json` with an `alerting` channel in its document map and ships none — `_maker-template/` holds `INTENT.md`, `poller.mjs`, `recipes/`. The silence is computed, not heard; Rule 27's channel exists by reading. The `verify` check on alerting cannot see a universe that has no manifest at all. |
| **37** | Drift of a living instance | ⬜ | `poll()` derives work from a row's state and deadline only. PURRING is written on STAMPED (and again on VALIDATED or ADOPTED, `updatedAt` re-dated at every transition), but the row carries no `lastPurr`, and `validate` is offered once per life — `needsValidation()` returns false as soon as a VALIDATED or VALIDATION_FAILED event exists: after it nothing observes the instance, the maker's inventory is of matrices, not of instances, and a container that died after its birth stays PURRING forever. Rule 37 says PURRING is dated on every on-time beat. TARGET: the maker declares at every poll the instances it actually runs (by row id, from `lxc list`), the governor re-dates PURRING, and a missing instance becomes stamp work. |
| **11 / 36** | The maker lives in an LXC | ⬜ | Ruled 31 August 2026, not built: the shipped `lxd-*` recipes call `lxc` on the host directly, and `poller.mjs` asks under `os.hostname()`, which inside an LXC is the container's own name — the label the maker's invariant 5 forbids. The LXC form needs a hop whose arguments never cross a remote shell (the recipe travels to the host and reads its positions from stdin as one JSON line, never as an ssh command string) and an identity asked of the HOST, tested with the hostile account string before it ships. Until then the maker runs on the host it acts on, and no key travels in `lxd-stamp.sh` today (`grep -i 'ssh\|authorized\|file push'` finds nothing beyond the matrix import): the Parent's public key as a file in the stamp, as Rule 36 states it, is TARGET with the LXC form. |
| **11** | One matrix, four host kinds, two universe shapes | ⬜ | `lxd-stamp.sh` imports a single file — LXD's unified tarball (`metadata.yaml` + `rootfs/`); `pct create` and plain LXC consume a bare rootfs. The sha256 the recipe verifies names the stored file. Whether one pivot serves the three `lxc`-shape families of Rule 11 (`proxmox`, `lxd`, `liblxc`) — a bare rootfs hashed, wrapped at import by each stamp — is decided by the second recipe (`proxmox-*` or `liblxc-*`), with its proof in `recipes/README.md`. "One truth" across host kinds binds by reading until then. **Gap opened 16 September 2026**: Rule 11 admits the `nested` shape (a universe as a rootful Podman container) and the `nested` host family; this tree ships no `nested-*` recipe and no fleet row of that kind; the only terrain of the family is the vzcriu nested-podman kit (`migration-lab-evidence/vzcriu`, 11 September 2026: privileged outer container, VFS inner store), and PodMesh, optional, manages plain rootful Podman universes and has not stamped a `nested` one. The maker is meant to drive that shape too: where PodMesh is installed, a `nested-*` recipe invokes its typed operations (MAKER-AND-GOVERNOR §4.1); PodMesh's own direction names the same split — one maker per host orchestrates local PodMesh mechanics — and lists the maker integration as steps 6 and 14 of its implementation plan, planned and not implemented. The `nested` shape stamps from an OCI image, a fourth matrix format the pivot question does not cover yet. `defaultRecipeRunner` takes a single `hostKind`: a machine listing two families has no selection rule in code. Rule 16 level 1 for `nested` is TARGET. Closing it means a `nested-stamp.sh` proven on terrain, a runner that reads the class `shape`, and a level-1 restore of a `nested` universe read from outside. |

---

## Helm for every pilot — the gaps declared on 17 September 2026

Verified by reading `brick-helm` in the catalogue (`app/server`), where roles are
`admin`, `operator`, `user` and the control scope is read from the environment
of one deployment (`controlScope.js`). Rules 0F, 24 and 37 were amended the same
day; each line is a gap the rules name as TARGET, promised nowhere else.

| Rule | Subject | Status | What the code actually does |
| :---: | :--- | :---: | :--- |
| **0F / 37** | Jurisdiction | ⬜ | No jurisdiction object exists. Helm's scope is one deployment's environment, not a granted set of universes and pods, and nothing nests one jurisdiction inside another. TARGET: Runtime resolves the pilot's jurisdiction on every request, and Helm answers nothing outside it. |
| **37** | Pilot level | ⬜ | No pilot level is stored, read or proven. `grep -rn "pilotLevel\|jurisdiction"` over the catalogue finds nothing. TARGET: a per-person record of validated levels, written only by pilot training in a `demo` instance, read by Helm before it executes. |
| **0F** | A client at the Helm | ⬜ | `brick-helm` runs as an operator console. No client pilot holds it today, and none may before jurisdiction and pilot level are enforced by code. |
| **24 / 37** | Master root and jurisdiction root | 🟡 | The master root exists in practice: the founding tandem, root from underneath the hosts, directs the governor and makers. No jurisdiction root has been granted. The boundary that keeps a jurisdiction root off hosts, governor and makers binds by reading until a client pilot exists. |
| **0F** | Blank universe | ⬜ | Not offered. No class, recipe or backup contract describes an empty universe granted to an infrastructure client. |

---

## The one live gap to close

**Rule 22 — the silent fallback to a lexical vector.** Still the only place where the code
does what a rule explicitly forbids, but half of it closed on its own: step 1 below is
built. MiniLM ONNX (`@xenova/transformers`, `Xenova/all-MiniLM-L6-v2`) is tried first in
`pkg-rag/lib/embedder.js`.

What is left is the last branch. When no model answers, `generateEmbedding` returns
`generateLocalEmbedding` — a djb2 hash of n-grams — and the caller cannot tell. One way out
remains:

* **Make indexing fail loudly** when no semantic model is available (`PENDING_EMBED`), which
  the rule already provides for, and use the hash nowhere at all.

What is not acceptable is a lexical vector written into a collection presented as semantic,
without the caller knowing. That is the very definition of the "fallback" Rule 0G forbids —
and a fallback nobody sees is worse than one that fails.

---

## How to use this document

* It is updated **when code lands**, never when a rule is written.
* A ⬜ is not shameful debt: it is a target, owned and dated.
* A ⚠️ is a consistency bug and is treated as one.
* **No external promise** — pitch, README, client-facing page — rests on a ⬜ or 🟡 line.
