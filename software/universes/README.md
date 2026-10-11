# software/universes/ — the blueprint, the reference and the maker

> **The rule this directory exists to enforce:** SHAPER OS is a **generic**
> repository. A universe is configuration and data for one concrete deployment.
> It does not belong here by default.

## What is here, and why only this

| Universe | Role |
| :--- | :--- |
| [`_template/`](./_template/) | **The blueprint.** The shape every universe is derived from: univ-minimal's four base units, installed from one recorded revision into the universe's `base/`, then the universe's own units of the same shape. Generic by construction: it names no domain, no account, no catalogue brick. |
| [`univ-minimal/`](./univ-minimal/) | **The base units.** Vault, Logger, Queue and Maestro, each one functional Podman holding its application and its own MariaDB server (Rules 4 and 26), with their birth order, identities, renewal, proof and drills. Deployable as it stands; the blueprint's `base/` is this folder at one revision. |
| [`univ-base/`](./univ-base/) | **The earlier reference, kept as it was.** The five-brick cell of V1.13 and V1.14 main (file stores, one AI bridge), on its older pinned images only ([why](./univ-base/INTENT.md#earlier-shape)). Not a shape to imitate. |
| [`_maker-template/`](./_maker-template/) | **The maker.** The hand of a machine, one per host: it asks its governor what should exist, stamps universes from matrices with frozen recipes, and reports. Generic by construction — it belongs to no project, and it listens on nothing. |

Four entries, and that is deliberate. Everything else that used to sit beside
them — a demonstration cockpit that needed a catalogue brick, a `-test` universe
kept past its verdict — left in V1.11, because each of them taught an agent
something the base cannot honour on its own.

## Where a universe goes

| Kind of universe | Where it lives | Why |
| :--- | :--- | :--- |
| **The blueprint** every universe is derived from | `_template/` | Generic. It is the shape, not an instance |
| **The base units** every universe stands on | `univ-minimal/` | Provable with this repository alone; the blueprint installs it, never copies it |
| **The earlier reference**, kept on its older images | `univ-base/` | Its running instances stay serviceable until their bridge is converted (Rule 26 legacy transition) |
| **A generic organ template** — the maker, one per machine | `_maker-template/` | Generic by construction: the hand of a machine, it belongs to no project |
| **A demonstration that needs a catalogue brick** | The `SHAPER-OS-BRICKS` catalogue | It demonstrates a product. It belongs beside the product |
| **Real work** — a client, a business, a production deployment | **Outside this repository** | It carries someone's data, domain and accounts. Publishing it would publish them |
| **An experiment** — a scratch universe, a harness, a spike | **Outside this repository** | An experiment is a moment of work, not a description of the system |
| **A `-test` universe** | Nowhere, after it passes | It is destroyed by Rule 10. What survives is its **proof**, not its folder |

The last row is the one people bend, so it is worth repeating: a kept TEST
universe becomes a second DEV and stops proving recovery, which was its only job.
The V1.7 clean-sheet verdict is kept as evidence in
[`../../docs/proof/proof-univ-v17-test.md`](../../docs/proof/proof-univ-v17-test.md);
the universe that produced it is gone, as the rule requires.

## Rules that apply to anything placed here

1. **No domain, no credential, no operator identity.** These are published files
   like any other; the domain-agnosticism guard runs over them too.
2. **Reference, never copy.** A universe references generic bricks through its
   manifest and specialises them by parameter. A `Containerfile` or a package
   copied into a universe folder is a fork (Rules 32, 33).
3. **Declare the origin of every brick.** Each entry in `bricks` states
   `source: base` or `source: catalogue`. A universe here that needs
   `source: catalogue` is a universe that belongs in the catalogue.
4. **It must validate.** `@shaper/pkg-universe` validates every manifest in this
   tree on every test run. A manifest that does not validate is not a universe.

<a id="materialise-before-mount"></a>
## 5. A deployment creates what it mounts, before it mounts it

Every directory a deploy script binds into a container is created by that same
script, before the container starts. A universe does not assume a path exists
because it existed on the machine where the script was written.

*Why this is written here.* A clean-sheet deployment stopped because `sav/queue`
was mounted without being created. The specific path was fixed in an afternoon;
the class of defect is permanent, because a bind mount to a missing directory
fails in a way that names the container rather than the mistake. The machine
where a script is written always has the directories — that is precisely why the
author cannot see them.

<a id="explicit-startup-posture"></a>
## Explicit image locks and dormant startup

A universe derived from `_template/` takes both from its base units
(`univ-minimal/deploy/podman-up.sh` at the revision installed in `base/`): each
image comes from `cfg-image-lock.json` (one immutable digest per unit) or, in
DEV, from an explicit `SHAPER_REGISTRY` and `SHAPER_IMAGE_TAG`, never from a
guess, and its `org.shaper.unit.*` labels must match the manifest before any
unit is touched; Queue never dispatches to an engine, Maestro submits only the
declared schedule (none in the template), and every unit binds `127.0.0.1`.
A published tag is never moved.

The earlier template's `SHAPER_IMAGE_LOCK_FILE`, `QUEUE_AUTO_DISPATCH`,
`MAESTRO_AUTO_START`, `OPENCODE_BRIDGE_BIND` and `*_HOST` switches belonged to
its file-store, bridge-bearing script
([`proof-dormant-factory-source-2026-09-10.md`](../../docs/proof/proof-dormant-factory-source-2026-09-10.md));
a universe that copied that script keeps it, and the images it pinned, as they
are ([`_template/INTENT.md#earlier-template`](./_template/INTENT.md#earlier-template)).
