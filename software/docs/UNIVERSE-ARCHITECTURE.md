# SHAPER OS — Universe Architecture (Fractal 4-Layer Model)

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)  
> **Perimeter law (P1/P2/P3)**: [`PERIMETERS.md`](./PERIMETERS.md) — universes are **P1+P2 sandboxes**, not P3 business verticals.

Each `universes/<slug>/` is a **parameterized deployment project** consuming generic SHAPER-OS bricks. Four documents — four audiences — zero duplication of philosophy in JSON.

---

## Layer Map

```
SHAPER-OS/                          GLOBAL
├── topology.json                   Who exists, boot graph (all universes)
├── bricks/brick-*/INTENT.md        Generic law per brick
└── packages/@shaper/*              Testable code

universes/<slug>/                   SPECIFIC (one project / test env)
├── INTENT.md                       Law for this universe (human + agent)
├── manifest.json                   Machine wiring (bricks + specialize paths)
├── AGENT-DEPLOY.md                 Deploy agent capabilities & pipeline
└── context/AGENT-CONTEXT.md        Runtime AI agent (business context at beat)
```

---

## Document Roles

| Document | Audience | Language | Answers |
| :--- | :--- | :--- | :--- |
| **INTENT.md** | Human + any agent | English | *What* is this universe? *Why*? 4–6 invariants (the law) |
| **manifest.json** | Scripts, CI, deploy agent | JSON | *Which* bricks? *Where* are params? *Boot order*? |
| **AGENT-DEPLOY.md** | Deploy agent only | English | *What can you do alone?* Materialize, test, bootstrap — step by step |
| **AGENT-CONTEXT.md** | Runtime AI (agy/cursor) | English | *What business rules apply* when `/api/inject` fires? |

---

## Deploy Agent Read Order (mandatory)

```
1. universes/<slug>/INTENT.md        ← respect invariants (law)
2. ../../docs/PERIMETERS.md          ← P1 / P2 / P3 — universe = P1+P2 sandbox
3. universes/<slug>/manifest.json    ← load brick graph + specialize paths
4. universes/<slug>/AGENT-DEPLOY.md  ← execute pipeline within capabilities
5. ../../topology.json               ← global boot order if manifest silent
6. bricks/*/INTENT.md                ← per-brick law before materializing
```

**Never read** `AGENT-CONTEXT.md` for deploy — that file is for runtime AI beats only.

---

## Specialization Rules (fractal without copy-paste)

| Action | Allowed | Forbidden |
| :--- | :--- | :--- |
| Add `instance.json` | ✅ | — |
| Add `tasks/maestro-tasks.json` | ✅ | — |
| Edit `context/AGENT-CONTEXT.md` | ✅ | — |
| Copy `Containerfile` into universe | — | ❌ |
| Copy `packages/*` into universe | — | ❌ |
| Hardcode mailbox password in universe | — | ❌ (use vault bootstrap) |

---

## Materialization Pipeline (Rule 0E)

| Step | Agent action | Proof |
| :--- | :--- | :--- |
| 1. intent | Read INTENT + manifest | — |
| 2. materialize | Build generic brick images from `bricks/` | Podman build OK |
| 3. test | `npm test` + universe integration tests | All green |
| 4. registry | Tag immutable image (human validates) | `v1.x.y` |
| 5. deploy | Quadlet + env from manifest specialize | Health checks |

---

## Two Agents, Two Contexts

```
┌─────────────────────┐     deploy time      ┌──────────────────────┐
│  Deploy Agent       │ ──────────────────►  │  Podman + Quadlets   │
│  (Cursor / CLI)     │   AGENT-DEPLOY.md    │  vault logger maestro│
└─────────────────────┘                      └──────────┬───────────┘
                                                        │ beat / inject
┌─────────────────────┐     runtime          ┌──────────▼───────────┐
│  Runtime AI Agent   │ ◄──────────────────  │  bridge-agy /api/inject│
│  (agy, cursor…)     │   AGENT-CONTEXT.md   │  every 300s cadence  │
└─────────────────────┘                      └──────────────────────┘
```

---

## New Universe Checklist

1. Copy `universes/_template/` → `universes/<slug>/`
2. Write `INTENT.md` (objective + 4 invariants)
3. Fill `manifest.json` (bricks + specialize)
4. Fill `AGENT-DEPLOY.md` (what deploy agent may do for this env)
5. Fill `context/AGENT-CONTEXT.md` (business rules for runtime AI)
6. Add `bricks/<instance>/instance.json` per mailbox or ops task
7. `npm run vault:bootstrap` → `npm test` → deploy
