# Package: @shaper/pkg-resident-observer

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)

## Objective

Provide the smallest resident observation base that can collect declared HTTP
facts, preserve a versioned context fingerprint, and append durable incident
evidence without changing the observed universe.

## Invariants

1. The observer accepts only contexts whose authority mode is `read-only` and
   whose observations use HTTP `GET`.
2. The context is a versioned file. Every incident event carries its version and
   SHA-256 fingerprint so later readers know which authority produced it.
3. Facts and hypotheses are distinct fields. Deterministic collection creates
   facts only; an empty hypotheses list is an honest result.
4. The incident journal is append-only JSONL. Opening, observing and resolving
   an incident never rewrites earlier evidence.
5. A destination is an abstract role identifier. This package never resolves a
   role to an address and never sends a notification.
6. There is no command executor, remediation callback, write endpoint, restart,
   deployment or provider call in this package.
7. Observation response bodies are bounded and retained as evidence only when
   the context explicitly requests JSON equality checks.

## Boundary

This package is P2 orchestration support. A universe owns its concrete context,
thresholds, endpoints and incident journal path. A later scheduler may invoke
it, but registration and activation are separate deployment decisions.

## Local execution

From the repository root, one bounded observation can be run explicitly:

```bash
node software/packages/pkg-resident-observer/runner.js \
  examples/context/ctx-resident-observer.json \
  /tmp/shaper-resident-incidents.jsonl
```

The command exits non-zero when the context or journal cannot be used. A service
mismatch is an observed incident, so it is persisted and returned with exit zero.
The command does not register a schedule, send a message or select an AI engine.
