# Helm Voice — machine names on microphone

> Solved problem: STT phoneticizes infra names ("k0" heard as "cas0", "gbs-h1" butchered).
> Three defense lines + spelling. Tests: `server/lib/voiceNormalize.test.js`.

## 1. Boosted lexicon at STT

`server/lib/voiceLexicon.js` builds the lexicon automatically — **nothing is hardcoded**:
each customer deployment discovers ITS machines at runtime.

SSH sources, by priority:
1. `VOICE_SSH_CONFIG` (env, paths separated by `:`) — explicit override per deployment
2. `/apps/{mon-app}/.ssh/config` — home of the app user (derived from code path,
   turbinobash convention); `Include` directives are followed (1 level)
3. `~/.ssh/config` of the user running the API

Plus: CLI nodes (config) and canonical names from `voice_aliases` table.
Sent as Deepgram `keyterm` on every microphone opening (cache 30s, max ~95 terms,
priority: CLI nodes → alias canonicals → SSH hosts).

## 2. Post-STT corrector

`server/lib/voiceNormalize.js` — applied before display/ack/send (`POST /api/voice/normalize`,
called by `useChatVoice.runVoiceTurn`):

| Heard | Corrected | Mechanism |
|-------|-----------|-----------|
| « cas zéro » | gbs-k0 | alias (`voice_aliases` table) |
| « casse zéro » | gbs-k0 | phonetic fuzzy alias |
| « GBS H 1 » | gbs-h1 | exact fallback vs lexicon |
| « gbs-p 2 » | gbs-p2 | fuzzy (windows with digit/dash only) |
| « golf bravo sierra tiret papa sept » | gbs-p7 | auto NATO (≥2 NATO words, without marker) |
| « épelle gé bé esse tiret ache un » | gbs-h1 | marker `épelle`/`spell`/`deletrea` + letter names |

Deterministic (no LLM, <1 ms). Normal words are never touched
(fuzzy requires digit or dash in the window).

## 3. Voice echo of resolved names

When names have been corrected, Groq acknowledgment is replaced by a deterministic echo:
"**Bien reçu — gbs-p7 et gbs-k0. Je m'en occupe.**" — the driver hears
the interpretation before execution and can say stop. (`buildEntityAck`, `groqAck.js`.)

## Aliases — /admin/voice-aliases

MariaDB CRUD (`voice_aliases`): spoken form → canonical. When the microphone misunderstands
a name, add the alias once and it is permanently solved.
API: `GET/POST /api/voice/aliases`, `DELETE /api/voice/aliases/:id`.
