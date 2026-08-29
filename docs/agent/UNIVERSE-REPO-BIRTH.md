# UNIVERSE-REPO-BIRTH — When a Universe Leaves Home

> **Audience:** any agent about to materialise a universe that is extended,
> specialised, or bound for production.
> **Force:** operational doctrine. It applies Rules 32, 33, 0E and 36; it
> softens none of them.

## The rule of birth

**A universe meant for production is born in its own git repository.** The base
repository (`SHAPER-OS`) and the catalogue (`SHAPER-OS-BRICKS`) are its
*upstreams*: they provide the law, the schemas, and the bricks — by **image and
tag**, never by path, never by source import. From the day a universe has its
own repository, its upstreams are touched for exactly one reason: **an incident
climbed back** (Boot Contract, point 8) — a functional defect, a missing
constraint, a wrong intent. Never to host the universe's daily life.

An operator with many universes to create does not make the base repository
live faster; they make it live **less**. The base is finished when it is boring
(Rule 32). Its churn is a defect signal, not a sign of health.

## Class and instance — the distinction that makes replication cheap

Two things are easily confused, and confusing them is what turns "replicate at
will" into "fork forever":

| | A universe **class** | A universe **instance** |
| :--- | :--- | :--- |
| What it is | A template: intent, manifest shape, brick set, tests | One materialisation for one owner |
| Where it lives | **A repository of its own** (`univ-boutik-shop`) | **Data, not a repository**: a `manifest.json`, a vault, volumes |
| How many exist | One per kind of universe | As many as subscriptions demand |
| How it changes | Commits, reviewed, versioned, tagged | Redeployed from its class at a named tag |

A client's tenth shop is not a tenth repository — it is a tenth **manifest**
deployed from `univ-boutik-shop` at an immutable tag, with its own vault and its own
volumes. The repository count grows with the *kinds* of universes you invent,
not with the number of clients who subscribe.

**The exception is Rule 33**, and it is deliberate: when one owner's
requirements reach into the socle itself — security posture, compartmentation,
regulation — that owner's universe forks into its own repository, divergence
assumed. The fork records what it diverged from and why, and generic
improvements found there travel back upstream.

## The birth procedure

1. **`git init`** a fresh repository named for the class:
   `univ-<projet>-<classe>` (Rule 1 — projet is one word; a single-class
   project takes `-core`) — never a copy of the base with folders deleted.
2. **Record the lineage first.** A `LINEAGE.md` at the root, before any code —
   copy [`examples/universe-LINEAGE.md`](../../examples/universe-LINEAGE.md):
   which base version it was cut against (`SHAPER-OS-V1.13`), which catalogue
   bricks it consumes and at which image tags, and why this universe exists.
   A repository whose origin is unknown cannot be maintained (Rule 33.1).
3. **Copy templates, never mechanisms.** Take `examples/universe-INTENT.md`,
   `examples/universe-AGENT-DEPLOY.md` and a manifest as starting points.
   Copying `software/packages/` or a brick `Containerfile` is forbidden
   (Rule 32, Boot Contract forbidden list): the day the base fixes a bug, a
   copied mechanism keeps it.
4. **Reference every brick by image identity, pinned by the lock** (Rule 0E).
   The manifest entry is the whole dependency, in the schema's real shape:

   ```json
   "brick-ged": {
     "source": "catalogue", "perimeter": "P2",
     "package": "@shaper/pkg-ged-engine", "image": "img-ged",
     "intent": "SHAPER-OS-BRICKS-V1.13/bricks/brick-ged/INTENT.md",
     "role": "Document memory of this universe"
   }
   ```

   The `image` field carries the `img-` identity; the **immutable tag and
   digest live in `cfg-image-lock.json`** (the manifest's `imageLock` field),
   never inline. If the universe needs a brick the
   catalogue does not have, the brick is *contributed to the catalogue*, then
   consumed by tag like any other. **The boundary in one line: a brick goes
   to the catalogue when its INTENT can be written without the business
   word.** A brick whose intent cannot avoid naming the client or the
   vertical is `source: native` and stays in the class repo (Rule 37).
5. **Secrets exist only in the vault.** No `.env` is ever tracked; every
   fallback of the shape `process.env.X || '<a real value>'` is a committed
   credential with extra steps (Boot Contract 10b).
6. **Carry the law without carrying the base.** The universe repository runs
   the verifier in its CI, on a clean clone. **The sanctioned channel today**:
   CI clones the base at the tag LINEAGE.md names, beside the class repo, and
   runs `node ../SHAPER-OS-V1.13/software/packages/pkg-verify/verify.mjs
   --root .` — an explicit, pinned exemption to the no-path rule, for CI
   only, never for runtime imports. (`@shaper/pkg-verify` is not published to
   a registry yet; when it is, the pinned package replaces the clone.) The
   checks are generic and need no configuration. `RULES.md` still binds by
   reading; the verifier is the part that binds by machine.
7. **Live by the suffix discipline** (Rule 36): `-dev` ephemeral, `-test`
   rebuilt clean-sheet and destroyed after its verdict, `-prod` permanent —
   promoted only through the canary protocol, operated by the parent, never by
   the universe on itself (Rule 23).
8. **Register the class in its scope's fleet map** —
   [`docs/architecture/FLEET.md`](../architecture/FLEET.md): one entry in
   `<scope>-fleet/fleet.yml` (name, repo, tag, `governedBy`). Today this is a
   manual PR; `shaper new` will automate it (TARGET). The registration guard
   is also TARGET — until it ships, this step is held by reading, which is
   exactly why it is written as a numbered step and not a footnote.

## What crosses the boundary, and in which direction

| Downstream (upstream → universe) | Upstream (universe → upstream) |
| :--- | :--- |
| Brick images, at immutable tags | An incident, as a fix **and** its non-regression test (Rule 29) |
| The manifest schema and profile vocabulary | A missing constraint, as a rule amendment |
| The law and the verifier | A capability a fork revealed, made generic (Rule 33.3) |
| Template intents and examples | Nothing else — no universe code, no client particularity |

What never crosses, in either direction: source imports, secrets, one owner's
particularity into a shared brick.

## Naming

*(Amended in V1.13 — this section used to say `univ-<class>-<owner>` for a
fork, which contradicted the projet-first grammar; the fortress archetype
forced the resolution: the owner becomes the projet word.)*

`univ-<projet>-<classe>` for the class repository — projet is one word, a
single-class project takes `-core` (Rule 1). A Rule 33 fork follows the
**mirror rule**: swap only the projet word, keep every classe word verbatim
(`univ-boutik-shop → univ-fortex-shop`), and declare repo-level
`forkedFrom { repo, atTag }` in the manifest so `shaper verify` can hold it
(Rule 37). `<slug>-dev` / `<slug>-test` / `<slug>-prod` for the running
instances (Rule 36). The fractal DNS naming of a fleet's children is
`pkg-fleet-dns`'s contract, not a convention to improvise. The full
vocabulary is one page: [`../architecture/LEXICON.md`](../architecture/LEXICON.md).
