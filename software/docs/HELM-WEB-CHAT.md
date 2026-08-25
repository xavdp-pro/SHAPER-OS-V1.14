# SHAPER-OS — Helm v2 Web Chat & Voice Integration

> **Perimeter**: Helm KovZu = **P2**. Operator voice (STT/TTS) lives **inside `/console`**.  
> Routes `/talk` and `/voice` **redirect to `/console`**. See [`PERIMETERS.md`](./PERIMETERS.md).

## Architecture

Helm v2 provides an enterprise-grade web conversation interface for SHAPER-OS universes.

```
                    Internet (https://ia.example.com)
                           │
                           ▼ (Port 8650)
                      [cloudflared]
                           │
                           ▼ (Port 8650)
                 +-------------------+
                 |    brick-helm     |
                 | (Express + React) |
                 +-------------------+
                   │               │
                   ▼ (Port 4440)   ▼ (Deepgram API)
             [cli-bridge]      [Deepgram Proxy]
             (OpenCode AI)     (Voice STT / TTS)
```

## Features
- **Console cockpit (`/console`)**: Primary operator UI — chat, GED, voice STT/TTS integrated (P2).
- **Streaming Markdown & Rich Content**: Real-time token streaming with syntax highlighting, mermaid diagrams, and artifact cards.
- **Containerized Modern UI**: React 19 single-page chat with dark mode, autoscrolling, markdown rendering, tool trace display, and audio visualizer.
- **Unified Voice Pipeline**: Direct streaming STT/TTS via Deepgram WebSocket proxies (`/api/voice/listen` and `/api/voice/speak`) with synchronized word-by-word karaoke highlighting (`ttsFormat.js`).
- **Multi-tenant / Multi-conversation**: Isolated conversation workspaces mapped to bridge sessions.
- **Edge Deployment**: Directly exposed through Cloudflare Tunnel on `ia.example.com`.
