# Feature — UI Console

## Main Layout

`src/pages/Dashboard.jsx`

```
┌─────────────────────────────────────────┐
│ Header: session title · ? · ⋮           │
├──────────┬──────────────────────────────┤
│ Sidebar  │ Message scroll area          │
│ sessions │ (RunTimeline)                │
│ stepper  │ [↓ Go to bottom] if detached │
├──────────┴──────────────────────────────┤
│ Sticky ChatInput (composer)             │
└─────────────────────────────────────────┘
```

## Auto-scroll (stick-to-bottom)

Expected behavior:

| User Action | Effect |
|-------------|--------|
| At bottom, stream active | Scroll follows new tokens |
| Scroll upwards | **Detachment** — free reading |
| Return to bottom (scroll or button) | **Re-attachment** — tracking resumes |
| Send message | Forces re-attachment |

### Implementation

| Ref / state | Role |
|-------------|------|
| `stickBottomRef` | authorizes auto snap |
| `atBottom` | "Go to bottom" button UI |
| `lastScrollTopRef` | detects upward scroll |
| `NEAR_BOTTOM_PX = 80` | "at bottom" threshold |

`onChatScroll` on scroll container (`bindScrollRef`).

Effect `[timeline, streaming, atBottom]`: 48ms interval during stream if attached.

**File:** `Dashboard.jsx` (~l.130–200, ~1000–1030, ~1440)

## Help Button "?"

- Component: `ConsoleHelpButton` + `ConsoleHelpOverlay`
- 11-step tour (FR/EN/ES)
- **Pulse** after presentation finished: `helpNudge` + `getCompletedPrimeRun`
- Zephir invokes the **question mark** (not the bare symbol alone)

## Reborn (menu ⋮)

- Replaces old "Clear conversation"
- Confirmation modal with `RotateCcw` icon
- i18n: `clear.title`, `clear.confirm`, etc.

## Menu Options (⋮)

- Area filters (thinking, tools, terminal, logs)
- Karaoke ON/OFF (if Cartesia)
- Copy / Stop / Reborn / Reload

`src/components/HeaderActionsMenu.jsx`

## Ongoing Presentation

- `presentationBlocking`: input placeholder "Presentation in progress…"
- Hint: "Briefing in progress — you can already type"
- Auto timeout: 30s Cursor / 90s Claude if prime blocked

## Pull-to-refresh (mobile)

`usePullToRefresh` on message scroll → `reloadPage` / soft timeline reload.

## UI Language

Flag selector in header → `LocaleContext` → aligned CLI prompts + voice + prime.

## Mobile

- Sidebar overlay `h-dvh`
- Wake lock during active usage
- Composer safe area

## UI Code Paths

| Component | File |
|-----------|------|
| Timeline | `RunTimeline.jsx` |
| Input | `ChatInput.jsx` |
| Stepper | `ConversationStepper.jsx` |
| Session list | `ConversationListItem.jsx` |
| Help | `ConsoleHelpOverlay.jsx` |
| Active model | `ActiveModelLabel.jsx` |
