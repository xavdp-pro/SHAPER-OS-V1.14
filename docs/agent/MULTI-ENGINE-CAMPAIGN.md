# Multi-engine cold campaign

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)
> **Status:** preparation protocol; no V1.14 candidate or engine is qualified yet.

## Objective and boundaries

- Measure the [operating contract](OPERATING-CONTRACT.md) on available engines
  and their actual harnesses, using one fixed candidate and task set.
- Keep engine discovery and credentials in operator-side state. Do not commit
  tokens or prescribe model versions in the base.
- Give every cold tester an independent checkout and test universe with the
  same declared prerequisites. Declare prior exposure and cached terrain.
- Capture each result, failure and human intervention when it occurs.
- Use **report-only mode** for the comparative round. Fix upstream once, freeze
  a new candidate, and rerun affected cases on that candidate.
- Preserve evidence before destroying only the test resources this campaign made.

## Preparation gate

The campaign coordinator records:

1. The candidate's full commit, clean working tree, release metadata, local
   suite result and `npm run verify` result. Do not test a moving branch.
2. The target host, an isolated DEV/TEST resource allocation, registry and
   network prerequisites, supplied secret *names*, and the destruction boundary.
3. Available engine/harness pairs, measured from the target environment. A CLI
   installed locally is not proof it is authenticated or reachable from a brick.
4. For each pair: a bounded real response, usable tools and their permissions,
   selected cognition profile, configured run limit and spending limit.
5. The shared task fixtures, expected artefacts and observer's verification
   procedure. Availability probes are separate from the cold comprehension test.

If an engine is unavailable, record `UNAVAILABLE` with its error. If the harness
cannot provide the task's capabilities, record `UNSUPPORTED`. Neither is a pass
or an excuse to replace a real action with a simulation.

## Cases

| Case | Action under test | External evidence required |
| --- | --- | --- |
| A — Understand | Read the applicable entry route with no prior project briefing | Correct mandate, perimeter, dependencies, stop conditions and proof references; record every guess |
| B — Build | Follow the existing cold deployment protocol from the candidate | Build provenance, published digests, real services and a real job artefact |
| C — Carry context | Execute a bounded task whose decisive fact exists only in its configured context | The delivered context contains that fact and the inspected artefact uses it correctly |
| D — Act and verify | Perform a reversible task in the assigned universe | The expected file/record, correlated job and audit evidence, independent inspection |
| E — Stop | Interrupt an identified run in the harness | Acknowledged cancellation plus observed stopped work; unrelated runs remain intact |
| F — Resume | Replace the session or worker after a completed and an uncertain action | The replacement finds recorded state and checks effects before retry; no duplicate effect |
| G — Hand over | Give the same state and a new task to another qualified engine | The new engine continues without replaying the project history or repeating completed work |
| H — Fail visibly | Remove one prerequisite in an isolated test allocation | A named missing capability/context and no fabricated successful result |

Cases A and B use [COLD-READ-TEST.md](COLD-READ-TEST.md) and
[BETA-DEPLOYMENT-TEST.md](BETA-DEPLOYMENT-TEST.md). A cold read is spent once its
reader receives a correction. A subsequent retry is labelled informed, even
when the fix is small. Different engine families do not make readers cold if
they were given the earlier report.

Case E needs a real interruptible run. A closed browser tab or a lost SSE
subscription is not evidence that the backend stopped. Case F must include an
effect check; a conversation reset alone proves no recovery.

## Per-run report

Use the existing report for A or B, then add this table for the operating cases:

| Field | Value to record |
| --- | --- |
| Candidate | Full commit; pristine or locally changed |
| Engine and harness | Actual names and versions, configuration, target host |
| Exposure | Requester's declaration, reader's declaration, terrain inspected |
| Case and scope | Case id, task fixture, allowed paths/tools, resource ids |
| Result | PASS / FAIL / BLOCKED / UNAVAILABLE / UNSUPPORTED / NOT_RUN |
| Work | Job id, conversation, run id, actual tool actions |
| Proof | Artefact location, digest where applicable, observer and verification |
| Intervention | Exact human clarification, workaround or engine replacement |
| Cost | Measured duration and usage where available; otherwise unknown |
| Cleanup | Evidence export and deletion of the campaign's own test resources |

## Verdict

Every required case must have a result. NOT_RUN is never PASS. Publish a matrix
by engine/harness and role; keep unavailable and unsupported pairs visible.
Compute any pass rate with its explicit denominator. Do not pool informed
retries with cold attempts or call a stub a model measurement.

The coordinator reviews the artefacts independently of the producing agent.
Only that review can mark a role qualified for the tested candidate. Promotion
and fleet rollout continue to follow the existing canary and recovery rules.
