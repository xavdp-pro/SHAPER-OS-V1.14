# Package: @shaper/pkg-bridge-agy

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)

## 1. Declarative Objective

HTTP/SSE bridge piloting Antigravity CLI (agy) — Rule 8 agent container contract.

## 2. Invariants

1. Endpoints: `/api/health`, `/api/inject`, `/api/events`, `/api/metrics`.
2. API key via `ANTIGRAVITY_API_KEY` (`AQ.*`) only — never `GEMINI_API_KEY` / `GOOGLE_API_KEY` in agy spawn env.
3. Localhost or mesh bind only.
4. Native `node --test` suite validates contract before deploy.
5. <a id="no-default-model"></a>**No default model.** The model is a measured
   deployment value supplied through `AGY_MODEL` (or `ANTIGRAVITY_MODEL`), never
   a constant in this package or in a deploy script (Rule 7): two files once
   pinned two different versions for the same bridge, and both aged. A real
   bridge started without one halts and names the variable to provide (Rule 0J);
   only the simulated bridge (`BRIDGE_AGY_STUB=1`), which never spawns the CLI,
   runs without a model.
