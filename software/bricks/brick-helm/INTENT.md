# Intent: @shaper/brick-helm (Helm v2 Web Chat Interface)

## Role
Containerized modern Web Chat & Console interface (React 19 + Express 5) allowing operators and users to interact in real time with sovereign AI agents (OpenCode / AGY) via WebSocket / SSE and Deepgram Voice STT/TTS.

## Invariants
1. **Bridge contract**: Helm v2 dispatches chat prompts to `CLI_BRIDGE_URL` (default: `http://127.0.0.1:4440/api/inject`) and receives streaming tokens via SSE (`/api/events`).
2. **Voice STT/TTS**: Deepgram WebSocket proxy configured with `DEEPGRAM_API_KEY` for live speech-to-text transcription and natural speech synthesis (`ttsFormat.js` with fine word-by-word karaoke).
3. **Primary Admin Account Onboarding Protocol**: Upon completing universe/stack bootstrap, the deploying agent MUST explicitly prompt the human operator for their desired primary Admin credentials (Email, First Name / Display Name, and Password). The agent creates this administrative account in MariaDB (`role: 'admin'`), links their personal workspace (`/data/opencode-ws/<User>`), and seeds the universal `CONTEXT.md`.
4. **Clean Sovereign Users (Zero Legacy Demo Accounts)**: Third-party demo accounts (e.g. `ivonne`, legacy demo guests) are strictly forbidden from default production/development databases and registries.
5. **Public Exposure**: Edge routing via Cloudflare Tunnel (`cloudflared`) on port `8650`.
6. **Resilience**: Operates with MariaDB auth, audit logging, and sovereign session persistence.
7. **Free OpenCode Models Catalogue & Groq Boundary**: The model selector displays only confirmed active free models from OpenCode (`opencode/*`) and direct provider keys (`deepseek/*`). Groq models (`groq/*`) must never be exposed as general agent LLMs in Helm and are strictly dedicated to background acknowledgment synthesis.
8. **Session Prime Isolation**: The session prime prompt (`buildSessionPrimeMessage`) must NEVER inject `CURSOR_OUTPUT_FORMAT`, `buildSkillsCatalog`, or `buildControlScopeContext`. These directives activate on the first real user message via `applyCursorLanguage()`. The prime produces only natural plain-text greeting — no tables, no bullets, no markdown formatting. Free models (Nemotron, etc.) interpret format directives literally and will format the greeting as a GFM table if these are present.

9. **Four interaction surfaces, one console**: the same cockpit is reached in four postures, and the posture changes what the interface is allowed to demand of the operator's attention.

| Surface | Where | What it assumes | Consequence |
| :--- | :--- | :--- | :--- |
| **Console** | Desktop | Eyes and hands available | Full layout; the mobile interaction mode is ignored entirely |
| **`view`** | Mobile, default | Eyes available, one hand | Reading and light interaction |
| **`remote`** | Mobile, spoken | Eyes elsewhere, speech available | The chat visual is hidden: the operator talks, the system answers aloud |
| **`route`** | Driving | **Eyes on the road** | Voice is armed on entry; the chat visual is hidden; controls are large and few, so that no precise tap is ever required |

   **Safety is the intent of `route`, not a styling choice.** A control that
   requires reading or aiming is forbidden there. This is why the spoken
   commands exist rather than being a convenience: `go` sends, `clear` erases,
   and both accept phonetic variants and their French equivalents, because a
   command the transcriber mishears is a command the driver has to look down to
   repeat.

   Both screen-free surfaces depend on Rule 0K: a session that ends silently
   strands an operator who cannot see the screen. Silence is an outage there,
   not a cosmetic defect.

10. **The image optimises; the universe decides the posture**: the image sets `NODE_ENV=production` because that is a **build** concern — React and Express run their fast paths. It carries no information about whether this deployment is a laptop or a business, and must never be read as such. The **security posture** comes from the universe's declared `environment` and travels as `SHAPER_RUNTIME_MODE`. In `development` the cockpit starts with development defaults; in `production` a missing secret is a halt, never a fallback, because a secret published in a repository is not a secret. Conflating the two once cost a clean-sheet deployment: a DEV universe inherited `production` from the image and refused to start over a password it had no reason to need.

---

## Cognition

> Scales and semantics: [`docs/architecture/COGNITION.md`](../../../docs/architecture/COGNITION.md) · Extends Rule 21.

- **capacity-class**: fast-eval
- **role**: requires
- **depth**: D1
- **throughput**: T1
- **degraded**: allowed-with-note
- **rationale**: Operator cockpit. Conversation latency is user-visible, hence T1. Voice acknowledgment is a separate T0 dispatch and is never served by the general chat engine (Rule 0H).
