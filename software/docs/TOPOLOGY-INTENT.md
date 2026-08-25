# SHAPER OS — Declarative Dependency Topology

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)  
> **Canonical Source**: [`topology.json`](../topology.json) (repo root)  
> **Perimeter law**: [`PERIMETERS.md`](./PERIMETERS.md) — strict P1 vs P2 (see note below)  
> **Validator CLI**: `scripts/shaper-deps.mjs` — **planned, not yet in repository**

---

## 1. Declarative Objective

Declare once — at the topology level — which SHAPER OS packages and bricks depend on each other, in what startup order they must boot, and which host volumes must be mounted. No imperative wiring scattered across scripts, Quadlets, or import paths.

---

## 2. Universal Invariants (Parameterized)

1. **Single Source of Truth**: All dependency contracts live in [`topology.json`](../topology.json). Packages and bricks MUST NOT hardcode cross-service URLs or startup assumptions outside this manifest.
2. **Acyclic Graph**: The `requires` graph is strictly directed and acyclic.
3. **Tiered Cold-Boot Order**: `bootLayers` defines parallel-safe boot waves. Tier N+1 nodes MUST NOT start before all nodes in tier N are healthy.
4. **Import ↔ Requires Alignment**: If a package source file imports another `@shaper/*` package, that dependency MUST appear in `packageImports` or node `requires`.
5. **Brick Isolation Preserved**: Packages declare logical dependencies only. Universes (`UNIV*`) consume the topology — they never mutate it.
6. **Parametric Deploy Contract**: Volume mounts and systemd `After=` use abstract placeholders resolved at deploy time.

### Note: `minimalSocle` vs PERIMETERS

The `topology.json` field `minimalSocle` lists packages spanning **P1 and P2** (e.g. maestro, bridges). For perimeter law, see [`PERIMETERS.md`](./PERIMETERS.md):

- **Strict P1 boot**: `vault` ∥ `logger` → `queue`
- **P2 attaches after**: maestro, agent, mail-agent, bridges, helm, ged, rag

A future refactor may split `minimalSocle` into `socleP1` and `agenticP2`.

---

## 3. Node Contract Fields

| Field | Purpose |
| :--- | :--- |
| `requires` | Hard dependencies — must be healthy before this node starts |
| `optional` | Soft dependencies — used if present, not blocking |
| `provides` | Capability tags for universe-level composition |
| `optionalBrick` | e.g. `qdrant` — not required for minimal stack |

---

## 4. Validator Commands (planned)

When `scripts/shaper-deps.mjs` is implemented:

```bash
node scripts/shaper-deps.mjs doctor    # full health check
node scripts/shaper-deps.mjs validate  # graph only
node scripts/shaper-deps.mjs order     # cold-boot order
```

Until then: validate manually against `topology.json` and run `npm test`.

---

### Illustrative Example (Non-Binding / Demonstration Only)

* **Tier 0** (parallel): `vault`, `logger`
* **Tier 1**: `queue`
* **Tier 2**: `maestro`, bridges (P2)
* **Tier 3**: `helm`, optional `ged`, `qdrant`
