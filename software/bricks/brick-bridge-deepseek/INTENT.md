# Intent: brick-bridge-deepseek

## Role
Dedicated HTTP/SSE agent bridge for DeepSeek R1/V3 & Ollama Cloud.

## Invariants
- Exposes port 4350 by default (customizable per universe).
- Default model: `deepseek-r1` (reasoning chain-of-thought).
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
