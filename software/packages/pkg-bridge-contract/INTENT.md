# pkg-bridge-contract

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)

## Objective

Define the provider-neutral contract between SHAPER callers and cognition
bridges. The contract declares protocol version, readiness, and capabilities.
It never names an engine, a model, a CLI, or an external provider.

## Invariants

1. A bridge returns `shaper-bridge/v1` from `/api/status`.
2. A caller branches only on declared capabilities, never a provider name.
3. `ready: true` means the bridge can accept work; it does not prove a run
   completed, nor authorize an action.
4. Every run remains correlated to its Runtime evidence and terminal result.
5. New bridge implementations prove this contract before a universe promotes
   them to its one active core bridge.
