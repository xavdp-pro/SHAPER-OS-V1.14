> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)
> **Package**: `@shaper/pkg-bridge-cursor`

# Package intent — Bridge Cursor

## Objective

Expose the Cursor Composer CLI through the **universal agent bridge interface**
(HTTP + SSE, Rule 8), so that a universe can use it without knowing anything
about Cursor.

## Invariants

1. **The interface is the contract, not the engine.** Same routes, same SSE
   event shape, same context digest as every other bridge. Swapping this bridge
   for another requires no structural change anywhere else (Rule 0H).
2. **Fast mode is opt-in.** The default mode is standard; fast is activated on
   demand and never silently.
3. **Interactive class.** This engine expects a human at the keyboard. It is
   declared `interactive: true` and is never auto-dispatched by Maestro: work is
   queued as `AWAITING_HUMAN` and the operator is notified (Rule 21).
4. **Never silent.** A session that ends must produce explicit text — an aborted
   tool or a model error is surfaced, never an empty response.
5. **Ships what it needs.** The CLI and its prerequisites are declared and
   pinned in the brick image (Rule 34).
6. <a id="no-default-model"></a>**No default model.** The model is a measured
   deployment value supplied through `CURSOR_MODEL`, never a constant in this
   package (Rule 7): a pinned version expires with its vendor while the suite
   asserting it stays green. A real bridge started without one halts and names
   the variable to provide (Rule 0J); only the simulated bridge (`BRIDGE_CURSOR_STUB=1`),
   which never spawns the CLI, runs without a model.

## Cognition

- **role**: provides · **capacity-class**: rapid-iteration-ui · **depth**: D3 · **throughput**: T1 · **degraded**: allowed-with-note

Scales: [`../../../docs/architecture/COGNITION.md`](../../../docs/architecture/COGNITION.md).
