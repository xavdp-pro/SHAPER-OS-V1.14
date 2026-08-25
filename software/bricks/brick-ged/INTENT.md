# Brick: GED (Mini-GED Document Hub)

> **Intent Classification**: GENERIC INTENT (Sovereign Document Hub)

## 1. Declarative Objective

Sovereign persistent file & document storage hub (`/data/ged`) with responsive UI (Desktop + Mobile) for bulk uploads, classification, preview and downloads.

## 2. Invariants

1. Pure ESM zero-external-dependency Node 20 server.
2. Persistent host volume mounted on `/data/ged`.
3. Standalone micro-service decoupled from cockpit logic.
4. Podman Quadlet lifecycle.

---

## Cognition

> Scales and semantics: [`docs/architecture/COGNITION.md`](../../../docs/architecture/COGNITION.md) · Extends Rule 21.

- **capacity-class**: fast-eval
- **role**: requires
- **depth**: D1
- **throughput**: T2
- **degraded**: allowed-with-note
- **rationale**: Extraction and cataloguing over documents. Content addressing and checksums are deterministic (D0); only the analysis step consumes a model, and a degraded run must be recorded as such.
