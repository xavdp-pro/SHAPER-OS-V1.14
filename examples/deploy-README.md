# A universe's deploy scripts are the template's, and its base is installed, never copied

`examples/deploy/podman-up.sh` used to exist. It was a copy of the template's
deploy script that had drifted 142 lines away from it — two bodies of code that
a reader could only tell apart by diffing them, and a fix applied to one
silently missed the other. Until the base release (11 October 2026) every
universe still copied that one script, and carried its own drift with it.

A universe now takes the whole template, and the base units from one revision:

```bash
cp -r software/universes/_template /apps/<univ_slug>          # outside the repository
bash /apps/<univ_slug>/deploy/install-base.sh \
  --shaper-repo <SHAPER-OS-V1.14 checkout> --shaper-commit <revision>
```

- [`../software/universes/_template/deploy/`](../software/universes/_template/deploy/)
  holds the universe's four scripts — `install-base.sh`, `podman-up.sh`,
  `proof.sh`, `base.sh` — and `lib.sh` they share. They check what only the
  universe knows (its settings file, its manifest, its `base/`), then run the
  base's own scripts with the same arguments.
- `base/` is [`univ-minimal`](../software/universes/univ-minimal/INTENT.md) as
  that revision holds it: the birth of Vault, Logger, Queue and Maestro — each
  one functional Podman holding its application and its own MariaDB server
  (Rules 4 and 26) — with their identities, the proof, the drills and the
  bootstrap renewal. It is recorded in `base/.shaper-revision` and never
  edited: a correction goes into univ-minimal, here, and reaches a universe by
  installing a newer revision.

Then specialise **by values only**: the manifest's `universe`, `environment`
and roles, `cfg-universe.env`, the image lock, the schedule. If you find
yourself editing a deploy script, the thing you are trying to express belongs
in your universe's manifest or its `cfg-*` file — see
[`../software/universes/README.md`](../software/universes/README.md). A unit the
universe adds is the one exception: its start goes into the universe's
`deploy/podman-up.sh` after the base layers and its proof into
`deploy/proof.sh`, before the manifest declares it
([why](../software/universes/_template/INTENT.md#materialise)).

To read a deployment end to end before copying anything, read
[`univ-minimal/deploy/podman-up.sh`](../software/universes/univ-minimal/deploy/podman-up.sh):
the birth order, the identities, the kept-or-recreated decision unit by unit.
[`univ-base/deploy/podman-up.sh`](../software/universes/univ-base/deploy/podman-up.sh)
is the earlier shape — five bricks with file stores — kept on its older images;
it is not a model for a new universe
([why](../software/universes/univ-base/INTENT.md#earlier-shape)).
