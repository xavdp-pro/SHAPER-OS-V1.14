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

## `lxd-reap.sh` — terrain-proven, 31 August 2026

An end that is not verified is a promise. This recipe destroys, then looks
again, and only then reports.

| What was tried | What happened |
| :--- | :--- |
| reap a live instance | stopped, deleted, **absence verified**, 1 s observed |
| reap an instance declared `env=prod` | refused, **exit 4** — a robot does not end a production universe |
| the same reap, replayed | *already gone*, **exit 0** — a retry must never fail |
| the matrix, after its instance died | still present: a matrix outlives what it stamps |

## The whole life, driven only by the ledger

Governor, maker and both recipes, with a three-second deadline standing in
for three days. Nothing else shortened, nothing stubbed:

```
[ 0.0s] desired inst-1788190802742-1, deadline in 3s
[ 0.8s] born — the container answers
[ 4.7s] row PURRING
[ 6.5s] row REAPED
[ 6.5s] absence verified from outside

  15:40:02.908Z  STAMPING     15:40:07.752Z  REAPING
  15:40:07.180Z  STAMPED      15:40:09.012Z  REAPED

matrix still referenced by a living row: false
```

The row named the machine `gbs-test`; the maker asked as `vps-053c1354`.
Both names, bound once at enrolment — the defect the first birth found.

Durations are observations of one host on one day, never a promise (Rule 10).
