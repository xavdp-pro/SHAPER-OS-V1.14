# AGENT-DEPLOY — univ-base

> **Intent Classification**: SPECIFIC INTENT (Universe: `univ-base`)

## What you are deploying

The earlier base cell: five bricks with file stores, no catalogue brick, no
domain, no account. It runs only from the earlier images pinned where they were
published, and it is not the shape a new universe starts from — read
[`INTENT.md#earlier-shape`](./INTENT.md#earlier-shape) first. A new universe is
derived from [`../_template/`](../_template/AGENT-DEPLOY.md).

## Before you start

Read, in this order, and stop if any answer is missing rather than inventing one:

1. [`../../../AGENTS.md`](../../../AGENTS.md) — how you are expected to work here
2. [`../../../docs/agent/UNIVERSE-DESIGN-QUESTIONS.md`](../../../docs/agent/UNIVERSE-DESIGN-QUESTIONS.md)
3. [`../../../docs/architecture/NAMING.md`](../../../docs/architecture/NAMING.md)
4. [`../../../docs/architecture/ARTIFACT-BOUNDARY.md`](../../../docs/architecture/ARTIFACT-BOUNDARY.md)
5. This universe's own [`INTENT.md`](./INTENT.md) and [`manifest.json`](./manifest.json)

## Steps

### 1. Configure

The copy carries EMPTY keys. Fill them with these exact commands — "write a
master key into that file" left every literal tester stalled on an empty key
and deriving the `sed` alone (sealing run v1.13.9, incident 1):

```bash
cp cfg-univ-base.env.example cfg-univ-base.env
chmod 600 cfg-univ-base.env
sed -i "s|^VAULT_MASTER_KEY=.*|VAULT_MASTER_KEY=$(openssl rand -hex 32)|" cfg-univ-base.env
sed -i "s|^VAULT_TOKEN=.*|VAULT_TOKEN=$(openssl rand -hex 24)|" cfg-univ-base.env
```

`OPENCODE_MODEL` stays empty until step 2b measures it. **Ask the human** for
anything else the file leaves blank. Do not reuse a value found elsewhere in the
repository — there are none to find, and a guard test fails the build if one
ever appears. Never print a value you generated.

**The file holds only variables.** `podman-up.sh` reads it before sourcing it
and admits three kinds of line: blank, `# comment`, and `KEY=value` (the key
`[A-Z][A-Z0-9_]*`; the value `"double-quoted"` with no `$(…)` and no backtick,
`'single-quoted'`, or a bare word with no whitespace and no shell operator).
Any other line — a note for a human, a value with a trailing `; command` —
stops the deployment before anything starts, and the halt quotes the line
with its number. Put a note behind `#`. The grammar and its reason are in
[`INTENT.md`](./INTENT.md#variables-file).

### 2. Build and pin the images

Only from a checkout at or before `958e0b7` (V1.14 main), whose bricks are the
earlier file-store images, and never under a tag the registry already serves.
Run this tree's scripts over that checkout — `SHAPER_CHECKOUT=<checkout>` for
`deploy/gbs-test-bootstrap-v114.sh`, `SHAPER_UNIVERSE_DIR=<checkout>/software/universes/univ-base`
for `podman-up.sh` and `proof.sh` — never the copies inside it, which replace
the registry and push over a published tag. From `96a1319` on, the bricks are
MariaDB-store images and then one-container units, and `podman-up.sh` refuses
them before it stops anything.

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

### 2b. Measure the engine (Rule 7)

Only possible now: the opencode CLI ships inside the bridge image just built.
`deploy/gbs-test-measure-opencode.sh` scripts this step on `gbs-test`; by hand:

```bash
# 2b — the candidates, then the probe, from the image the build published
podman run --rm --entrypoint opencode \
  "$SHAPER_REGISTRY/shaper/brick-bridge-opencode:$SHAPER_IMAGE_TAG" models
# THE PROBE IS THE CONTRACT (added after the v1.13.17 sealing run: an engine
# passed the echo ping, then hung on the real write-then-reply job and
# answered generic text once stopped). Probe each candidate on the SHAPE OF
# THE WORK this universe will ask, not on an echo: write-a-file-then-reply.
# The path is RELATIVE and the workdir is the mount: the CLI's sandbox
# auto-rejects any absolute path outside its working directory
# (external_directory) — with an absolute /probe/... EVERY engine fails the
# probe and none can be selected (v1.13.18 sealing run, incident 1).
PROBE_DIR=$(mktemp -d)
timeout 90 podman run --rm -v "$PROBE_DIR:/probe" -w /probe --entrypoint opencode \
  "$SHAPER_REGISTRY/shaper/brick-bridge-opencode:$SHAPER_IMAGE_TAG" \
  run --pure --model <candidate> \
  "Write the exact text PROBE-OK, with no trailing newline, into marker.txt. Then reply with exactly PROBE-OK and nothing else."
printf '%s' PROBE-OK | cmp -s - "$PROBE_DIR/marker.txt" && echo "<candidate>: contract OK" || echo "<candidate>: FAILED the contract — out at any price"
# Record each candidate's verdict and its wall time; they are your measurement.
# Rule 7, two cursors: engines failing the probe are OUT at any price;
# dominated engines (more expensive AND slower) are OUT by measurement; the
# manifest's enginePolicy declares the cursor among what remains —
# frugal (default: cheapest, ties resolve to measured speed), swift (most
# performant — voice/real-time), or {budgetPerTask: N} (best under a ceiling
# the operator declares).
# Then write the selected engine into cfg-univ-base.env:
#   OPENCODE_MODEL=<the engine your measurements and the declared enginePolicy select — Rule 7>
# The same measurement, the same shape, for every other bridge a deployment
# enables: CURSOR_MODEL (bridge-cursor), AGY_MODEL or ANTIGRAVITY_MODEL
# (bridge-agy), OLLAMA_MODEL or DEEPSEEK_MODEL (bridge-deepseek) — each
# measured at deploy, never written here. No bridge names a default: each
# halts without its variable.
```

### 3. Materialise

```bash
bash deploy/podman-up.sh
```

It starts the bricks in the order `bootOrder` declares, gating each layer on the
health of the one below. It refuses to run against unpinned images unless you
say `SHAPER_ALLOW_UNPINNED=1`, which is for a laptop and never for TEST or PROD.

### 4. Prove the work, not the uptime

A green `/api/health` proves the stack is up. It does **not** prove a job ran.
For functional proof you need all four:

1. the queue job reached a terminal state and its answer is **persisted**
   (not only streamed over a connection that has since closed);
2. the artefact exists and its bytes are exactly what was asked;
3. the byte comparison used `cmp`, **not** `test "$(cat file)" = value` —
   command substitution removes trailing newlines and will report success on a
   file that is wrong;
4. an audit event in the log correlates with the same queue job id.

**Submitting the job.** The job asks for **both** halves of the proof — a
persisted answer and a file on disk — because proof 2 compares an artefact, and
a job that was never asked for one leaves nothing to compare. Its shape is
declared in [`pkg-queue/INTENT.md`](../../packages/pkg-queue/INTENT.md):

```bash
curl -s -X POST "http://127.0.0.1:8640/api/jobs" \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "agent.inject",
    "totalSteps": 2,
    "payload": {
      "message": "Write the exact text <a marker you choose>, with no trailing newline, into /data/opencode-ws/<the conversation>/marker.txt. Then reply with that same exact text.",
      "conversation": "<a session name>",
      "model": "<the engine you measured at step 2b>"
    }
  }'
# the reply carries {"job":{"id":"job-..."}} — poll that id until COMPLETED or FAILED:
curl -s "http://127.0.0.1:8640/api/jobs/<the id>"
```

The artefact path is **the bridge's view, never the host's**: the agent works
inside the bridge container, where the universe's
`.state/vol-univ-base-opencode-ws/` is mounted at `/data/opencode-ws/`. A
host-side path in the message gets created NESTED inside the workspace and
`proof.sh` fails on it (v1.13.18 sealing run, incident 2). Host equivalence for
the `cmp`: `<univ-base directory>/.state/vol-univ-base-opencode-ws/<the conversation>/marker.txt`.

All four are scripted — run them instead of improvising them. What the job was
asked to produce is the one thing the script cannot guess, so you declare it and
the script decides (`deploy/gbs-test-run-full-proof.sh` does all of this on
`gbs-test`):

```bash
PROOF_JOB_ID='<the id>' \
PROOF_ARTIFACT='<the host path above>' \
PROOF_EXPECTED='<the marker you chose>' \
PROOF_ANSWER='<the same marker>' \
bash deploy/proof.sh    # exit 0 = proven, and it says why not when not
```

- `PROOF_EXPECTED` is written out with `printf '%s'` and compared with `cmp`, so
  it is byte-exact: a trailing newline is declared as `PROOF_EXPECTED=$'…\n'`.
  For anything longer than a line, put the exact bytes in a file and declare
  `PROOF_EXPECTED_FILE` instead.
- Without `PROOF_JOB_ID` the script reads the most recent job.
- Declaring no artefact is allowed and stays visible: the script prints
  `SKIP artefact` and its closing verdict repeats that proofs 2 and 3 were not
  performed. That run is not a full functional proof.

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
