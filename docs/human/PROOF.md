# Proof

Not a demo website. A real loop: install → order → action → log → answer.  
Voice or text. **No browser** for steps 0–3.

This proves **DEV**. TEST-from-scratch and PROD are [`LIFECYCLE.md`](./LIFECYCLE.md) — do not skip them before real customers.

> From Linux, the IDE agent installed Shaper OS from this repository. I can give orders. The agent acts, logs, and answers without a UI.

| Step | Check | Proof |
| :--- | :--- | :--- |
| 0 | `npm test` green; stack healthy; `npm run test:live` green (tier-b: + `test:live:helm`) | START-HERE steps 4 then 7–8 |
| 1 | “What’s running?” / “List jobs” / “Queue a test job” | True answers; job id in the log |
| 2 | “Run a test task” / “What did you last do?” | Queue terminal state + persisted `job.result.answer` + correlated JSONL log + verified artefact |
| 3 | “Top client last month?” on a **fixture file** | Matches the file (no invented numbers) |
| 4 | Optional: `https://<DOMAIN>/console` + phone mic | Same orders without the IDE |
| 5 | Later: blank host, same git tag, all tests, Vault `0600` + restart without bootstrap, **destroy** | TEST / recovery — see LIFECYCLE |

Fail step 1 if a browser was required.

Fail step 2 if the only copy of the answer lived on a transient SSE connection,
if a health endpoint was used as task proof, or if the audit event cannot be
joined to the Queue job id.

Fail byte-exact artifact proof if it relies on `test "$(cat file)" = value`:
command substitution removes trailing newlines. Generate the expected bytes
explicitly and use `cmp`, then inspect the artifact outside the agent run.

After DEV proof: business apps as **separate programs**, not inside `/console`.

```
Operator: ____________  Date: ____________
[ ] 0 install  [ ] 1 no UI  [ ] 2 audit  [ ] 3 fixture
[ ] 4 phone (optional)  [ ] 5 TEST from scratch then destroy (before prod)
```
