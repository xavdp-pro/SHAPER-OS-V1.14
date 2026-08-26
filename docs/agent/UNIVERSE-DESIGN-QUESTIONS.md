# Universe Design Questions

Before creating or changing an `univ-*`, answer these from repository evidence.
If an answer is absent or contradictory, stop and report it; do not invent architecture.

1. What profile is requested: `passive`, `agent`, or a declared preset?
2. Which `brick-*` components are mandatory and which are explicit extensions?
3. Does each component belong to the base or the catalogue?
4. What `img-*` digest is locked for every deployed brick?
5. Which `vol-*` data must persist and remain isolated to this `univ-*`?
6. Which ports remain private and which are intentionally exposed?
7. Which secrets are required, where are they supplied, and which are forbidden from Git?
8. Which `ctx-*` and `task-*` files define the work without introducing business logic into the base?
9. What end-to-end `proof-*` demonstrates real work beyond health endpoints?
10. Does `univ-base` already answer the generic part of the request?
