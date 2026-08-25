# Canvas / Right Panel — Vibe-code Preview (helm-v2)

Right panel **desktop only** (hidden on mobile), displayable via the `PanelRight` button
in the header. Tabs: **Preview**, **Debug**, **Browser**.

## Preview Tab (operational)

- **Turbinobash project** selector (`server/lib/vibeProjects.js` registry).
- **Same-origin** `<iframe>` on `/api/preview/<id>/` — internal reverse-proxy
  (`server/routes/preview.js` + HMR WS `server/lib/previewWsBridge.js`) to the
  project local dev server. **No Cloudflare required**, the URL remains ${SHAPER_PUBLIC_HOST}.
- Green/gray dot = dev server up/down (`/api/vibe/projects/:id/status`).
- **"tb Workspace"** button: asks the agent to run `tb app sudo/way/noweb/create <id>`
  and prepare a skeleton (see flow below).

### ⚠️ Vite Base Mandatory for Preview

A Vite dev server served under a subpath must run with **`base` = preview prefix**,
otherwise the module graph / HMR (root-absolute paths `/@vite`, `/src`, `/assets`)
will not resolve. Start the project dev as follows:

```bash
cd /apps/<id>/app
vite --port <port> --base=/api/preview/<id>/
```

The proxy rewrites `src="/…"` / `href="/…"` in HTML on a best-effort basis, which is enough
for a simple static build, but **the reliable mode (dev + HMR) = correct base**.

## Projects Registry (`vibeProjects.js`)

Default: `crmdemo-v1` (7597), `crmxavdp-v1` (7607). Override:
`VIBE_PROJECTS="id|Label|port,id2|Label2|port2"` (deduced path `/apps/<id>/app`).

## Turbinobash Flow (summary of documentation)

- Create workspace: `tb app sudo/way/noweb/create <id>` → user/DB//apps/<id>/.
- Dev: Vite on local port (base = preview prefix).
- **Prod**: `tb app sudo/way/proxy/create <id> http://127.0.0.1:<port> --certbot`
  (subdomain + Let's Encrypt SSL) — or Cloudflare tunnel ingress for a
  subdomain of configured domain(s) (requires Cloudflare API token,
  distinct from the tunnel token already running as a service).

## Debug / Browser Tabs — Container POC (docker)

Browser container manager (`server/lib/browserContainers.js`,
routes `server/routes/browser.js`, **admin only**):
- `GET /api/browser/containers` — list (our `kovzu.browser=1` containers +
  recognized external ones like `xavdp-navigator`).
- `POST /api/browser/neko` — launches a Neko (`ghcr.io/m1k1o/neko/chromium`) on a
  free local port (9450-9490).
- `POST /api/browser/:name/stop`, `DELETE /api/browser/:name`.
- Same-origin proxy `/api/browser/proxy/:name/` → container port (tab iframe,
  X-Frame-Options removed).

The **Debug** and **Browser** tabs share this manager (container selector
+ "Neko" button + iframe). Verified: the list includes `xavdp-navigator`
(in-house browser, port 9420, API protected by its own auth → expected 401 in
the iframe as long as we do not relay its token).

Container CLI: `docker` on gbs-h1 (no podman here) — `CONTAINER_CLI` override.

### "I need more infra" (Xavier) — to complete later
- **Neko via Cloudflare tunnel**: WebRTC UDP does not cross the TCP tunnel → enable
  ICE-lite + **TCP-mux** (`NEKO_TCPMUX`) and publish this port, or desktop on LAN.
- **Debug = Playwright/CDP screencast** (lighter, no sound, integrated into the agent) —
  connect to vision0/gbs-p2 where Playwright already runs.
- **Relay auth** for `xavdp-navigator` (token) to display its view.
- **Demo** version: podman management + launch/display — later (POC here).

## Right Panel on MOBILE (done — 2026-07-23)

Desktop (`≥ lg`): right column unchanged, 3 tabs (Preview/Debug/Browser).

Mobile/tablet (`< lg`): **fullscreen overlay**, toggled by the same
"Project Panel" button (now visible at all sizes, no longer `hidden lg:…`),
showing **only Preview** (turbinobash project selector + proxy iframe
`/api/preview/<id>`) — **without tab bar**. Debug and Browser (VNC/Neko)
are **never mounted** on mobile: the decision is made in JS
(`useIsDesktopPanel`, threshold `min-width: 1024px` = same threshold as desktop column),
not just hidden via CSS — so no video stream / container call is
triggered on mobile, even in the background.

Verified in browser in mobile viewport (390×844): button visible, "Preview"
overlay without "Debug"/"Browser" in the DOM, selector + "New application workspace"
button present.

## Styled Pickers + "Application Workspace" (2026-07-23)

Native HTML `<select>` (vibe-code project, browser container) are
replaced with `PickerMenu` (same component as the rest of the app — no
system visual jargon). The "+ tb Workspace" button becomes a simple **`+`** to
the left of the project selector, opening an **explanatory popover** (without the word "tb"):
*"An application workspace is an isolated and dedicated working folder (its own code, its own database) — the place where the agent builds a tool for you"*, with the creation input field below.

⚠️ **Not verified via build/e2e**: execution environment tightened its
restrictions during session (esbuild/vite/playwright return `EACCES`/
`Permission denied` even via `node <script>`). Changes reviewed manually in
detail (imports, `PickerMenu` props, `disabled` option per row) but **to be
validated with an actual build** (`npm run build` + reload) before full confidence.

## Karaoke vs Rich Rendering (fixed 2026-07-23)

Bug: when karaoke played, it **replaced** all rich rendering (tables,
code, images, links) with highlighted plain text. Fixed in `RunTimeline.jsx`:
karaoke is now a **highlight strip above**, and `StreamingMarkdown`
remains **always displayed** below → formatting is no longer broken.
