# Helm-v2 — Server Timeline & Event Contract

> See also [`AGENT-CONTEXT.md`](./AGENT-CONTEXT.md). Architecture in place since July 2026.

## Principle

**The timeline is built and persisted by the Express server** (`server/lib/timelineBuilder.js`), not by the browser. Browsers apply SSE events locally for instantaneous display, but never save history — they **re-read** server state to converge (turn completion, `timeline_sync`).

```
bridges (cursor :4310 / claude :4320 / asus·acer nodes) ── SSE ──► timelineBuilder (server) ──► data/timelines/*.json
        │                                                     │
        └── filtered SSE /conversation ──► browsers (live display, read-only)
                                           ▲ console-sync (timeline_sync) + GET /timeline
```

## Event Contract (Bridge)

Each injection creates a run with a unique `run_id`. **All** run events carry:

| Field | Role |
|-------|------|
| `conversation` | Bridge conversation name |
| `run_id` | Run UUID — enables rejecting stale run events |
| `seq` | Monotonic counter per run |

`POST /api/inject` (bridge) returns `run_id`. `GET /api/events?conversation=X` broadcasts only events for X (isolation); without filter: everything (server consumer).

## Server Side (`timelineBuilder.js`)

- A persistent SSE connection per CLI node (3s reconnection).
- Events applied with **the same reducer as frontend** (`src/lib/runStream.js`).
- Mapping `bridge run_id → timeline run item` established on inject (`linkBridgeRun`). Stale run events → **rejected** (no heuristics).
- `run_aborted` only aborts the run it owns — never a newly injected turn (`reason: replaced`).
- Debounced persistence (700ms) + immediate on `response_complete` / `run_complete` / abort; every save emits `timeline_sync` (console-sync).

## Turn Writes (Routes)

| Action | Route | Server Write |
|--------|-------|--------------|
| Send message | `POST /api/inject` + `turn: {humanId, runId, images}` | human + run (same ids as front) **before** bridge call |
| Voice turn | same + `voiceTurn`, `ackText` | human + `voice_ack` + run (`voiceTurn` flag) |
| Edit/resend | `POST /api/inject` + `resend: {humanId, text, images, runId}` | truncates at human, rewrites, rebuilds context (`injectText`) server-side |
| Clear + briefing | `POST /api/session/reset` + `prime, primeRunId` | presentation run (`prime: true`) |
| Stop | `POST /api/session/stop` | `running` runs → `aborted` |
| Bridge failure | (automatic) | aborted run + `system` item with error |

The frontend passes its ids (`humanId`, `runId`) so local and server timelines match identically.

## What Frontend No Longer Does

- `PUT /api/timeline` during stream (endpoint remains for backwards compat, with optimistic lock).
- Saving human/ack/run upon sending — server writes it.
- Debounced auto-save in `Dashboard.jsx` was deleted.

## Tests

`server/lib/timelineBuilder.test.js` (run_id contract, stale rejection, resend, prime, failure) — `npm test`.

## Specific to helm-v2

- **Multi-source**: builder consumes each unique URL (gbs-h1/asus/acer CLI nodes + cursor/claude plugins). Event routing to the right path goes first through global registry `run_id → path` (filled at inject), then falls back to `machine/user/name`.
- **run_id/seq stamped centrally** in `broadcast()` of both bridges (`liveRuns` per conversation) — no emission site individually modified.
- `sessionOrchestrator` (server prime/clear) adopts presentation run in builder (`adoptPendingRun`) and links bridge run.
- v2 store rejects unlocked writes: builder writes with `force: true` (server authority).
- Frontend: **no longer writes timeline** (since July 23, 2026). `persistTimeline` is a no-op; server (builder + orchestrator + inject/session routes) is sole writer and broadcasts `timeline_sync` at each write. Frontend renders in memory (`setTimelines`) and converges by re-reading (turn completion, `timeline_sync`). Verified in browser: send → reload → intact history, **0 `PUT /api/timeline`** emitted by client.

## MariaDB Storage (since July 23, 2026)

Timelines are no longer JSON files but a MariaDB table `timelines`
(`conv_hash` PK, `conv_path`, `items` LONGTEXT JSON, `updated_at` ISO string) —
compliant with the "mysql2 only" rule. Async `timelineStore` API
(`loadTimeline`/`saveTimeline`/`deleteTimeline`/`purgeTimeline`/`copyTimeline`),
schema created at boot (`ensureTimelineSchema`).

- **Seamless migration**: on first access to a conversation, if no
  DB row exists but legacy `data/timelines/<hash>.json` is present,
  it is imported automatically (lazy). Zero loss of history.
- `updated_at` remains an ISO string generated in JS → optimistic lock
  (string comparison) is preserved identically.
- Builder keeps in-memory cache `st.items` as synchronous source for
  event ordering; DB persistence is awaited (immediate at run end,
  debounced otherwise). SSE consumer `await`s every event.

## Simple Mode (Standard User)

`loadViewFilters(role)`: without explicit user choice, non-admin starts in "Response only" (thinking/tools/terminal/logs hidden); admin sees everything. Manual choice (localStorage) always wins.
