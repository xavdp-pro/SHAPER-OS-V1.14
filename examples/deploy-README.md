# There is one deploy script, and it lives in the template

`examples/deploy/podman-up.sh` used to exist. It was a copy of
[`../software/universes/_template/deploy/podman-up.sh`](../software/universes/_template/deploy/podman-up.sh)
that had drifted 142 lines away from it — two bodies of code that a reader could
only tell apart by diffing them, and a fix applied to one silently missed the
other.

Copy the template's script:

```bash
cp software/universes/_template/deploy/podman-up.sh  <univ_slug>-dev/deploy/podman-up.sh
```

Then specialise **by environment values only**. If you find yourself editing the
script itself, the thing you are trying to express belongs in your universe's
manifest or its `cfg-*` file — see
[`../software/universes/README.md`](../software/universes/README.md).

For a deployment you can read end to end before copying anything, read
[`../software/universes/univ-base/deploy/podman-up.sh`](../software/universes/univ-base/deploy/podman-up.sh):
it starts the five-brick base cell from pinned images, in `bootOrder`, and
refuses to run against images that are not pinned.
