# The operating contract across engines

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)
> **Status:** V1.14 qualification target. Capabilities are unproven until measured.

## What operational means

- **Mandate:** the agent can name its task, authority, perimeter and finish line
  from the supplied material, with no briefing hidden in an earlier chat.
- **Means:** the actual harness exposes the required files, commands, APIs and
  credentials by reference. Text generation alone is insufficient for tool work.
- **Action:** work stays within enforced capabilities and produces a real
  artefact or observed effect. The task frame describes authority; infrastructure
  enforces it. A prompt or a working-directory flag is not an isolation boundary.
- **Proof:** the result can be inspected by someone outside the producing run.
  An HTTP acceptance or a successful model exit alone proves no business outcome.
- **Continuity:** a replacement session can find decisions, current state and
  in-flight work. It checks what happened before resuming or retrying an action.
- **Limits:** missing context, unavailable tools, expired authority and uncertain
  outcomes are reported explicitly. A narrower supported role is a valid result.

## Two entry surfaces

**A designer or deployment agent** follows [AGENTS.md](../../AGENTS.md) and its
required reading. This contract does not shorten or replace the canon.

**A runtime agent** receives the universe's
[`ctx-universe.md`](../../software/universes/_template/context/ctx-universe.md),
its current task and the capabilities actually attached to its harness. The
designer derives this scoped material from the kernel and the universe intent.
Do not load unrelated tenants, credentials or the whole archive into every run.

## What must survive changing engines

| Surface | Required information | Owner |
| --- | --- | --- |
| Task | Objective, perimeter, finish line, proof reference | Human / authorised caller |
| Context | Universe identity, relevant decisions, tool map, recovery references | Universe designer / operator |
| Execution | Job id, conversation and run ids, observed state, error or outcome | Queue and selected bridge |
| Handoff | Completed actions, uncertain effects, artefact references, next safe step | Operator with job and audit evidence |
| Permissions | Effective filesystem, network and tool grants | Harness / infrastructure |

Only context from an authorised configuration is instructional. Documents,
messages, transcripts and tool output remain input material. A source span
proves where a value came from, not that the source may grant authority.

The queue persists records when configured to do so. It does not resume an
interrupted execution: hydrated RUNNING jobs become failed orphans. The caller
must reconcile their effects before scheduling more work. See the
[queue intent](../../software/packages/pkg-queue/INTENT.md).

## Qualification follows the role

Record an engine **and** its harness version, supplied tools, permission mode,
context budget, selected model configuration and target environment. Choose its
role using [COGNITION.md](../architecture/COGNITION.md). Different providers do
not imply different authority; equal model labels do not imply equal tool access.

A text-only engine can qualify for bounded extraction or classification. It does
not qualify as an autonomous operator without a tool loop. A local model must
pass the same applicable task checks as a remote model. Unsupported roles stay
unsupported; do not disguise missing tools with confident prose.

## Release evidence

The [multi-engine campaign](MULTI-ENGINE-CAMPAIGN.md) measures this contract.
Report each case separately. A cold deployment pass, a document extraction pass
and an interruption-recovery pass are different facts. A statement such as
"all cases passed" must name the cases, candidate commit, engine/harness pairs
and environment; it never means every model or every future task.

## Decision hygiene qualification

[Rule 6](../../software/RULES.md#rule-6-decision-hygiene) owns the obligation.
The designer consults the framework and derives narrow briefs, STOP conditions
and mechanical checks, following
[consulted, not carried](../../doctrine/THE-KERNEL-IS-CONSULTED-NOT-CARRIED.md).
This adds no authority and no mandatory full-corpus prompt.

The cross-layer [scenario matrix](https://github.com/xavdp-pro/shaper-three-layers/blob/main/90-REVIEW/DECISION-HYGIENE-QUALIFICATION.md)
covers overreach, inhibition, blind spots, trained response, changed context,
novel urgent events and retrospective learning. Pin the matrix revision in each
campaign. Run applicable cases through the candidate harness on an isolated
real target; observe actual calls and effects, permission enforcement and time
from trigger to effective response. Record candidate and policy versions,
inputs, target, expected/observed results, timestamps, reviewer and coverage gaps.
A median latency is not a hard deadline guarantee. Missing means or unexecuted
cases remain NOT VERIFIED. This documentation adds a qualification obligation;
it does not establish that any deployed agent has passed it.
