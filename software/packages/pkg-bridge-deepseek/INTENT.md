> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)
> **Package**: `@shaper/pkg-bridge-deepseek`

# Package intent — Bridge DeepSeek / Ollama

## Objective

Expose DeepSeek and Ollama Cloud engines through the **universal agent bridge
interface** (HTTP + SSE, Rule 8), including the on-premise and air-gapped paths
where sovereignty matters more than throughput.

## Invariants

1. **The interface is the contract, not the engine** (Rule 0H). Identical routes
   and event shape to every other bridge.
2. <a id="no-default-model"></a>**Endpoint and model are parameters, never
   hardcoded** (Rule 0B, Rule 7). No model name exists in this package, not even
   as a default: the deploying agent measures availability from the target host,
   records the choice, and supplies it through `OLLAMA_MODEL` (or `DEEPSEEK_MODEL`
   for the DeepSeek API path). A real bridge started without one halts and names
   the variable to provide (Rule 0J); only the simulated bridge
   (`BRIDGE_DEEPSEEK_STUB=1`), which calls no engine, runs without a model.
3. **Sovereign path stays sovereign.** When the universe declares an air-gapped
   perimeter, no request leaves it — a cloud fallback is a violation, not a
   convenience.
4. **Never silent.** Aborted tools and model errors are surfaced as explicit
   text.
5. **Ships what it needs** (Rule 34).

## Cognition

- **role**: provides · **capacity-class**: heavy-engineering · **depth**: D3 · **throughput**: T2 · **degraded**: allowed-with-note

Scales: [`../../../docs/architecture/COGNITION.md`](../../../docs/architecture/COGNITION.md).
