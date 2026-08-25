# Feature — Voice, Karaoke & Presentation

**gbsinfo Production (gbs-tools)**: https://<PUBLIC_HOST> — `TTS_PROVIDER=deepgram` (Cartesia quota 402).

## In-chat Voice Architecture

```
Microphone (Deepgram Nova live WS STT /api/voice/stt-stream)
    → ChatInput draft
    → trigger word ("go" / "clear")
    → Groq ack (bubble + audio HTTP POST /v1/speak)
    → inject Composer (agy / Antigravity)
    → SSE stream response (text first)
    → TTS WS /api/voice/tts-stream → Aura PCM (full sentence at turn completion)
    → karaoke: current sentence (Deepgram) or word-by-word (Cartesia)
```

Central hook: `src/hooks/useChatVoice.js`  
Connected in: `src/pages/Dashboard.jsx`

The chat **does not send** TTS token by token: a single `Speak` + `Flush` at `response_complete`, to avoid double audio. The Deepgram protocol is indeed PCM streaming (~2 KB chunks).

## Speaker & Karaoke Toggle

| localStorage Pref | Key |
|-------------------|-----|
| Auto playback | `helm-voice-playback` (default ON) |
| Karaoke | `helm-voice-karaoke` (default ON) |

Karaoke **supported** as soon as a TTS is configured (`cartesia` or `deepgram`).  
Menu ⋮ → Karaoke ON/OFF.

## Cartesia vs Deepgram (August 18, 2026)

| | Cartesia Sonic WS | Deepgram Aura WS |
|--|-------------------|------------------|
| Chat TTS | `wss://…/api/voice/tts-stream` | same |
| Audio | PCM 24 kHz | PCM 24 kHz (`linear16`) |
| API Timestamps | `word_timestamps` | **none** (Flush / `sequence_id` only) |
| Karaoke | word-by-word (`grain: word`) | **current sentence** (`grain: sentence`) |
| Playback clock | PCM `getPlaybackSeconds()` | same + PCM duration `getDurationSeconds()` |
| Admin Tester | HTTP `POST /api/voice/tts` | HTTP (not chat WS) |

Deepgram does not say "we are on this word". We split spoken text into sentences (`splitKaraokeSentences`), spread them across the PCM clock, and highlight the **entire sentence** whose `[start, end]` contains the cursor. When the audio stream completes, windows are reframed to actual duration (`rescaleKaraokeUnits`).

We **do not flush** a Deepgram sentence at every period (limit 20 Flush / 60s, choppy voice).

Files:

| File | Role |
|------|------|
| `src/lib/karaokeTiming.js` | sentences, durations, indices |
| `src/lib/pcmStreamPlayer.js` | clock + PCM duration |
| `src/lib/voiceTtsStream.js` | browser WS proxy |
| `server/lib/deepgramTtsWs.js` | Speak / Flush Aura |
| `src/components/MarkdownContent.jsx` | `grain: sentence` highlighting |

Tests: `src/lib/karaokeTiming.test.js`

Chat env: `TTS_PROVIDER=deepgram` (+ `app_settings.tts_provider` setting).

## Presentation (Prime Run)

### Lifecycle

1. `shouldPrimeSession(timeline)` → true if empty or failed prime without assistant
2. `POST /api/session/prime` or orchestrated clear
3. Run timeline `{ type: 'run', prime: true, status: 'running' }`
4. Inject message `[session prime]` → Zephir response
5. `response_complete` → run `status: 'done'`
6. **Auto**: `replaySpeech(assistantText)` + help button pulse

### Files

| File | Role |
|------|------|
| `server/lib/sessionPrime.js` | Briefing prompt + question mark guideline |
| `src/hooks/useSessionPresentation.js` | clearSession, primeSession |
| `src/lib/sessionPresentation.js` | prime helpers |
| `Dashboard.jsx` | auto-replay effect + helpNudge |

### Reborn

`clearSession` = wipe + prime. Presentation **must** restart autonomously (voice + karaoke).

### prepareForPresentation()

Resets Composer pipeline without killing everything (called at prime start).

### inject SSE During Prime

`handleVoiceEvent`: on `inject`, `stopComposerPlayback()` only (not full pipeline kill).

During active prime: **ignore** live SSE TTS → single playback via replay at the end.

## Double Voice Bug (Historical)

Symptom: two overlapping voices, especially Cartesia karaoke on asus/NOW3.

| Fix | Where |
|-----|-------|
| `undoubleText` / `undoubleSpeechText` | `runStream.js`, `voiceCursorLoop.js` |
| Ignore `response` interim if Cartesia | `useChatVoice.js` `handleVoiceEvent` |
| Ignore `run_complete` to speak | `feedStreamSpeech` lifecycleOnly |
| Single `end(utterance)` Cartesia | `enqueueSpeechChunksStream` |
| `spokenGuardRef` 8s | `feedStreamSpeech` final |
| `composerFinalized` synchronous before enqueue | same |

Tests: `runStream.test.js`, `voiceCursorLoop.test.js`

## Karaoke vs Displayed Markdown

**Rule:** never replace markdown deliverable with karaoke. TTS reads a separate track (`speechTextFromAssistant`); bubble remains tables / charts / links.

Highlighting is **inside** `StreamingMarkdown` (`proseWithKaraoke`):

- Cartesia: one word (`activeIndex`)
- Deepgram: range `wordStart`–`wordEnd` of the active sentence

TTS: `speechTextFromAssistant` + tables-to-prose conversion (`voiceCursorLoop.js`).

## Manual Replay

▶ button on each assistant bubble → `replaySpeech(text, { id })`.

Pause/resume/stop: `togglePause`, `stopPlayback`.

## Wake Lock

During playback / microphone / presentation: screen stays awake (`useWakeLock.js`).

## Voice Admin

`/admin/voices` — see `voiceSelectionState()`:

- `saved`: MariaDB DB
- `active`: what chat uses
- `mismatch`: Cartesia IDs still in DB while chat uses Deepgram (`aura-2-agathe-fr` etc.)
- Karaoke: `yes (sentences)` if Deepgram, `yes (Cartesia)` if Sonic
- Cartesia / Deepgram catalog tabs + **Use … for chat** button

## Quick Manual Test

1. Hard refresh https://<PUBLIC_HOST> — Karaoke ON (⋮)
2. Send a message (or Reborn for presentation)
3. Wait for the **end** of Composer text, then Deepgram voice
4. The **sentence** being read is highlighted in the bubble (not a jumping word)
5. Single voice, no duplicates

## Presentation Manual Test

1. Empty session or Reborn
2. Wait for presentation text
3. Voice + karaoke start **without** clicking ▶
4. Zephir mentions "question mark"
5. ? button pulses after presentation
6. Subsequent response in voice mode: **single** voice, no duplicates
