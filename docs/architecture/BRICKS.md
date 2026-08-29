# The Bricks — Four Classes, One Taxonomy

> **Two repositories, one line between them.** This repository ships the bricks
> whose behaviour SHAPER's own law defines: vault, logger, queue, maestro, auth,
> agent, supervisor and the engine bridges. Packaged products — a cockpit, a
> document hub, a vector store, a database, a firewall — follow an upstream
> rather than a law, and live in [`SHAPER-OS-BRICKS`](https://github.com/xavdp-pro/SHAPER-OS-BRICKS-V1.13).
>
> The criterion is not size and not usefulness: **who wrote the behaviour.** A
> brick that implements the doctrine is maintained with the doctrine. A brick that
> wraps something the world already made has its own versions, its own
> vulnerabilities, and its own release pace — an independent life deserves an
> independent repository.
>
> Third-party servers used as-is — MariaDB, Qdrant, cloudflared — are not bricks
> at all: a universe references them by image, and no repository carries them.

> **Why this file exists.** Until v1.8 the repository gave **three** different
> answers to "what is the base of SHAPER OS", in three places, with no statement
> that they answered different questions. Each was true. Together they were an
> ambiguity, and an agent had no way to pick. They are reconciled here, once.

| The question actually being asked | The answer | Where it is declared |
| :--- | :--- | :--- |
| **What must run** for a universe to exist? | **Runnable core** — five bricks: vault, logger, agent bridge, queue, maestro | `manifest.tier-a.json`, started in `bootOrder` |
| **What can an agent count on finding** in any universe? | **Cell services** — the core plus services consumed in-process, notably auth and supervisor | The cell diagram in [`../../README.md`](../../README.md) |
| **What belongs to the foundation perimeter** (P1), as opposed to the cockpit (P2) or a business app (P3)? | **P1 packages** — vault, logger, auth, db, queue | [`../../software/docs/PERIMETERS.md`](../../software/docs/PERIMETERS.md) |

The three sets differ **because the questions differ**, not because one is
wrong. Maestro runs but is not P1; auth is P1 but is not required to boot a
tier-a universe; the bridge is required to boot and is not a foundation package.
Quote a set only with the question it answers.

A brick is a container (Principle 2: one intent, one container). A package is
code a brick or a universe consumes. Every runnable core brick is both.

## Artifact boundary

Runtime role answers what must run. Distribution answers who owns the
behaviour. The base and the catalogue are therefore separate even when a
universe composes both. The exact contract, registry flow and first isolated
Vault build are in [`ARTIFACT-BOUNDARY.md`](./ARTIFACT-BOUNDARY.md).

---

## Class 1 — Runnable core (always, in this boot order)

| Brick | Port | Role | What breaks without it |
| :--- | :---: | :--- | :--- |
| `brick-vault` | 8610 | Sovereign encrypted secret store | Nothing can authenticate. Secrets would have to live in plaintext env files — the failure this system exists to prevent. |
| `brick-logger` | 8620 | Immutable JSONL audit trail | No proof is possible. Work still happens, but nothing can be shown to have happened (Principle 3). |
| `brick-bridge-*` | 4440 | The agent bridge — exactly one is core | No agent can act. The universe becomes a passive stack of services. |
| `brick-queue` | 8640 | Asynchronous job lanes, persistence, quality gate | Work becomes synchronous and unbounded; a heavy task blocks or kills the machine, and terminal answers are lost. |
| `brick-maestro` | 8630 | Beat scheduler and dispatcher | Nothing happens unless a human triggers it. The system stops being autonomous. |

**Boot order:** `vault ∥ logger → bridge → queue → maestro`.

Vault and logger start together because everything else depends on both. The
bridge before the queue because the queue dispatches to it. Maestro last because
it triggers work and must never fire into a stack that is not ready.

## Class 2 — Adapters (interchangeable, one is promoted to core)

These are engine bridges. Rule 0H makes them commodities: swapping one requires
no structural change, because they all expose the same interface.

| Brick | Engine | Note |
| :--- | :--- | :--- |
| `brick-bridge-opencode` | OpenCode CLI, free models | Default bootstrap — zero cost, no paid key |
| `brick-bridge-agy` | Antigravity CLI | Contextual perimeter injection |
| `brick-bridge-cursor` | Cursor Composer | Interactive class — see Rule 21 `interactive: true` |
| `brick-bridge-deepseek` | DeepSeek / Ollama Cloud | On-premise and air-gapped paths |

Adapters **provide** cognition rather than require it — see the distinction
below. Choosing between them is a human decision (Rule 0H), informed by
measurement from the target host, never by a published ranking alone.

## Class 3 — Extensions (declared per universe, never assumed)

| Brick / package | Role | Status |
| :--- | :--- | :--- |
| `brick-helm` | Operator cockpit `/console` + voice (8650) | Live — perimeter 2 only, never a client-facing UI (Rule 0F) |
| `@shaper/pkg-auth` | Bearer verification, executed inside the service it protects | Live — a package, not a brick: it has no port, no lifecycle and no image |
| `@shaper/pkg-supervisor` | Ingests vitals, grades child health (`nominal`/`degraded`/`failing`) | Live — required for a parent universe, not for a leaf |
| `brick-ged` | Sovereign document hub, content-addressable storage | Live |
| `brick-qdrant` | Vector store for semantic memory | Live |
| `@shaper/pkg-rag` | Semantic ingestion, multi-tenant vector isolation | Live |
| `brick-pipeline` | Multi-witness document understanding + mechanical arbiter | **TARGET** — see [`MISSING-BRICKS.md`](./MISSING-BRICKS.md) |
| `brick-waf` | Sovereign routing firewall: agent-generated allow-list, routing, precomputed cache | **TARGET** — see [`MISSING-BRICKS.md`](./MISSING-BRICKS.md) |
| `brick-billing` | Stripe webhooks, subscriptions & auto-invoicing (:8690) | **TARGET** — see [`MISSING-BRICKS.md`](./MISSING-BRICKS.md) |
| `brick-voice` | Local Whisper STT & low-latency voice synthesis (:8670) | **TARGET** — see [`MISSING-BRICKS.md`](./MISSING-BRICKS.md) |
| `brick-messaging`| WhatsApp Pro, Telegram & Signal chat/photo ingress (:8665) | **TARGET** — see [`MISSING-BRICKS.md`](./MISSING-BRICKS.md) |
| `brick-caldav` | 2-way CalDAV/ICS calendar sync & online slot booking (:8675) | **TARGET** — see [`MISSING-BRICKS.md`](./MISSING-BRICKS.md) |
| `brick-pdf` | Multi-page PDF splitting, barcode tagging & eIDAS signature (:8685) | **TARGET** — see [`MISSING-BRICKS.md`](./MISSING-BRICKS.md) |
| `brick-mail-intake` | Dedicated continuous IMAP IDLE mail listener daemon (:8655) | **TARGET** — see [`MISSING-BRICKS.md`](./MISSING-BRICKS.md) |
| `@shaper/pkg-mail-agent` | Inbound mail triage into jobs | Live — production mailboxes forbidden in DEV/TEST (Rule 9) |

Full technical specifications, ports, and implementation contracts for all target bricks: [`MISSING-BRICKS.md`](./MISSING-BRICKS.md).

An extension is never started "because it exists". If it is not in the manifest,
it is not part of this universe.

## Class 4 — Data bricks (a different lifecycle entirely)

| Brick | Role | Lifecycle rule |
| :--- | :--- | :--- |
| `brick-mariadb` | Per-universe relational database | One database per universe, never shared (Rule 26). Snapshot before any migration (Rule 30) |
| Volumes | Persistent state of any brick | Declared per universe (Rule 31), backed up at multiple levels (Rule 16) |

Principle 9: code is disposable, data is not. You may destroy a universe. You
may not destroy its data as a side effect of destroying the universe.

---

## Requires cognition vs provides cognition

Tagging every container with a required intelligence level would be wrong, and
the reason is worth stating: **most infrastructure bricks need no model at all.**

| | Meaning | Bricks |
| :--- | :--- | :--- |
| **Provides** | The brick *is* the access to intelligence. Its declaration describes what it can supply. | All adapters (`brick-bridge-*`) |
| **Requires** | The brick consumes intelligence to do its own work. | `brick-ged` (analysis), `brick-pipeline` (vision witness), `@shaper/pkg-agent-runtime` (task execution, inside `brick-maestro`) |
| **Neutral (D0)** | Deterministic. No model, ever. | `vault`, `logger`, `queue`, `maestro`, `mariadb`, `qdrant`, `supervisor` |

The queue is the clearest case: the queue itself is `D0` — dispatching is
mechanical — while **each job it carries declares its own requirement**. That is
where the cognitive requirement actually belongs.

### Task-level requirements (the useful table)

| Task | Depth | Throughput | Degraded |
| :--- | :---: | :---: | :--- |
| Voice acknowledgment, streaming ack | `D1` | `T0` | `refuse` — a slow ack is worse than none |
| Text classification, field extraction, log tagging | `D1` | `T2` | `allowed-with-note` |
| Cockpit conversation with the operator | `D2` | `T1` | `allowed-with-note` |
| Standard deployment from a written contract | `D2` | `T2` | `queue` |
| Clean-sheet TEST, incident diagnosis, parent-side repair | `D3` | `T2` | `refuse` |
| Changing law, intent, or taxonomy | `D4` | any | `refuse` — human co-signature (Rule 24) |

Scales, degradation policies, and the declaration format:
[`COGNITION.md`](./COGNITION.md).

---

## Where a universe directory goes

A tester found two procedures creating universes in two different places and
could not tell which was canonical. Both exist for a reason, and here is which
applies:

| Case | Location | Why |
| :--- | :--- | :--- |
| You are deploying a universe to use | `<univ_slug>-dev/` **beside** the repository, or anywhere outside it with `SHAPER_ROOT` pointing at `software/` | A universe holds config and data. Real work does not belong in a generic repository (INTENT invariant 18) |
| You are running the clean-sheet TEST described in the LXC guide | `software/universes/<univ_slug>-test/` | It is destroyed at the end (Rule 10). Only its `proof/VERDICT.md` survives, and it survives *inside* the repository, which is why the folder starts there |
| You are writing a demonstration the documentation walks through | `software/universes/univ-base/` if the base alone proves it, otherwise the catalogue | Reference material, kept few — see [`../../software/universes/README.md`](../../software/universes/README.md) |

The deploy script finds the software tree by walking up until it sees
`software/`, so a universe beside the repository works with no configuration. One
placed further away needs `SHAPER_ROOT`; without it the script halts and says so.

## The rule that governs all four classes

You **reference** a generic brick and **specialise** it through the manifest. You
never copy a `Containerfile` or a package into a universe folder. A universe that
contains its own copy of a brick has forked the base, and the fork will diverge
silently (Principle 6, Rules 32 and 33).
