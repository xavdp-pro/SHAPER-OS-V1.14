# univs/ — Demonstration universes

> **The rule this directory exists to enforce:** SHAPER OS is a **generic**
> repository. A universe is configuration and data for one concrete deployment.
> It does not belong here by default.

## Where a universe goes

| Kind of universe | Where it lives | Why |
| :--- | :--- | :--- |
| **The blueprint** every universe is derived from | [`../software/universes/_template/`](../software/universes/_template/) | Generic. It is the shape, not an instance |
| **A demonstration** the documentation actually walks through | **Here, in `univs/`** | Reference material. Deliberately few, and domain-agnostic like everything else |
| **Real work** — a client, a business, a production deployment | **Outside this repository** | It carries someone's data, domain and accounts. Publishing it would publish them |
| **An experiment** — a scratch universe, a harness, a spike | **Outside this repository** | An experiment is a moment of work, not a description of the system |
| **A `-test` universe** | Nowhere, after it passes | It is destroyed by Rule 10. What survives is its **proof**, not its folder |

The last row is the one people bend, so it is worth repeating: a kept TEST
universe becomes a second DEV and stops proving recovery, which was its only job.

## What is here

| Universe | Role |
| :--- | :--- |
| `univ-wordpress-father` | Parent: supervisor, manager gateway, child fleet registry |
| `univ-wordpress-child` | Child: WordPress + MariaDB store, supervised by its parent |

Together they are the **fractal pair** the [`README`](../README.md) walks through
in its Quick Start: a parent that repairs a child it does not run inside, which
is the whole architecture in two folders.

They stay here because the documentation points at them. If a demonstration ever
stops being referenced, it stops being a demonstration and leaves.

## Rules that apply to anything placed here

1. **No domain, no credential, no operator identity.** These are published files
   like any other; the domain-agnosticism guard runs over them too.
2. **Reference, never copy.** A universe here references generic bricks through
   its manifest and specialises them by parameter. A `Containerfile` or a package
   copied into a universe folder is a fork (Rules 32, 33).
3. **It must actually be walked through.** A demonstration nobody follows is dead
   configuration, and dead configuration is read by agents as if it were true.

## Where experiments went

Scratch and harness universes are kept outside the repository, in
`Travaux/experimentations/`. They were real work and they are worth keeping —
just not here, where every file is read as a statement about how the system works.
