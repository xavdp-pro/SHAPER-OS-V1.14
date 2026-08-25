# Intent: brick-bridge-deepseek

## Role
Dedicated HTTP/SSE agent bridge for the DeepSeek and Ollama Cloud engines.

## Invariants
- Exposes port 4350 by default (customizable per universe).
- No model is pinned here: reachable models are enumerated and measured from the target host at deployment (Rule 7).
- Uses `OLLAMA_API_KEY` / `DEEPSEEK_API_KEY` from environment or vault.
- Workspaces mounted at `/data/deepseek-ws`.

---

## Cognition

> Scales and semantics: [`docs/architecture/COGNITION.md`](../../../docs/architecture/COGNITION.md) · Extends Rule 21.

- **capacity-class**: heavy-engineering
- **role**: provides
- **depth**: D3
- **throughput**: T2
- **degraded**: allowed-with-note
- **rationale**: Engine bridge, including on-premise and air-gapped paths where throughput is traded for sovereignty.
