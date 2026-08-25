# Brick: Qdrant

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)

## 1. Declarative Objective

Vector search engine for embeddings and RAG — optional per universe.

## 2. Invariants

1. Official Qdrant OCI image.
2. Persistent host volume.
3. Localhost or mesh bind only.
4. Podman Quadlet lifecycle.

---

## Cognition

> Scales and semantics: [`docs/architecture/COGNITION.md`](../../../docs/architecture/COGNITION.md) · Extends Rule 21.

- **capacity-class**: — (deterministic, no engine)
- **role**: neutral
- **depth**: D0
- **throughput**: T3
- **degraded**: refuse
- **rationale**: Vector storage and search. Embedding is produced upstream; the store itself computes nothing that needs a model.
