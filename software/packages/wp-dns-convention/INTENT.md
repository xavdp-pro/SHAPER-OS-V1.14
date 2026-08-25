> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)
> **Package**: `@shaper/wp-dns-convention`

# Package intent — Fractal DNS Naming

## Objective

Compute hostnames for a fractal WordPress fleet from slugs alone, so that
manager and site addresses are **derived**, never typed by hand in two places.

```
manager :  {managerSlug}.{zone}
site    :  {siteSlug}.{managerSlug}.{zone}
```

The shape of the name mirrors the shape of the hierarchy: a child's address
contains its parent's. Reading an address tells you where a universe sits.

## Invariants

1. **Naming is canonical and derived** (Rule 1). No hostname is composed
   ad hoc in a script, a manifest, or a UI.
2. **Zone and slugs are parameters** (Rule 0B). Any default in this package is a
   test convenience, and a production zone is always injected — a default that
   reaches production is a hardcoding defect, not a shortcut.
3. **A name never crosses environments.** DEV, TEST and PROD zones are distinct;
   a TEST universe never resolves to a production hostname (Rules 9, 10).
4. **Pure functions only.** This package resolves nothing, calls nothing, and
   holds no credential. It computes strings and is fully testable offline.

## Cognition

- **role**: neutral · **depth**: D0 · **throughput**: T3 · **degraded**: refuse
- **rationale**: String derivation. Deterministic by construction.

Scales: [`../../../docs/architecture/COGNITION.md`](../../../docs/architecture/COGNITION.md).
