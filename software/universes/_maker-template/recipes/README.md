# Recipes — frozen, typed, field-proven or absent

A recipe is `<hostKind>-<workKind>.sh` (`lxd-stamp.sh`, shipped;
`proxmox-reap.sh`, not yet written…). It receives typed positional arguments
— rowId, class, matrix, digest, account, env — and never interpolates any of
them into a composed command. The row's `params`, when its class declares
any, reach it as `SHAPER_PARAM_<KEY>` variables on an environment the maker
builds for the run — PATH, HOME, locale, the operator's own `SHAPER_*`
configuration, the allow-listed keys, and nothing inherited from the maker's
process. The shipped `lxd-*` recipes read no param. The built environment
is proven here with stub recipes (`params-slot.test.js`), not with `lxc`,
`podman` or `curl`; the first stamp on terrain after this change is its
proof, and it comes before any prod row.

**No recipe ships before it has run on real terrain.** A snippet published
untested has already cost a sealing run (F25).

A `<hostKind>-adopt.sh` — none ships here; it belongs to the class that
needs it, proven on terrain first — binds a row to a container that already
exists. The row is written with `matrix: "none"` and `digest: "none"` (two
words, never absences) and names the container in its `instance` param. The
recipe reads the name from `SHAPER_PARAM_INSTANCE`, looks (the container is
there, its state), binds what the class needs bound, and ends with one line
of facts carrying `state` and `legacy: true`. It creates nothing, launches
nothing, and never `exec`s inside the container it adopts. Where adopted
rows exist, that host kind's `-reap.sh` AND `-validate.sh` must take the
instance name from `SHAPER_PARAM_INSTANCE` when present — the row's params
ride every kind of work derived for it, the validation included. The shipped
`lxd-reap.sh` and `lxd-validate.sh` derive the name from the row id: the
reap would prove the absence of a container it never looked for, and the
validation — which an ADOPTED reporting `checks: true` derives exactly as a
STAMPED does — would find no `inst-<rowId>` on the host (exit 2) and degrade
a healthy tenant. Until both recipes of a host kind read the variable, an
adopt recipe must not report `checks: true`, and no adopted row may name a
machine of that kind.

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

## `lxd-validate.sh` — terrain-proven, 31 August 2026

The governor looks at its child through the maker's hands. The recipe pulls
the child's own acceptance spec (`/etc/shaper/checks.json`, baked by its
class) out of the instance and hands it to the verifier — a headless browser
in a podman container whose whole input is that declarative spec, and which
refuses anything outside its vocabulary. Proven on gbs-test, in this order:

| What was tried | What happened |
| :--- | :--- |
| the verifier by hand, before the recipe, against a living instance | step 2 failed on a real defect of the old matrix (a build flag never set): the harness bit at its first look |
| the first autonomous validation, right after STAMPED | VALIDATION_FAILED, the row DEGRADED, on a healthy child — judged before the application inside had booted, a connection never offered. The recipe now waits, bounded, for the child's first HTTP answer before judging (`validate-recipe-waits.test.js`) |
| the second, after the wait | VALIDATION_FAILED again, and it was a real defect: the login answered 500, no session secret in the instance. Fixed in the class, not in the recipe |
| the corrected child | **exit 0**, every step of its spec passed — page, title, card, click, login, sidebar — verdict on the last line, screenshot kept as evidence on the host |

The field note of that day records the two DEGRADED rows, not the exit
codes behind them; the maker reports VALIDATION_FAILED for any non-zero
exit, so the code itself is not claimed here. By contract: exit 0 is
VALIDATED; exit 1 is VALIDATION_FAILED, and the
verdict rides the event naming the failing step; exit 2 is the facts having
changed since the stamp (instance absent, no address, no spec); any other
code is the harness itself breaking. A child silent past its boot budget is
exit 1 with `the child never answered HTTP` — no verdict is pronounced on a
silent child. Nothing about how long any of this took is written here, on
purpose (Rule 10).

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
