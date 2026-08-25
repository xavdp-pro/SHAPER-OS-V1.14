# Concretizing Shaper with KovZu

Synthesis of product direction (July 23, 2026). KovZu (helm-v2) is the
**technical concretization of Shaper** (shaper.xavdp.pro).

## Shaper — Positioning (reminder)

Xavier = **business tool shaper**. "Human first · then technology".
Target: **executives of SMEs/startups who understand their trade but not
IT** ("I am not an IT specialist", "no forms to fill out").
Promise: a **controllable foundation** — a unified cockpit (not a patchwork),
**business agents connected to the foundation** (not a generic chatbot),
eliminating repetitive tasks. Deployment: cloud / hybrid / on-premise.
Maturity: discuss → shape foundation → embroider (iterate).

## KovZu = The Controllable Foundation Made Real

What we are building must make an executive say: **"it really does my work"**,
and Xavier: **"we provide a real turnkey tool to steer their business"**.

### Guiding Principle for Access to Data/Actions (order imposed on the agent)

1. **API first.** The CLI agent LOOKS for an API (official, internal, portal
   private endpoint), documents it, and **uses the API if it exists**
   (token/key) — more reliable, faster, without UI fragility.
2. **Everyday browser as a LAST resort**, only if no API exists:
   a **Chrome with persistent sessions** (login/password retained; otherwise
   re-entered once) to operate on webmail, portals, invoices, LinkedIn…
   and retrieve the actual file.

(Encoded in `server/lib/agentSkills.js`, injected at prime + recalled at each turn.)

### What Makes the Tool Impressive and Turnkey

| # | Lever | Executive effect |
|---|-------|------------------|
| 1 | **Watching the agent act** on real tools, **narrated out loud** | "it does my work before my eyes" |
| 2 | **Co-pilot**: agent acts, executive takes over (2FA, choices) | removes fear of getting stuck |
| 3 | **Pre-connected sessions** (persisted, encrypted) — never re-login | "turnkey" |
| 4 | **Onboarding through conversation** (no form) — agent discusses pain points and builds foundation | faithful to Shaper step 1 |
| 5 | **"If it recurs → it becomes a button"**: each recurrence = saved capability (embroidery) | foundation grows, the tool is theirs |
| 6 | **Guardrails**: confirmation before sensitive action (pay/send/delete) | confidence to delegate |
| 7 | **Voice + single cockpit screen**, downloadable deliverables | zero jargon, immediately usable |

### Right Panel (Canvas) — The 3 Views

- **Preview**: vibe-code of a business tool (CRM…) visible live (internal proxy,
  same URL). The executive watches their tool being built.
- **Debug**: view where the agent acts and where one takes over.
- **Browser**: everyday Chrome (connected sessions) — when there is no API.

## Technical Status (Done / To Complete)

**Done:** server foundation (server authority timeline, MariaDB), contextual voice,
downloadable deliverables, document upload, agent skills (API-first included),
3-tab right panel, docker container POC (Neko launched + URL auto-login).

**To complete for remote "wow" effect:**
- **Neko TCP-mux**: make browser/desktop video stream visible through Cloudflare
  tunnel (today UI loads, but video stream does not).
- **Voice narration** while the agent acts.
- **Takeover control** exposed in the tab.
- **Persistent sessions** per service (encrypted) for everyday Chrome.
- **Guardrails** with confirmation on sensitive actions.

## In One Sentence

**KovZu = the controllable foundation of Shaper: a voice cockpit + a panel showing
the agent in action (API first, connected browser otherwise), where each recurring task
becomes a capability — the executive's turnkey business tool.**
