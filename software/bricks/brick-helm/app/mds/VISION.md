# Helm — product vision

> **Canonical copy**: [`../VISION.md`](../VISION.md). This file mirrors it for agent doc index (`mds/`).  
> **Perimeter law**: KovZu `/console` = **P2** — see [`../../../../docs/PERIMETERS.md`](../../../../docs/PERIMETERS.md).

## Metaphor

**Helm** = steering wheel / rudder.  
You direct (voice / commands); the desktop screen displays; Cursor builds whatever becomes recurring.

## Target Architecture

```
┌─────────────────┐     WebSocket      ┌──────────────────┐
│ Mobile Helm     │ ─────────────────► │ Desktop Helm     │
│ Voice (mic)     │                    │ Desk (display)   │
└────────┬────────┘                    └────────┬─────────┘
         │                                      │
         │ STT / TTS                            │ Business UI pages
         ▼                                      ▼
┌─────────────────┐                    ┌──────────────────┐
│ Command hub     │ ─── if recurring ─►│ Cursor CLI       │
│ + users auth    │                    │ (generates tool) │
└─────────────────┘                    └──────────────────┘
```

## Phases

| # | Phase | Status |
|---|-------|--------|
| 0 | Web Cursor console (cursorauto fork) | **Done** — <PUBLIC_HOST> |
| 1 | MariaDB user admin | **Done** — CRUD; login still global |
| 2 | Real auth + magic links + demo users | **To do** (P2 Helm) |
| 3 | Operator voice in `/console` | **In progress** — STT/TTS, Groq ack (P2). Routes `/talk` `/voice` **removed** |
| 4 | Mobile → desktop WebSocket (Helm Desk) | **To do** (**P3** — distinct app) |
| 5 | CRM POC (emails, invoices, charts) | **To do** (**P3** — outside KovZu) |
| 6 | Docker / packaging | **Later** — not now |

## Target Command Examples

- "Show Dupont's emails"
- "Calculate this client's invoices"
- "Make a 6-month turnover chart"
- "Open the results page"

If the request recurs often → Cursor codes the module → subsequent navigation only.

## Voice

- **Current (P2)**: Deepgram STT/TTS + Groq ack **in `/console`** (`useChatVoice`, `/api/voice/*`)
- **Removed**: dedicated `/talk` and `/voice` pages (redirect → `/console`)
- **P3 Next steps**: Mobile Helm Desk + desktop WebSocket (distinct from KovZu)

## Subcomponents (names)

| Name | Role |
|------|------|
| Helm Core | Current Cursor console (`/console`) — **P2** |
| Helm Voice | Voice layer **in `/console`** (P2) — former Talk page removed |
| Helm Desk | Driven desktop app (**P3** — distinct from KovZu) |
| Client Tools | Business applications **P3** — strictly distinct from KovZu |
