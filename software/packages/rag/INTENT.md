> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)
> **Package**: `@shaper/rag`

# Package intent — RAG & Vector Indexing

## Objective

Turn documents and events into retrievable semantic memory, so an agent can
answer from what the universe actually holds rather than from what it recalls.

## Invariants

1. **Multi-tenant isolation is absolute.** Collections are scoped per universe
   and per tenant; a query never crosses a perimeter boundary, and there is no
   "shared" collection (Rule 22).
2. **Retrieval is evidence, not authority.** A retrieved chunk supports an
   answer; it never becomes a fact by having been retrieved. Answers cite what
   they used.
3. **Ingestion is idempotent.** Re-ingesting an unchanged document produces no
   duplicate vector — content addressing decides, not filenames.
4. **Embedding dimensions are declared once.** A collection created with one
   vector size is never silently reused with another.
5. **Data lifecycle is the universe's, not the engine's.** Retention and
   deletion follow the owning universe's declaration (Rule 31).

## Cognition

- **role**: requires · **capacity-class**: fast-eval · **depth**: D1 · **throughput**: T2 · **degraded**: allowed-with-note
- **rationale**: Chunking and storage are deterministic; only embedding consumes a model. A degraded embedding run must be recorded, because silently mixed embedding qualities corrupt a collection permanently.

Scales: [`../../../docs/architecture/COGNITION.md`](../../../docs/architecture/COGNITION.md).
