# Package: @shaper/pkg-bridge-opencode

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)

## 1. Declarative Objective

HTTP/SSE bridge piloting the OpenCode CLI — free tier by default, with the concrete model measured at deployment.

## 2. Invariants

1. Endpoints: `/api/health`, `/api/inject`, `/api/events`, `/api/metrics`.
2. Default model: the most responsive free model measured at deployment (Rule 7). Never pin a version here, and never hardcode a paid key.
3. Spawn env must not inject Gemini/Antigravity keys into opencode.
4. Localhost or mesh bind only.
5. Native `node --test` suite validates contract before deploy.
