# Plan — An Agent Controls/Debugs an Authenticated Website (Extension vs "Underneath")

**Type:** plan + checklists + architectural decision (nothing coded here).
**Scope:** KovZu (helm-v2) — allow a CLI agent to **navigate, change URLs,
act, and debug (JS/DOM)** on a site where a user is authenticated.
**Future home:** `helm-v2/app/mds/` (active hub).

Origin: requests from the session — "control the browser/desktop via the view",
"an everyday Chrome that keeps logins", "API first, browser as a last
resort", "the user watches the agent act and is impressed".

---

## 0. The Question Posed (Two Parts)

1. **Control** an authenticated site (change URLs, click, act, extract).
2. **Debug** the JS/DOM of a site.

For both: **Chrome extension** or **"go underneath"**?

---

## 1. Short Answer

> **Underneath** (controlling a server-side Chrome via **CDP**) is the default,
> for controlling **as well as** for debugging. The **extension** is justified only in
> **one** specific case (§4). And for an app **built with KovZu**, often
> **neither**: we go through its **API/DB** (API-first).

Why: an extension that inspects DOM/JS uses `chrome.debugger`, which
**wraps CDP**. Controlling CDP directly (Playwright / puppeteer / raw CDP)
provides **everything** a devtools extension provides — DOM, console, network,
JS evaluation, breakpoints, mutation observation — **plus** server-side,
parallel, schedulable control, without per-user installation.

---

## 1 bis. Default Recommendation (Phase 0) — "Like Cursor", Frictionless

> **Decided (2026-07-24).** For the most common case — **debugging a web app
> under development, in direct collaboration with the person** — the default is
> **Option 1: Neko + CDP displayed in the KovZu panel**. Zero installation
> on the user's end. Options 2 and 3 = explicit fallbacks.

**Why this model.** The integrated browser in **Cursor** is neither an extension
nor the user's everyday Chrome: Cursor **launches its own Chromium** and
controls it via **CDP** (the agent reads console/DOM/network + screenshots, the human sees
the same view). It is frictionless *because* it is a browser that the tool
controls. To **debug an app in dev**, one does **not need** the user's real
logins → therefore not their real browser → therefore **no extension**.

**Structural caveat.** Cursor is a **local** (desktop) app → its local
browser is "free". KovZu is **cloud** (${SHAPER_PUBLIC_HOST}): a web page cannot
launch a Chrome on the user's machine (sandbox). Hence the
ranking below — "truly local" incurs an installation cost.

| Rank | Approach | User Friction | Local? | Use Case |
|------|----------|---------------|--------|----------|
| **1 (default)** | **Neko + CDP in the panel** | **zero install** | no (cloud, WebRTC streamed) | **debug a web app / dev — the "like Cursor" case** |
| 2 (fallback) | **Local companion** (binary launching Chrome `--remote-debugging-port` + outbound tunnel) | one-time install | **yes, truly local** | debugging on the person's machine/LAN, low latency, or their real sessions |
| 3 (fallback) | **Chrome extension** (`chrome.debugger` + WSS relay) | install + `debugger` permission + MV3 | yes, their everyday Chrome | **only** if their **real everyday tabs** are needed |

**Concrete consequence:** we build option 1 first (it is already the
most advanced in code: Neko + Playwright present). Option 2 is only opened
if a "truly on their machine" need emerges; option 3 only for
the case in §4. Technical detail of Neko+CDP unification in §5.

---

## 2. First: Separate Two Scenarios (Often Confused)

| Scenario | What We Have | Best Approach |
|---|---|---|
| **A. App built WITH KovZu** (our SaaS/CRM) | source code, API, DB | **Direct API/DB** — no browser. "Changing the URL" = agent drives app via its backend. See `preview.js` (same-origin reverse-proxy already in place). |
| **B. Third-party authenticated site** (LinkedIn, Gmail, external CRM without sufficient API) | only a browser session | **Underneath**: server Chrome with persistent profile, CDP-controlled, viewable via Neko. |

> API-first rule (already in agent context): look for the API **before** the
> browser. Controlled browser = last resort, for Scenario B.

---

## 3. The 3 Technical Approaches Compared

### A. Chrome Extension
- **+** runs in the **real** browser of the user (their cookies, their
  SSO/2FA already done); content scripts to read/modify the DOM; `chrome.tabs`,
  `chrome.scripting`, `chrome.debugger`.
- **−** install + permissions per user; Manifest V3 constraints
  (ephemeral service worker, no arbitrary remote code); **difficult server-side
  control** (need a native-messaging/WebSocket channel to the extension);
  no headless or parallelism; breaks with Chrome updates; nothing runs
  when browser is closed.
- **Security**: acts with the user's **full identity** — powerful
  and dangerous, must be scoped very tightly.

### B. "Underneath" — Server Chrome Controlled via CDP (Recommended)
- A Chromium runs server-side (already: **Neko** container), controlled via
  **CDP/Playwright**. **Persistent** profile ⇒ keeps logins (the requirement
  for "Chrome that keeps sessions"). Streamed in **WebRTC** ⇒ user
  **watches** agent act (the "impressive" effect).
- **+** 100% programmatic control (navigate, change URL, click,
  extract); **complete debugging** (DOM, console, network, JS eval, breakpoints,
  **request interception/rewriting** = literally "changing URLs from underneath");
  headless, parallel, schedulable (→ maestro-v1); **zero install**
  on user's end.
- **−** sessions live **server-side** (in the container profile): one must
  log in **once** inside it (or import cookies); first SSO/2FA happens
  in that browser; some sites detect automation.
- **Security**: sessions stored server-side ⇒ must be protected — **direct link
  with the `vault-v1` plan** (see `PLAN-VAULT-V1.md`).

### C. Reverse-proxy / MITM (The Most "Underneath")
- Route traffic via a KovZu proxy, rewrite at HTTP level (what `preview.js`
  already does for root-absolute URLs).
- **+** transparent, no browser dependency; rewrites URLs/injections.
- **−** invasive and fragile TLS interception; auth cookies tied to real
  domains break; painful CSP/CORS; this is not "controlling", merely
  rewriting. **Good for our own app preview, bad for driving a third party.**

---

## 4. The Only Case Where the Extension Wins

When the action **must** happen in the **user's browser, on
their machine, with their identity** — and cannot migrate server-side:

- Enterprise SSO locked to the user's hardware device / 2FA.
- Policy: "the session never leaves my workstation".
- Need to act on real tabs the user already has open.

In this case: minimal MV3 extension + channel (native messaging or local WS) to
KovZu, agent sends CDP commands via `chrome.debugger`. Treat as a
**fallback**, not a foundation.

---

## 5. Recommended Architecture (Unifying Neko + CDP)

Key idea: **a single Chrome**, that the user **watches** (Neko WebRTC) and the
agent **controls** (CDP) — not two separate browsers.

```
   CLI agent (sub)                       user (watches)
        │  CDP commands                          ▲ WebRTC (Neko)
        ▼                                        │
   ┌──────────────────────────────────────────────────────┐
   │  Neko/Chromium container                             │
   │  Chromium --remote-debugging-port=9222               │
   │  PERSISTENT profile (mounted user-data-dir = logins) │
   └──────────────────────────────────────────────────────┘
        ▲ helm-v2: browserContainers.js / routes/browser.js (already there)
        ▲ sessions/cookies protected ← vault-v1 (to come)
```

Real verified state (2026-07-24):
- ✅ `server/lib/browserContainers.js` + `routes/browser.js`: launch/rebuild
  Neko (`ghcr.io/m1k1o/neko/chromium`), autologin via `NEKO_PASSWORD`.
- ✅ Playwright already a dependency (`@playwright/test`, `playwright install chromium`).
- ❌ **Not yet** a persistent profile (`user-data-dir`) → logins **not retained**.
- ❌ **Not yet** an exposed CDP port (`--remote-debugging-port`) → agent does not
  yet drive Neko's Chrome.
- ✅ `preview.js`: same-origin reverse-proxy + URL rewriting (Scenario A/C).

---

## 6. Phased Plan + Checklists

### Phase 0 — Decisions (Resolved on 2026-07-24, see §1 bis)
- [x] **Default = Option 1: Neko + CDP in panel** ("like Cursor", zero install)
- [x] Option 2 (local companion) = fallback "truly on their machine"
- [x] Option 3 (extension) = fallback §4 only (their real everyday tabs)
- [x] Scenario A (KovZu app) → **API/DB**, no browser
- [x] Single Chrome (streamed Neko + CDP controlled), not two

### Phase 1 — Persistent Chrome + CDP Port (Scenario B Foundation)
- [ ] Mount a persistent `user-data-dir` in Neko container (per
      user/workspace) → **logins survive** restarts
- [ ] Launch Neko's Chromium with `--remote-debugging-port=9222` (bind
      **container loopback only**, never exposed to network)
- [ ] From helm-v2: connect via CDP (Playwright `connectOverCDP`)
- [ ] Test: agent opens URL, user sees it change in Neko view

### Phase 2 — Login-Once + Session Persistence
- [ ] "Log in once" flow: user logs into Neko view,
      session remains in persistent profile
- [ ] Alternative: cookie import (browser export → CDP injection
      `Network.setCookies`) — to avoid retyping credentials
- [ ] **Protect profile/cookies** via `vault-v1` (never leave plaintext
      on unencrypted disk) — see `PLAN-VAULT-V1.md`
- [ ] Never pass password/cookie into LLM context (names only)

### Phase 3 — Driving & Control (Scenario B)
- [ ] Agent primitives: `goto(url)`, `click(sel)`, `type`, `waitFor`,
      `extract(sel)`, `screenshot` (via CDP)
- [ ] **Change URLs from underneath**: `Fetch`/`Network` CDP domain to
      intercept/rewrite requests if needed (not just `goto`)
- [ ] Guardrails: domain allowlist per workspace/user
- [ ] User can **take over control** at any moment in Neko view

### Phase 4 — JS/DOM Debugging (Answers 2nd Question)
- [ ] Console: capture `Runtime.consoleAPICalled` + `Log.entryAdded` → forward
      errors/logs to agent
- [ ] DOM: `DOM.getDocument`, `DOM.querySelector`, observe mutations
- [ ] Evaluate JS in page: `Runtime.evaluate`
- [ ] Network: `Network.*` (requests/responses, statuses, timings)
- [ ] Breakpoints/step-by-step if necessary: `Debugger.*`
- [ ] **No extension required** — all of this is CDP; document that
      `chrome.debugger` (extension) brings nothing extra here

### Phase 5 — Orchestration & Scheduling
- [ ] Browser actions triggerable as **maestro-v1** tasks (cron/at/event)
- [ ] Structured end report (`RUN-REPORT.md` of maestro-v1): what the agent
      did/saw on the page
- [ ] Parallelism: multiple Neko containers/profiles if needed

### Phase 6 (Optional) — Extension Fallback §4
- [ ] Decide if a real use case demands it (otherwise **do not build**)
- [ ] Minimal MV3 extension + native messaging/WS to KovZu
- [ ] Commands via `chrome.debugger` (same CDP vocabulary as Phase 3/4)
- [ ] Same secret rules (nothing plaintext on LLM side)

---

## 7. Security Checklist (Blocking)

- [ ] CDP port (`9222`) **never** exposed outside container (loopback only)
- [ ] Sessions/cookies/profile **encrypted at rest** (via vault-v1)
- [ ] **Domain allowlist** per workspace: an agent does not drive any arbitrary site
- [ ] Consent/visibility: user **sees** agent act (Neko view) and
      can take over / kill
- [ ] No secrets (password, cookie, token) in logs or LLM context (names only)
- [ ] Log agent browser actions (audit — reuse maestro/vault)
- [ ] Do not drive a third-party site **without clear mandate** from user (acting
      "on their behalf" = strong responsibility)

---

## 8. Recommended Order

1. **Phase 0** — decide: CDP by default, extension = fallback, KovZu app = API
2. **Phase 1** — persistent profile + CDP on Neko's Chrome (the real unlock)
3. **Phase 2** — login-once + session protection (depends on vault-v1)
4. **Phase 3 & 4** — drive + debug (same CDP channel, done together)
5. **Phase 5** — connect to maestro-v1 (scheduled/parallel)
6. **Phase 6** — extension **only** if a real §4 case emerges

---

## 9. TL;DR for Fast Decisions

- App made with KovZu → **API/DB**, no browser.
- Third-party authenticated site → **Persistent server Chrome controlled via CDP**, viewed via Neko.
- Debug JS/DOM → **CDP** (extension adds nothing extra, brings less).
- Extension → **only** if action must stay inside user's own browser/device/
  identity (§4).
- In all cases: sessions **encrypted (vault-v1)**, actions **audited**,
  domains **allowlisted**, user **witness and master** of takeover control.

Nothing is coded: plan and checklists only. To validate (especially Phase 0).
