# Recipes — frozen, typed, field-proven or absent

A recipe is `<hostKind>-<workKind>.sh` (`lxd-stamp.sh`, `proxmox-reap.sh`…).
It receives typed positional arguments — rowId, class, matrix, digest,
account, env — and never interpolates any of them into a composed command.

**No recipe ships before it has run on real terrain.** A snippet published
untested has already cost a sealing run (F25).

## `lxd-stamp.sh` — terrain-proven, 31 August 2026

Proven on gbs-test before shipping, in this order:

| What was tried | What happened |
| :--- | :--- |
| stamp from a 134 MB matrix | instance RUNNING, **observed in 5 s** |
| an account string carrying shell metacharacters | arrived byte-identical (same sha256 inside the instance) |
| the same stamp, replayed | *already exists — nothing to stamp*, one container still |
| bytes that do not hash to their name | refused, **exit 3** |
| a matrix absent from this host | refused, **exit 2** |

Then the full loop — a governor writing desired state, a maker asking, this
recipe stamping — reached PURRING **4.3 s** after the row was desired, with
STAMPING and STAMPED recorded in the ledger.

Durations are observations of one host on one day, never a promise (Rule 10).
