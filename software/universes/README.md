# software/universes/ — the blueprint and the reference

> **The rule this directory exists to enforce:** SHAPER OS is a **generic**
> repository. A universe is configuration and data for one concrete deployment.
> It does not belong here by default.

## What is here, and why only this

| Universe | Role |
| :--- | :--- |
| [`_template/`](./_template/) | **The blueprint.** The shape every universe is derived from. Generic by construction: it names no domain, no account, no catalogue brick. |
| [`univ-base/`](./univ-base/) | **The reference.** The six-brick base cell, deployable as it stands, and the manifest an agent should imitate. |

Two entries, and that is deliberate. Everything else that used to sit beside
them — a demonstration cockpit that needed a catalogue brick, a `-test` universe
kept past its verdict — left in V1.11, because each of them taught an agent
something the base cannot honour on its own.

## Where a universe goes

| Kind of universe | Where it lives | Why |
| :--- | :--- | :--- |
| **The blueprint** every universe is derived from | `_template/` | Generic. It is the shape, not an instance |
| **The reference** the documentation walks through | `univ-base/` | The base cell itself, provable with this repository alone |
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
