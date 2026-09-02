# Driving Antigravity without an IDE or a permission prompt

> **Question asked**: can Antigravity be disciplined for use under test command,
> without it asking for authorisations in the IDE?
> **Answer**: yes. The `agy` CLI has everything needed, and this brick's bridge already exists.

---

## 1. The two paths

### Path A — the CLI directly (short loop, a single agent)

```bash
agy -p "<instruction>" \
    --output-format json \
    --mode accept-edits \
    --sandbox
```

| Flag | What it sets |
| :--- | :--- |
| `-p` / `--print` | **a single instruction, non-interactive**, then exit. This is the "test command" mode. |
| `--output-format json` | output usable by a script. `stream-json` for NDJSON as it flows. |
| `--json-schema <file>` | imposes the **shape** of the answer — indispensable when a script consumes the result. |
| `--mode accept-edits` | the agent applies its changes without confirmation. `plan` for it to propose without touching. |
| `--sandbox` | terminal restrictions. **Keep it** as soon as confirmations are removed. |
| `--effort low\|medium\|high` | doses the reasoning, hence the cost. |
| `--conversation <id>` / `--continue` | resumes an existing session. |
| `--add-dir <path>` | limits the workspace to the declared directories. |
| `--input-format stream-json` | one NDJSON instruction per line on standard input: **batch mode**. |

### Path B — the HTTP bridge (orchestration, several callers)

This is the recommended path as soon as another component drives the agent: the queue, Maestro, a test.
The caller **never launches `agy`** — it speaks HTTP to the bridge, which owns the process.

```bash
TOKEN=$(cat <path-to-the-bridge-token>)

# 1. Open the stream BEFORE injecting, or the first events are missed
curl -sN -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:4330/api/events?conversation=test-pipeline"

# 2. Inject
curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"conversation":"test-pipeline","message":"<instruction>","model":"gemini-3.7-flash-low"}' \
  http://127.0.0.1:4330/api/inject
```

Events received: `connected`, `inject`, `response`, `response_complete`, `run_complete`, `log`.
`conversation` is a stable identifier: same id, same workspace.

---

## 2. The key trap — a known cause of freezes

| Variable | Prefix | Effect |
| :--- | :--- | :--- |
| **`ANTIGRAVITY_API_KEY`** | `AQ.` | ✅ the right one |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | `AIza…` | ❌ forces `modelProvider: gemini` → **429 and a frozen agent** |

This brick's `buildAgySpawnEnv()` already removes `GEMINI_API_KEY` and `GOOGLE_API_KEY` from
the child process environment, and accepts the key only if it starts with `AQ.`.
Do not bypass this guard.

---

## 3. State observed on this machine

```
GET /api/health :4330
{"ok":true,"service":"univ-bridge-agy","port":4330,
 "model":"gemini-3.7-flash-low","stubMode":true,"hasApiKey":false}
```

* The bridge **runs and answers**.
* `hasApiKey: false` → **no key configured**, hence `stubMode: true`: it simulates instead of
  driving the real `agy`. That is the only missing element.
* The `agy` binary is present on the machine.

**To enable**: set `ANTIGRAVITY_API_KEY=AQ.…` in the bridge's environment, then
restart it. `hasApiKey` must turn to `true` and `stubMode` to `false`.

---

## 4. On `--dangerously-skip-permissions`

This flag exists and does exactly what its name says: **it approves every tool request
outright**. It carries that warning for a reason.

Position adopted:

* Under **test command**, `--mode accept-edits --sandbox --add-dir <perimeter>` is enough in the
  vast majority of cases, and leaves the sandbox in place.
* `--dangerously-skip-permissions` is justified only in a **disposable container, on a declared
  perimeter**, never on the working machine nor on a living repository.
* Combined with `--sandbox` and `--add-dir`, it stays bounded. Alone, it is not.

> Removing confirmations is an operating choice, not a development shortcut:
> what protected was not the question asked of the human, it was the perimeter. If
> the question is removed, the perimeter must be tightened accordingly.
