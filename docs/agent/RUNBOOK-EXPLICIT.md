# Explicit Runbook — Literal Steps, No Derivation Required

> **Audience:** fast and light models, and any agent that must not improvise.
> **Rule of this file:** if a situation is not written here, **stop and ask the
> human**. Do not derive, do not guess, do not "adapt". Deriving from principles
> is a different document ([`PRINCIPLES.md`](./PRINCIPLES.md)) for a different
> class of agent.

Every step has: what to run, what a correct result looks like, and what to do
when it is not correct. When a step says STOP, stop — do not continue to the
next step to "see if it resolves itself".

---

## Step 0 — Confirm you are in the right repository

```bash
ls software/packages
```

- **Correct:** a list of package directories.
- **Not correct:** the path does not exist → **STOP.** Say: "This is not the
  SHAPER OS monorepo — `software/packages` is missing." Do not clone anything,
  do not create the directory.

## Step 1 — Read these four files, in this order

1. [`LAW.md`](../../LAW.md)
2. [`./BOOT-CONTRACT.md`](./BOOT-CONTRACT.md)
3. [`docs/human/START-HERE.md`](../human/START-HERE.md)
4. [`docs/human/KEYS-AND-ACCOUNTS.md`](../human/KEYS-AND-ACCOUNTS.md)

Then `software/RULES.md` in full. Do not summarise it for yourself and do not
skip sections because they look unrelated.

**If the canon does not fit in your context**, do not skim it and do not pretend
you read it. Say this to the human, in these terms: *"I cannot hold
`software/RULES.md` in full. I will work strictly inside this runbook and stop at
anything it does not cover."* Then do exactly that. An agent that declares its
limit is safe; an agent that hides it will break a rule it never read.

## Step 2 — Generate the local secrets

```bash
openssl rand -hex 32   # VAULT_MASTER_KEY
openssl rand -hex 24   # VAULT_TOKEN
```

Write them into `software/.env`. Never write a secret into a chat message, a
commit, a shell script, or a log line.

## Step 3 — Verify every required secret BEFORE building anything

Check `.env` at the repository root, `software/.env`, and the universe folder.
For the target tier, every required key must be present, non-empty, and not a
placeholder such as `changeme`, `xxx`, or `your-key-here`.

- **A key is missing or is a placeholder → STOP.** Name the exact key, give the
  vendor console URL from [`docs/human/KEYS-AND-ACCOUNTS.md`](../human/KEYS-AND-ACCOUNTS.md),
  and wait for the human. Do not build. Do not launch. Do not "start without it
  and add it later".
- **All keys present:** copy the validated values into `software/.env` and into
  every universe `deploy/*.env` so each container boots with valid credentials.

## Step 4 — The DEV pipeline, in this exact order

Do not reorder. Do not skip. Each command must succeed before the next one runs.

**First, get the universe slug from the human.** Do not invent it, and **do not
derive it from something else you were given**: a container name, a host name or
a ticket number is not a slug, and a tester who assumed the two were the same
said afterwards that he should have asked. It is lowercase, letters, digits and
hyphens only (Rule 1).

**Where the universe directory goes.** `<univ_slug>-dev/` beside the repository
root is the default. A universe carrying real work belongs **outside** the
repository — this one is generic and publishes what it contains — and then the
deploy script needs `SHAPER_ROOT` pointing at the `software/` tree, since it can
no longer find it by walking up.

**Write the universe's INTENT before you create anything.** Principle 1 is
*intent precedes form*, and it is broken by habit: a tester created the container
first and used the human's request as an implicit intention. Copy
`software/universes/_template/INTENT.md`, state in it what this universe is for
and its four to six invariants, and only then run the commands below.

```bash
# 4.0 — the intention, first
mkdir -p <univ_slug>-dev/context
cp software/universes/_template/INTENT.md          <univ_slug>-dev/INTENT.md
cp software/universes/_template/context/ctx-universe.md <univ_slug>-dev/context/ctx-universe.md
# then edit both: a template left with its placeholders is an unfinished universe

# 4.1 — from the repository root
cp .env.example software/.env
cp software/resources/vault-resources.dev.example.json \
   software/resources/vault-resources.local.json
# fill the generated vault keys into BOTH files

# 4.2 — build and verify the software
cd software
npm run vault:bootstrap
npm test                              # packages only — MUST be green
bash scripts/build-all-bricks.sh
cd ..

# 4.3 — create the universe from the templates (never by copying packages)
mkdir -p <univ_slug>-dev/deploy <univ_slug>-dev/tasks
cp manifest.tier-a.json          <univ_slug>-dev/manifest.json
cp software/universes/_template/deploy/podman-up.sh  <univ_slug>-dev/deploy/podman-up.sh
cp examples/tasks/task-schedule.json <univ_slug>-dev/tasks/task-schedule.json

# 4.4 — start it, then prove the stack is up
bash <univ_slug>-dev/deploy/podman-up.sh     # health must exit 0

# 4.5 — live tests, only now that the stack is running
cd software && npm run test:live             # tier-a — MUST be green
```

Replace `<univ_slug>` with the slug the human gave you, in every line above. Do
not copy `software/packages/` or any `Containerfile` into the universe
directory — the universe references the bricks, it never contains them.

- **`npm test` is red → STOP.** Show the failing test output unedited. Do not
  modify the test to make it pass. Do not add a stub, a mock, or a fallback.
- **`podman-up.sh` does not exit 0 → STOP.** Show the container logs.
- **`npm run test:live` is red → STOP.** Live tests run *after* the stack is up;
  if you ran them before, that is your error, not a failure of the system.

## Step 4b — Which lifecycle is this? Ask, do not deduce

DEV and TEST look identical while they run and differ completely at the end: a
TEST universe is **destroyed** once it has proved itself (Rule 10), a DEV one is
kept. "A test VPS" describes a machine, not a lifecycle, and a tester read it as
DEV while the operator may have meant TEST — which is why two universes were
still running days later.

If the human has not said which, **ask in one sentence**: *"Is this DEV, which I
keep, or TEST, which I destroy after the proof?"* Then write the answer into the
universe's `INTENT.md` and its manifest `environment`, so that the next agent
does not have to guess what you guessed.

## Step 5 — Public tier (tier-b), only if the human asks for voice or a public URL

1. Confirm tier-a is green first (`npm run test:live`).
2. Open **one vendor site at a time** in the IDE browser:
   - Deepgram → https://console.deepgram.com/ → API Keys
   - Groq → https://console.groq.com/keys
   - Cloudflare tunnel → https://one.dash.cloudflare.com/ → Networks → Tunnels
3. The human pastes the value into `.env`, `software/.env`, or
   `sav/tunnel/token`. Never into the chat, never into Git.
4. Deploy tier-b (`manifest.tier-b.json`, `WITH_HELM=1`), then:

```bash
npm run test:live:helm
# The closed-loop tests of whatever bricks this universe assembles.
# For catalogue bricks they live in the catalogue, beside the brick.
```

- **Any key empty or invalid → STOP and ask.** Never launch tier-b with empty
  keys.

## Step 6 — Prove the work, not the uptime

A green `/api/health` proves the stack is up. It does **not** prove a job ran.

**Submitting the job.** The queue accepts one job type for agent work, and its
shape is declared in [`../../software/packages/pkg-queue/INTENT.md`](../../software/packages/pkg-queue/INTENT.md).
It is written here too, because a tester looked for it in the live tests, did not
find it, and had to read `worker.js` to work it out:

```bash
curl -s -X POST "http://127.0.0.1:8640/api/jobs" \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "agent.inject",
    "totalSteps": 2,
    "payload": {
      "message": "Reply with the exact text: <a marker you choose>",
      "conversation": "<a session name>",
      "model": "<the engine you measured at deployment>"
    }
  }'
```

Then poll the job until it reaches a terminal state, and read `job.result.answer`
— the persisted answer, not the streamed one.

For functional proof you need all four:

1. the queue job reached a terminal state and its answer is **persisted**
   (not only streamed over a connection that has since closed);
2. the artefact exists and its bytes are exactly what was asked;
3. the byte comparison used `cmp`, **not** `test "$(cat file)" = value` —
   command substitution removes trailing newlines and will report success on a
   file that is wrong;
4. an audit event in the log correlates with the same queue job id.

Missing any of the four → the work is **not** proven. Say so plainly.

## Step 7 — Report every correction into the repository

For each problem you hit and fixed, in the same commit:

- the fix;
- a non-regression test that **fails on the unpatched code** (if it would pass
  without your fix, it proves nothing — rewrite it);
- if the documented intention was wrong, the corrected `INTENT.md`;
- if it was an operational trap, a line in the deployment steps.

Never close a problem with "it works now".

## Step 8 — Report state honestly

Tell the human, without being asked:

- which files changed;
- whether they are committed, and on which branch;
- whether anything is pushed;
- which changes came from your test runs versus the human's own work.

---

## Absolute stops

Stop immediately and hand back to the human if any of these is true:

| Condition | Why |
| :--- | :--- |
| A required secret is missing or a placeholder | Building on a missing key wastes an hour to save a question |
| Any test is red | Green-by-stub is worse than red |
| The action would touch a production universe | Not your perimeter |
| The action would delete data or a volume you did not create | Irreversible |
| A rule blocks you | Report the blockage; never edit the law to unblock yourself |
| You have retried the same repair 5 times | Mark `DEGRADED`, escalate (Rule 27) |
| The situation is not described in this file | Ask. That is what this line is for. |

---

## Never do these

- Skip `npm test`, `npm run test:live`, or the closed-loop scripts
- Commit `.env`, vault files, tunnel tokens, or `*.enc`
- Put a default API key in a shell script
- Copy `packages/` or a brick `Containerfile` into a universe folder
- Use a production mailbox in DEV or TEST
- Keep a TEST universe alive after it passed
- Summarise or replace `software/RULES.md` with a pointer
