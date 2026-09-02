> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)

# Kit intent

## Objective

Give a Linux operator and an IDE agent enough intent to **install**, **prove**, and **keep** Shaper OS without weakening RULES.md — including fractal reuse, perimeters, and DEV / TEST / PROD.

## Invariants

1. This repository is **kit + software**. Runnable code lives in `./software/`. One clone is enough.
2. Technical text is **English**. Pair talk with the human may be French.
3. Secrets stay local. Never commit `.env`, vault files, or tunnel tokens.
4. First path: units (`npm test`) → images → deploy → health → **live tests** (`npm run test:live`) → voice/text proof. No skip. Live tests run **after** the stack is up, not before.
5. Generic bricks are reused; a universe only **specializes**. Never copy Containerfiles or packages into a universe.
6. Operator cockpit (`/console`) is perimeter 2. Client shops and CRM are perimeter 3 — never merged into the cockpit. Voice lives in `/console` if Helm is on — never revive `/talk` or `/voice`.
7. Laptop install is **DEV**. TEST rebuilds from scratch then is destroyed. PROD is created once and updated by **git tag**, not by vibe on the live box.
8. Mail and real customer data used in TEST/DEV must never be production mailboxes.
9. **Engine discovery at deployment**: at every stack deployment the deploying agent enumerates the engines actually reachable from the target host, sends a bounded ping, measures, and selects the cheapest one satisfying the brick's declared depth and throughput — recording the measurement with the choice. **No model name is written here**: naming one would date this file the day its vendor ships a successor. Ultra-fast engines stay reserved for acknowledgment and voice micro-tasks and are never exposed as general agent chat models.
10. **Session Prime Isolation**: The session prime prompt (greeting/salutation) must NEVER include output format directives (`CURSOR_OUTPUT_FORMAT`), skills catalogs, or control scope context. These activate on the first real user message. The prime produces only natural text — no tables, no bullets, no markdown formatting. Free models interpret format directives literally and will turn the greeting into a GFM table if these directives are present.
11. **Fractal SSH Authority Asymmetry (Rule 36)**: Parent universes generate an Ed25519 SSH authority key pair in their Vault/`sav/ssh/id_ed25519`. Ephemeral child sandboxes (`<child>-dev`, `<child>-test`) automatically have the Parent's public key injected into `/root/.ssh/authorized_keys` at bootstrap. The Parent uses SSH to build, inject work, and test without touching production in-flight.
12. **Clean-Sheet TEST Sandbox & Garbage Collection**: The `<child>-test` sandbox is built completely from scratch on a blank container. If and only if 100% of tests pass + Rule 29 regression test + Rule 20 typed deliverable, the commit is promoted to PROD via canary (Rule 25), and all `-dev` and `-test` containers, scratch volumes, and ephemeral routes are immediately destroyed (Universe Garbage Collector).

13. **Two doors, one truth**: the repository is read by humans and by AI agents, and they do not receive the same encoding. [`README.md`](./README.md) is the human door and ramps by level; [`AGENTS.md`](./AGENTS.md) is the agent door and routes by capability class — dense principles for models that derive, literal steps for models that must not improvise. The binding text for every reader is `software/RULES.md`, read in full: principles and phases index the canon, they never replace it.
14. <a id="one-canonical-copy"></a>**One canonical copy**: no document exists twice, byte for byte, in this repository. A text reachable from two places has one canonical location and one reference to it. Duplication removes an agent's ability to know which copy is authoritative, and a corrected duplicate is worse than no duplicate.
15. **Declared cognition**: work declares the reasoning depth and the throughput order of magnitude it requires, and what it does when neither is available (`refuse`, `queue`, `allowed-with-note`). No brick names a model. Published throughput is advisory; availability measured from the target host is mandatory, and the measurement is recorded with the choice.
16. **The code is the variable**: model capability will keep moving. Everything that is not code — intent, law, proof, lifecycle, perimeters, cognitive requirements — is written explicitly so that a stronger model produces better code rather than a different architecture. Carte blanche on the implementation; none on the frame.

    <a id="no-orphan-lesson"></a>
    **No lesson lives only in code.** Rule 35 requires both a test and an intent, and says plainly that they are not substitutes: a test constrains this implementation, an intent constrains every future one. V1.12 makes that mechanical rather than a matter of discipline. Every guard test and every shipped script names the intent it serves:

    ```js
    // Intent: docs/architecture/ARTIFACT-BOUNDARY.md#build-context
    ```

    A test enforces it (`pkg-universe/test/intent-coverage.test.js`): a guard that names no intent fails the suite, and so does one naming an intent that does not exist or an anchor the document does not offer. It cannot check that the prose is *right* — that is a human's judgement — but it guarantees the prose exists, is reachable, and was written at the same moment as the guard.

    This was not a theory. Four of V1.11's most expensive findings — every image broken at its first import, four bricks announcing the wrong layer, an image lock that could never be satisfied, a proof that observed a socket and reported evidence — were discovered by building and deploying, and were recorded only in test comments, one refactor from being lost.

    **The corollary is what a repository may hold.** Code that cannot name the frame it serves is not implementation of anything: it is someone's afternoon, preserved. V1.12 removed thirty-four such scripts, and found a genuine guard living in `scripts/`, where `npm test` never looked at it.

17. **Nothing operator-specific is committed**: this repository must be clonable by a different person, deployed under **their** domain, their accounts, their names and their zones, by changing environment values only — never by editing tracked files. Domains, credentials, account identifiers, zone identifiers and hostnames are supplied at deploy time and asked from the human when they are needed. A value that only works for its author is a defect, and it is enforced mechanically: see the domain-agnosticism guard in `software/packages/pkg-logger/test/domain-agnostic.test.js`.

18. **Where a universe lives**: this repository is **generic**. A universe is config and data for one concrete deployment, so it does not belong here by default. Two places, one rule each: `software/universes/_template/` is the **blueprint** every universe is derived from, and `software/universes/univ-base/` is the **reference** the documentation walks through — the base cell itself. A demonstration that needs a catalogue brick belongs to the catalogue; a universe carrying real work, a client, or an experiment lives **outside this repository** — see [`software/universes/README.md`](./software/universes/README.md). A `-test` universe is destroyed after it passes (Rule 10); what survives is its proof, not its folder.

## Read first

[`START-HERE.md`](./docs/human/START-HERE.md) then [`CONCEPTS.md`](./docs/human/CONCEPTS.md) and [`LIFECYCLE.md`](./docs/human/LIFECYCLE.md).
