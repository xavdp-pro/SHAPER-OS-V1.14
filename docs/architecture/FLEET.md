# FLEET — the map of everything, in one file

> **Status**: doctrine (Rule 37). The `fleet.yml` schema is engraved HERE and
> nowhere else — three archetype designs each grew it a different way, which
> is exactly how a PRA anchor dies. The registration guard is a **TARGET**
> check for `shaper verify`; everything else is binding now.

## What it is

One tiny repository, `<scope>-fleet` (the operator's is `shaper-fleet`),
holding one file. It answers a single question completely: **what exists, and
at which pinned version** — so that disaster recovery starts from one clone
and needs nothing else that is not derivable.

```yaml
# fleet.yml — the complete schema. Nothing else is legal at the top level.
base:
  repo: https://github.com/<org>/SHAPER-OS-V1.13
  tag: v1.13.0
catalogue:
  repo: https://github.com/<org>/SHAPER-OS-BRICKS-V1.13
  tag: v1.13.0
classes:
  - name: univ-<projet>-<classe>
    repo: https://github.com/<org>/univ-<projet>-<classe>
    tag: v1.0.0            # immutable, Rule 0E — never a branch
    governedBy: <slug>     # which universe's ledger holds this class's instance rows;
                           # "self" for a standalone that governs itself
machines:
  - name: <machine-name>   # the host inventory — a handful of rows that change yearly
    kind: proxmox | lxd
    reach: <how the operator reaches it — never a credential>
```

## The laws of the map

1. **Repos and tags only, never instances.** An instance is a ledger row
   (Rule 37); its R2 bucket is derivable (`r2://<instance-id>`), never
   enumerated here. A map that lists instances has become a second ledger,
   and two ledgers are one too many.
2. **`-dev` bypasses the map.** Daily vibe-coding must never wait on a
   registration; the map guards what is promised, not what is being tried.
   `-test` and `-prod` are guarded: **a class repo not registered in its
   fleet map is refused promotion** (TARGET: the `fleet-registration` check).
3. **Tag precedence** (Rule 37): the map's tag is the default for new
   instances and the PRA floor; the ledger row's tag is the truth and may lag
   during a canary (Rule 25); an audit task reconciles them.
4. **A sovereign fork mirrors the map.** A Rule 33 client whose PRA cannot
   hinge on the vendor's repo keeps its own `<projet>-fleet`, shaped by the
   mirror rule. Federation contract: a repo is validly registered when it
   appears in *its own scope's* map — the vendor's map never lists a
   sovereign fork's classes, and neither map defers to the other at restore
   time.
5. **PRA reads the map top-down**: clone the fleet repo → deploy base and
   catalogue images at their tags → for each class, deploy per its
   `governedBy` order (a governor restores before the classes it governs,
   from its own bucket — that is what breaks the restore-the-registry
   circularity) → each instance's volumes return from its derivable bucket
   (Rule 16 levels 2-3-5). The map does the git level; it never carries data.

## What this file is not

Not a deploy tool (that is the forge), not a status surface (that is the
board rendering status.json), not a place for secrets, buckets, ports or
credentials. One question, one file.
