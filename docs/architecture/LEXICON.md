# LEXICON — the language of the tree, on one page

> **Status**: sealed by [Rule 37](../../software/RULES.md#rule-37). A new noun
> enters only by amending that rule, with the failure it prevents written
> beside it. Born in V1.13 from the ZEST convergence: five archetype designs,
> three adversarial critiques, every synonym killed. Amended 2 September 2026
> by the maker-and-governor verdict: four words entered (governor, maker,
> matrix, REAPED), the ledger row and the forge's line were bounded, and a
> test (`lexicon-and-code-agree.test.js`) now holds this page, Rule 37 and
> `pkg-governor`'s states to one set of names. Amended 4 September 2026: two
> words entered (rig, tool) — the first names what is delivered, which until
> then had no name at any of the three desks that spoke of it; the second
> separates an agent's declared capability from the brick that runs it.
> `steward` did NOT enter: it is `brick-steward`, and Rule 37 holds that new
> bricks are not new nouns. Amended 17 September 2026 (one Helm for every
> pilot, Rule 0F): four words entered (Helm, jurisdiction, root, pilot level).
> Helm names the one human interface to an ecosystem, whoever holds it; root
> has two strata, the master root and a jurisdiction root; the pilot level is
> proven in a demo instance, never declared. `KovZu` is retired and
> `Control Hub` refused, both as synonyms of Helm. Same day, one word one
> meaning: PodMesh, which had called its per-host agent a maker and its active
> manager replica a governor, now says *PodMesh node* and *active manager* in
> its prose, code and identifiers (podmesh `9dec49c`, `1ab9cf8`, `531d5ed`, with
> a lexicon test); Rule 11 states those positive names, and governor and maker
> keep their Rule 37 meaning only.

## The three grammar rules (they held at every scale)

1. **`univ-<projet>-<classe>`** — projet is ONE word, no hyphen. A single-class
   project takes `-core`. Parse: `^univ-[a-z0-9]+(-[a-z0-9]+)+$`.
2. **Position lives in data, never in the slug** — LINEAGE.md, manifest,
   ledger. *The identifier says WHAT a thing is; structured data says WHENCE
   it comes and WHERE it sits.*
3. **A class has a repo; an instance never does** — an instance is a ledger
   row + a vault + volumes.

## The prefixes (existing law, unchanged — Rule 1 + [NAMING.md](./NAMING.md), the canonical table)

`univ-` `brick-` `pkg-` `img-` `ctr-` `vol-` `cfg-` `ctx-` `task-` `proof-`
— a new brick is **not** a new noun: `brick-forge`, `brick-scraper`,
`brick-sso` are the prefix system doing its job.

## The twenty-three words

| Word | One sentence |
| :--- | :--- |
| **class** | A universe model: one git repo, versioned, tagged (`univ-boutik-shop`) |
| **instance** | One materialisation of a class: ledger row + vault + volumes — never a repo |
| **ledger** | THE desired-state table: one row per instance (`id`, `account`, `klass`, `matrix`, `digest`, `machine`, `env`, `state`, `params`, `deadlineAt`, `createdAt`, `updatedAt`, `events[]`) in the governor functional Podman's own private MariaDB; the R2 bucket is derivable (`r2://<id>`), never a column. The contract ships with `pkg-governor` (BINDING). *The only allowed name — "placement" survives only as the machine column* |
| **drift** | Any gap between the ledger and what actually runs — the sole repair trigger (Rule 27 governs the ladder) |
| **PURRING** | The **dated** healthy state written on every on-time beat when observed == desired. One state machine everywhere: `DESIRED → RECONCILING → PURRING → DEGRADED`, plus the terminal `REAPED`. DEGRADED rests and never self-clears: it is left by its account's new ask where a robot may end (dev, test, demo), by human action alone in prod (Rule 27) |
| **REAPED** | The terminal end of a row: a maker ended the universe on the row's deadline and looked, or a human did. *Prevents*: a reaped row still counted as living, blocking its account and pinning its matrix |
| **status.json** | The canonical per-instance surface (state + lastPurr + lastBackup). Every board, tile or STATE file is a rendering of it, never a rival |
| **board** | THE fleet view: one line per ledger row, all machines. Terminal twin `shaper board`. Offline, `cat fleet.yml` tells you what SHOULD exist — health only ever comes from status.json |
| **fleet map** | The `fleet.yml` in a `<scope>-fleet` repo: base, catalogue, classes pinned to immutable tags, plus machines. Never instances. `-dev` bypasses it; `-test`/`-prod` are guarded by it |
| **forge** | `brick-forge`: the organ that deploys/destroys/repairs BRICKS inside a living universe (brick level; escalation restart → rebuild → redeploy + R2). Universes are born and ended by the maker, from a ledger row |
| **forkedFrom** | The lineage proof, at both levels: brick `{package, atVersion}`, repo `{repo, atTag}` — machine-checkable |
| **mirror rule** | A Rule 33 fork swaps the projet word and NOTHING else: `univ-boutik-shop → univ-fortex-shop`. A fork costs zero vocabulary |
| **source / perimeter** | Brick fields: `source ∈ {base, catalogue, fork, native}`; `perimeter ∈ {P1, P2, P3}` = **LAYER, never OWNER** |
| **governor** | The universe that holds a ledger and makes it respected: writes what should exist, dates what makers report, never dials out. *Prevents*: "the SaaS" and "the manager" naming two things — the product and the organ — and the maker learning which one it serves |
| **maker** | The hand of a machine, one per machine: asks its governor what should exist on its host, runs a frozen recipe (`<kind>-<work>.sh`) with typed positions, reports a fact, never decides. *Prevents*: a script on a host whose state nobody knows, and a form field reaching a shell |
| **matrix** | The locked, content-addressed artefact (sha256) from which instances are stamped; baked by the tandem from a class, never by a robot. *Prevents*: "image" meaning both a podman image and a universe archive, and five builds of one commit giving five fingerprints |
| **rig** | The assembled solution: the classes it takes, the bricks they declare, and the declarations that shape them (sector profile, tool catalogue, seed), pinned together. NOT a class — a class is one repo, a rig is what is delivered (the demo rig = `univ-demo-saas` + `univ-demo-crm` + the entry door + the maker, at named tags). *Prevents*: "the demo" meaning one repo to whoever builds it, two to whoever deploys it and the whole visitor chain to whoever sells it — so what a client buys has no name, no version, and no way to be assembled twice the same |
| **tool** | One declared capability a class exposes to its agent, typed contract, closed catalogue: the agent fills it, the human validates it, then it executes. *Prevents*: `tool` naming both a deliverable unit and an agent capability (the unit is a brick); and free text reaching an action because nothing declared what may be asked |
| **Helm** | The conversational interface between a human and the ecosystem in their charge (web or mobile web, text or voice), set by a jurisdiction and a pilot level and by nothing else; it sends requests to Runtime and never holds authority (Rule 0F). `brick-helm` implements it, `univ-helm-core` specifies it: the word names that contract, not one brick. *Prevents*: KovZu, Helm and "Control Hub" naming one surface under three authority models, so the operator's cockpit and the client's portal were designed twice and a customer's question had no defined boundary |
| **jurisdiction** | The universes a pilot is in charge of, down to their constituent pods, granted by the root above; Helm sees and answers nothing outside it. Jurisdictions nest, narrower inside wider, never the reverse. *Prevents*: "tenant", "galaxy", "portfolio" and "scope" naming four perimeters for one question, and a client's agent answering with another client's universe |
| **root** | Full power over a jurisdiction, held by a human–agent tandem, reaching underneath its universes to their pods. Two strata: the **master root**, the founding tandem at the top of the fractal (root from underneath every host, sole director of governor and makers, keeper of matrices and backup contracts, grantor of every jurisdiction, Rule 24's root universe); a **jurisdiction root**, the tandem a jurisdiction is granted to, with full power inside it and none over a host, the governor, a maker, a matrix, a class repo, another jurisdiction or its backup contract. *Prevents*: "root" meaning only the top of the tree, so a client entrusted with their own universe was either denied that power or silently handed the host beneath it |
| **pilot level** | What a person at the Helm has validated for one class, E0 to E5 (familiar work, ask Helm, delegate once, pilot, standing mandate, shape the environment), proven by pilot training in a `demo` instance of that class, never declared; a level proven on one class says nothing about another. Root and mandate say what a pilot may do; the level says what Helm executes directly, and above it Helm prepares and routes for validation. *Prevents*: authority read as competence — a jurisdiction root applying to production a change they could not yet name |
| **shape** | What a universe's container is, declared by its class (`shape` in `manifest.json`, `lxc` when absent): `lxc` or `nested` (Rule 11); a host family is how a machine makes it, and a machine may offer several. *Prevents*: one token naming both what a universe is and how a host builds it |

## The six verbs (one dialect, one target grammar)

Only `verify` is **BINDING** today — its real invocation is
`node software/packages/pkg-verify/verify.mjs [--root <repo>]`. The other five
are **TARGET**: the contract is sealed here so five dialects never grow back,
and the tool arrives with `brick-forge`.

```
shaper new <class>             # TARGET — birth: LINEAGE first, fleet.yml PR automatic
shaper verify [--root]         # BINDING — the executable law, identical everywhere
shaper deploy <slug>-<env> [--on <machine>]    # TARGET
shaper snapshot / restore <slug>-<env>         # TARGET
shaper pra                     # TARGET — clone the fleet map → redeploy at tags → data from R2
shaper board                   # TARGET — is everything purring?
```

Killed in critique: `subscribe` (a P3 app action, not a fleet verb),
`new-instance`, bare-owner addressing (`deploy dupont`).

## The page test

A human juggling four vibecoded projects, or an agent landing cold, must
answer from THIS page alone: *where is the truth?* (the ledger) — *who
repairs?* (the forge, on drift, inside a universe) — *who births?* (the
maker, from a row) — *is everything fine?* (the board, rendering
status.json) — *how is it all recreated?* (`shaper pra`: fleet map + R2,
Rule 16) — *who may act here?* (the root of this jurisdiction, through Helm,
at its pilot level). A proposal that does not fit this page does not enter the language.
