# AGENT-DEPLOY — univ-base

> **Intent Classification**: SPECIFIC INTENT (Universe: `univ-base`)

## What you are deploying

The canonical base cell: five bricks, no catalogue brick, no domain, no account.
If this universe does not come up, nothing built on top of it will either — which
is the only reason it exists.

## Before you start

Read, in this order, and stop if any answer is missing rather than inventing one:

1. [`../../../AGENTS.md`](../../../AGENTS.md) — how you are expected to work here
2. [`../../../docs/agent/UNIVERSE-DESIGN-QUESTIONS.md`](../../../docs/agent/UNIVERSE-DESIGN-QUESTIONS.md)
3. [`../../../docs/architecture/NAMING.md`](../../../docs/architecture/NAMING.md)
4. [`../../../docs/architecture/ARTIFACT-BOUNDARY.md`](../../../docs/architecture/ARTIFACT-BOUNDARY.md)
5. This universe's own [`INTENT.md`](./INTENT.md) and [`manifest.json`](./manifest.json)

## Steps

### 1. Configure

```bash
cp cfg-univ-base.env.example cfg-univ-base.env
```

Generate a master key and write it into that file. **Ask the human** for anything
the file leaves blank. Do not reuse a value found elsewhere in the repository —
there are none to find, and a guard test fails the build if one ever appears.

**The file holds only variables.** `podman-up.sh` reads it before sourcing it
and admits three kinds of line: blank, `# comment`, and `KEY=value` (the key
`[A-Z][A-Z0-9_]*`; the value `"double-quoted"` with no `$(…)` and no backtick,
`'single-quoted'`, or a bare word with no whitespace and no shell operator).
Any other line — a note for a human, a value with a trailing `; command` —
stops the deployment before anything starts, and the halt quotes the line
with its number. Put a note behind `#`. The grammar and its reason are in
[`INTENT.md`](./INTENT.md#variables-file).

### 2. Build and pin the images

```bash
cd ../../                       # software/
export SHAPER_REGISTRY=<your registry>
export SHAPER_IMAGE_TAG=v1.11.0 # never latest
bash scripts/build-all-bricks.sh
```

Then lock them:

```bash
python3 scripts/record-image-lock.py universes/univ-base --insecure
```

It reads what each `podman push` recorded and writes an entry only once the
registry has served that digest back. Do not fill this file by hand — that step
was a sentence in this document with no tool behind it until V1.12, and the one
time it was performed manually it produced a lock in which every digest returned
`manifest unknown`. A tag can be moved; a digest cannot; a digest the registry
never stored cannot be pulled at all.

### 3. Materialise

```bash
bash deploy/podman-up.sh
```

It starts the bricks in the order `bootOrder` declares, gating each layer on the
health of the one below. It refuses to run against unpinned images unless you
say `SHAPER_ALLOW_UNPINNED=1`, which is for a laptop and never for TEST or PROD.

### 4. Prove

```bash
bash deploy/proof.sh
```

This is the deliverable. A deployment nobody proved is a claim, and Rule 33 does
not accept claims. Paste that output into your report, with the commit you
deployed from.

## What you must not do

- **Do not add a brick.** If this universe needs one, it is no longer `univ-base`;
  copy it to a new universe and add it there.
- **Do not edit a tracked file to make it work.** A value that only works on your
  machine is a defect. Put it in `cfg-univ-base.env`, which is untracked.
- **Do not repair yourself.** A child does not fix itself (Rule 33): report the
  defect with its evidence and let the parent decide.
- **Do not report success you did not observe.** If `proof.sh` fails, the answer
  is the failure.
