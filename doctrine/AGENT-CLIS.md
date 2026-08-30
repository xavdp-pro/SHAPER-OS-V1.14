# Agent CLIs in SHAPER OS

> **Status**: dated snapshot — descriptive, not canon. It records what these CLIs
> were on the day they were measured, so it names versions on purpose. Nothing
> here binds a future deployment: engine selection is governed by
> [`../docs/architecture/COGNITION.md`](../docs/architecture/COGNITION.md) and Rule 7,
> which measure rather than declare.
>
> How each command-line agent behaves, what its bridge must send it, and what
> the queue and the maestro can believe about it.
> Every fact below was verified on this host on 23 August 2026, not read from a
> vendor page. Where a page and the binary disagreed, the binary won.

---

## 1. Why this document exists

Three CLIs, three vocabularies, three ideas of what "finished" means, and three
different answers to the question *can I trust the exit code*. A bridge written
against an assumed contract answers healthy and does nothing — that is not
hypothetical, it happened to `bridge-cursor`, whose every flag was invented.

**Rule that follows: no bridge is considered working until its CLI has been run
once, by hand, and its terminal output read.**

---

## 2. The three agent CLIs at a glance

| | **agy** (Gemini/Antigravity) | **opencode** | **cursor-agent** |
| :--- | :--- | :--- | :--- |
| Binary | `~/.local/bin/agy` | `~/.opencode/bin/opencode` | `~/.local/bin/cursor-agent` |
| Version seen | — | 1.18.18 | 2026.08.11-e8db854 |
| Auth | OAuth session in `~/.gemini` | account session | `--api-key` / `CURSOR_API_KEY` |
| Cost | subscription, **weekly** quota | free models available | subscription |
| Headless flag | `--print <prompt>` | `run <prompt>` | `-p <prompt>` + **`--force`** |
| Output | `--output-format json\|stream-json` | `--format json` | `--output-format text\|json\|stream-json` |
| Terminal event | `done { exit_code }` | `response_complete { exit }` | `result { is_error }` |
| Exit code trustworthy | **no** | partially | **no** — exits 0 while refusing on a trust prompt |
| Vision | yes (quota) | yes, with an image-capable model | not used for that here |

<a id="full-auto"></a>
### 2b. Running unattended: the full-auto flag, per CLI

An agent driving a deployment cannot answer a prompt — and each CLI misbehaves
in its own way when it wants one: **agy and muse block silently**,
cursor-agent **exits 0 while refusing**, opencode **ends its session** without
saying why. None fails loudly. Each has
its own formula, and none resembles the others:

| CLI | Everything allowed, nothing asked |
| :--- | :--- |
| `agy` | `--dangerously-skip-permissions` |
| `cursor-agent` | `--force` |
| `codex` | `--dangerously-bypass-approvals-and-sandbox` *(documented; not yet exercised in a campaign here)* |
| `opencode` | `--auto` |
| `muse` (Meta) | `--yolo` *(implies approval and sandbox off; the extra `--approval-mode`/`--disable-sandbox`/`--sandbox-network` flags used in the first successful run were belt-and-braces — one is reported ignored by muse itself)* |

**The sandbox is the part that surprises.** `muse` defaults to a bwrap sandbox
whose network is `proxy-only` — an HTTP proxy, which cannot carry SSH. A run
driving a remote host therefore fails every `ssh` while looking healthy: in one
measured session, 16 tool calls were rejected in silence while the agent kept
working, and it eventually spent its turns diagnosing its own cage (`ip addr`,
`wg show`, `nc -zv`) instead of deploying. `opencode` confines file tools to
its working directory, so a repository cloned to `/tmp` becomes unreadable —
clone inside the workspace, or pass `--dir` (present in 1.18.25; absent from the 1.18.18 help captured above).

**The rule this yields**: before trusting an unattended run, prove the agent
can reach its terrain — not that its process is alive. Watch for the artefact
it must create (a container, a file), never for the process. A live process
that asks and is auto-denied looks exactly like a working one.

---

## 3. agy — Gemini through Antigravity

### Invocation

```bash
agy --print "<prompt>" \
    --model gemini-3.7-flash-<effort> --effort <effort> \
    --output-format json --mode accept-edits \
    --add-dir <perimeter> --print-timeout 90m \
    --dangerously-skip-permissions
```

### Four traps, each of which cost a session

**The prompt must follow `--print` immediately.** Otherwise the CLI takes the
next flag as the prompt and drops the real one — it says so itself:
`--print took "--output-format" as its prompt`. An agent then runs with no
instruction and reports plausible-looking nonsense.

**The model name encodes the effort.** `gemini-3.7-flash-high` with
`--effort low` is refused outright. The suffix is the authority; derive the
effort from it rather than passing both from separate sources.

**The exit code lies.** The process exits 0 while the JSON says
`"status": "ERROR"`. Read the JSON `status`, never `$?`.

**Print mode has a hard 60-second authentication timeout**
(`Print mode: auth timed out` in `~/.gemini/antigravity-cli/cli.log`). Never log
in through `--print`; run bare `agy` in a real terminal.

### Quota

Weekly, not hourly. Observed on 23 August: `Individual quota reached. Resets in
149h58m` after roughly 2.6 M tokens spent in one day. Plan delegation around a
week, not an afternoon.

### Writing files

`write_to_file` is confined to the CLI's own brain directory
(`~/.gemini/antigravity-cli/brain/<uuid>/`) **even with `--add-dir`**. Agents
work around it by writing through the terminal, which succeeds — but the run
then finishes with `status: ERROR` despite having done the work. Judge the
result, not only the status.

---

## 4. opencode

### Invocation

```bash
opencode run --model <id> --format json --pure "<prompt>"
opencode run --model <id> --file <image.png> --format json --pure "<prompt>"
```

`--file` attaches an image, which is how the document-vision witness is
implemented. Proven on a corpus page: **99.80 %** against ground truth, same
metric as the corpus bench.

### Models

Free ids exist on this host. Most are **text-only** and are the right tool for a
control-chain heartbeat. Only some advertise image input — check before
declaring one as a vision witness; a text model given an image fails silently in
the least useful way, by describing nothing and claiming success.

### Terminal behaviour

The bridge emits `response_complete { exit }`, then `run_complete`, then
possibly `run_aborted { reason }`. **`run_complete` carries no outcome** and is
deliberately not treated as terminal: concluding from it would invent a success
for a run that reported none.

---

## 5. cursor-agent

### Invocation

```bash
cursor-agent -p "<prompt>" --output-format stream-json --model <id>
```

### What it does not have

There is no `--composer`, no `--prompt`, no `--format`, and no `--mode`. The
bridge sent all four for months. **Speed is a model choice, not a switch**:
`composer-2.5` and `composer-2.5-fast` are two model ids, and there is nothing
else to set.

Standing arrangement: **`composer-2.5` is the default; `composer-2.5-fast` is
used only when a human asks for it.** Fast is not forbidden, it is not
automatic — so it is a parameter (`CURSOR_MODEL`) rather than a rule buried in
code, and choosing it stays a visible decision.

### The multi-level response

In `stream-json` it emits one typed line per event:

```
system     subtype: init          the model actually used
assistant                         text, as it comes
tool_call  subtype: started
tool_call  subtype: completed
result     subtype: success       is_error, duration_ms, session_id
```

This granularity is what doctrine §10 of the document pipeline asks for: a
caller can show a job advancing step by step instead of a progress bar that
lies. `tool_call` pairs give the steps; `assistant` gives the text.

### Workspace trust, and why the exit code cannot be believed

Headless runs stop on **"Workspace Trust Required"** unless `--force`,
`--trust` or `--yolo` is passed — and, verified on this host, the CLI then
**exits 0 while having refused to do anything**. Treating that as success would
report a completed job that never ran.

So no CLI here has a trustworthy exit code. The witness is `is_error` inside the
`result` event; **the absence of any JSON is itself the failure signal**. A
bridge keeps announcing its own `done { exit_code }` on process close so the
queue always has something to conclude from, but the queue must prefer the
`result` event when one arrives.

Verified invocation, end to end:

```bash
cursor-agent -p "Reply with the single word BRIDGE." \
  --output-format json --model composer-2.5 --force
→ {"type":"result","subtype":"success","is_error":false,"result":"BRIDGE", ...}
```

### Permissions

`-f` / `--force` allows commands unless explicitly denied (`--yolo` is an
alias). Required for headless work that edits files, and a deliberate decision
rather than a default — grant it per universe, not globally.

---

## 6. Using a CLI in **queue mode**

The queue never learns a CLI. It talks to a bridge, and carries an address.

```json
POST /api/jobs
{
  "type": "agent.inject",
  "totalSteps": 2,
  "payload": {
    "message": "what to do",
    "conversation": "pod-slug",
    "bridgeUrl": "http://127.0.0.1:4630",
    "model": "optional model id",
    "priority": 5
  }
}
```

What the queue guarantees, and what it refuses:

* it **subscribes to the bridge's event stream before injecting**, because a
  short run would otherwise finish before anyone listens;
* it concludes only on a terminal event, read from the `TERMINAL_EVENTS` table —
  the one place any CLI dialect is known;
* a run whose end **cannot be observed stays `RUNNING`**, with the reason
  recorded. A pending job beats an invented success;
* at most **one running job per `conversation`**, so no pod occupies two lanes;
* selection is by **effective priority** = declared priority + ⌊waited ÷ aging⌋,
  which makes starvation impossible rather than unlikely.

Adding a fourth CLI means one line in `TERMINAL_EVENTS` and a bridge. It means
no change to the queue's logic, and that is the point.

---

## 7. Using a CLI in **maestro mode**

The maestro decides **when**, never **how**, and never whether it worked.

A pod declares its own bridge:

```json
{
  "slug": "mail-contact",
  "bridgeType": "agy",
  "bridgeUrl": "http://127.0.0.1:4630",
  "cadenceSeconds": 300,
  "beatMessage": "read the mailbox and act"
}
```

With `MAESTRO_QUEUE_URL` set, a beat **enqueues** rather than dispatching. The
consequences are worth stating plainly:

* a beat claims only that *the job is queued* — an outcome it cannot observe;
* a beat that finds its pod **still busy is skipped and recorded as skipped**
  (`BEAT_SKIPPED reason: previous_run_still_open`). Twelve stacked mailbox reads
  are not twelve times the freshness; they are one useful read and eleven wasted
  agent calls. Lateness becomes a visible counter instead of a silent backlog;
* if the queue is unreachable the beat happens anyway. One duplicate beat is a
  smaller harm than a pod silenced because its bookkeeping was briefly down.

Without `MAESTRO_QUEUE_URL` the maestro dispatches straight to the bridge and
reports a success it never observed. That path is kept only for pods not yet
migrated, and the maestro prints which mode it is in at startup.

---

## 8. Choosing between them

| Need | CLI | Why |
| :--- | :--- | :--- |
| Bulk mechanical work | agy | generous quota, wide perimeter handling |
| Reading a page as an image | opencode + an image-capable model | proven 99.80 % on the corpus |
| Careful in-context code editing | cursor-agent | Composer's strength |
| Deciding, arbitrating, verifying | Claude | one account, not interchangeable — the scarce one |

**Cost follows the volume of files read far more than the effort setting.** A
`low`-effort task over thirty documents cost 1.08 M tokens; a `medium` task over
six cost 268 k. Scope the perimeter before reaching for the dial.

---

## 9. Non-agent witnesses

These are not agents and must never be given a perimeter. They answer one
question and return.

| Tool | Role |
| :--- | :--- |
| `pdftotext` | the native-text witness; 100 % on clean vector PDFs |
| `tesseract` (in the pipeline image only) | the OCR witness; 96.52 % mean over the 37-case corpus |
| `ollama` / `qwen-vision` | local vision, free, no quota |

The pipeline **owns no model**: it declares a capability class and the universe
maps it to one of these. Changing provider must not change a line of pipeline
code.

---

## 10. Prerequisites, per CLI (Rule 34)

What each CLI needs in order to run at all. Everything here was found by running
the binary until it stopped complaining, not by reading a page.

| CLI | Needs | Where it must come from |
| :--- | :--- | :--- |
| **agy** | an OAuth session in `~/.gemini` | mounted from the host |
| | **a host, not a container** | see below — this one is structural |
| **opencode** | its own session directory | mounted from the host |
| | an image-capable model, for vision only | model id, checked against the catalogue |
| **cursor-agent** | `bash` — the launcher starts `#!/usr/bin/env bash` | **in the image**; Alpine fails, Debian carries it |
| | its whole version directory, not the launcher alone | mount `~/.local/share/cursor-agent/versions/<v>/` |
| | never the `~/.local/bin` symlink | it arrives dangling inside the container |
| | `--force` | otherwise it stops on Workspace Trust **and exits 0** |
| | `CURSOR_API_KEY` | outside the repository; read, never copied |

### agy cannot be containerised, and this is measured

Same credentials, same `installation_id`, same model, same minute:

```
host       → {"status":"SUCCESS"}
container  → {"status":"ERROR","error":"Individual quota reached. Resets in 149h"}
```

Mounting `/etc/machine-id`, setting `container=podman` on the host, and mounting
`~/.config/Antigravity` each changed nothing. Whatever identifies the caller to
Google differs inside a container, and the container's bucket is exhausted.

**Consequence, applied**: `bridge-agy` runs as a host process and the universe
points at its address. A universe declares where its bridge is; it never assumes
the bridge lives inside itself. That is Rule 34's last clause, and it is why the
clause exists.

### Verified end to end

Three bridges, one queue, one ledger, on `univ-test18-dev`:

```
trio-agy        COMPLETED  exit 0   → :4630   (host process)
trio-opencode   COMPLETED  exit 0   → :4640   (container)
trio-cursor     COMPLETED  exit 0   → :4610   (container)
```

Each job named its bridge in `payload.bridgeUrl`. The queue carried the address
without knowing what answered at it — which is the whole point.

---

## 11. Deferred: a dispatching micro-agent

The allocation rule today is explicit — a job or a pod names its bridge. That is
enough while a human decides, and it has the merit of being auditable: the
ledger records which agent ran what, so a wrong choice is visible afterwards.

**The idea, recorded rather than built**: a small agent that reads the task and
picks the executor, weighing cost, remaining quota, and fitness for the mission.

**Why not now**: routing cannot be better than the evidence it routes on, and
the evidence — cost per task type, success rate per agent per kind of work — is
only just starting to accumulate in `tasks-agy/.runs/journal.jsonl`. A router
built today would encode today's guesses as if they were measurements.

**What would reopen it**: enough journal entries to compare agents on the same
kind of task, or a mix of agents large enough that choosing by hand becomes the
bottleneck.

**The invariant that must survive it**: the system works with **one** agent
alone, and works with several. A router is an optimisation on top of a chain
that is already correct without it — never a component the chain depends on.

---

## 12. Proven end to end — 23 August 2026

A universe deployed from nothing on gbs-test, and a framed task carried through
it to real work:

```json
POST /api/jobs
{ "type": "agent.inject",
  "payload": {
    "conversation": "framed-4",
    "bridgeUrl":    "http://127.0.0.1:4610",
    "brief":        "Create a file named proof.txt containing exactly VERIFIED.",
    "perimeter":    "…/univ-test20-dev/work",
    "goal":         "proof.txt exists in the perimeter and contains VERIFIED" } }
```

```
verdict : COMPLETED
content : VERIFIED
```

The chain in full: a blank Debian LXC → the public repository → images built in
place → five bricks healthy → a job naming its bridge → the frame composed from
the one shared builder → the perimeter applied as the working directory →
Composer 2.5 doing the work → the terminal event read → the verdict recorded.

Nothing along that path was believed on its word. What it cost to get there is
in `LXC-CLEAN-SHEET-DEPLOYMENT-STEPS.md` and in the bricks' own intents: three
hidden dependencies, a bridge that died on a missing binary, a metric that
counted failures twice, and a perimeter that pointed at a directory the agent
could not see.
