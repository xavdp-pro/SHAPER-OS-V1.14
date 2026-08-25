# Package: @shaper/bridge-agy

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)

## 1. Declarative Objective

HTTP/SSE bridge piloting Antigravity CLI (agy) — Rule 8 agent container contract.

## 2. Invariants

1. Endpoints: `/api/health`, `/api/inject`, `/api/events`, `/api/metrics`.
2. API key via `ANTIGRAVITY_API_KEY` (`AQ.*`) only — never `GEMINI_API_KEY` / `GOOGLE_API_KEY` in agy spawn env.
3. Localhost or mesh bind only.
4. Native `node --test` suite validates contract before deploy.
