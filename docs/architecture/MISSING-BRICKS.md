# Missing & Target Bricks Roadmap — The Extended Capability Catalog

> **Why this document exists.** SHAPER OS v1.8 ships with a robust, proven
> **runnable core** (vault, logger, agent-bridge, queue, maestro) and specialized
> live extensions (ged, qdrant, rag, supervisor, mariadb, helm). However, full
> real-world business autonomy requires a defined roadmap of **extended specialized
> bricks**.
> 
> This document specifies the missing bricks: their role, ports, perimeters,
> cognition requirements, and exact interfaces so that human architects understand
> what is coming and AI agents can materialize them deterministically without
> inventing contradictory designs.

---

## 🗺️ Extended Bricks Overview

```
                               ┌────────────────────────────────────────────────────────┐
                               │           SHAPER OS EXTENDED BRICK ECOSYSTEM           │
                               └────────────────────────────────────────────────────────┘

    ┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
    │ 🟢 LIVE IN CORE / REPO                                                                          │
    │   • brick-vault (:8610)        • brick-logger (:8620)           • brick-queue (:8640)           │
    │   • brick-maestro (:8630)      • brick-bridge-* (:4440)         • brick-helm (:8650)            │
    │   • brick-ged (:8760)          • brick-qdrant (:6333)           • @shaper/rag (in-process)      │
    │   • @shaper/supervisor (R23)   • brick-mariadb (:3306)          • @shaper/auth (in-process)     │
    └─────────────────────────────────────────────────────────────────────────────────────────────────┘
                                                       │
                                                       ▼
    ┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
    │ 🟡 TARGET BRICKS (SPECIFIED & IN IMPLEMENTATION ROADMAP)                                         │
    │   1. brick-waf (:8680)           — Adaptive Sovereign Firewall & Positive SSR Cache             │
    │   2. brick-billing (:8690)       — Stripe Webhooks, Quotas & Sovereign Auto-Invoicing           │
    │   3. brick-voice (:8670)         — Local Whisper STT & Low-Latency Voice Synthesis              │
    │   4. brick-messaging (:8665)     — WhatsApp Pro / Telegram / Signal Client Ingress              │
    │   5. brick-caldav (:8675)        — 2-Way CalDAV/ICS Calendar Sync & Online Slot Booking         │
    │   6. brick-pdf (:8685)           — Deterministic Multi-page PDF Splitting & eIDAS Signature     │
    │   7. brick-mail-intake (:8655)   — Continuous IMAP IDLE Listener & Attachment Queue Ingress     │
    │   8. brick-pipeline (:8695)      — 8-Stage Multi-Witness Document Understanding & Arbiter       │
    └─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🧱 1. `brick-waf` — Adaptive Sovereign Firewall & Positive Cache

* **Perimeter:** P1 / P2 Boundary (Ingress Security & Route Filtering).
* **Port:** `:8680` (or direct reverse-proxy socket).
* **Role:** Neutralizes malicious or parasitic traffic in $< 0.2$ ms without ever waking application runtimes (Node.js/PHP).
* **The 2-Phase Adaptive Lifecycle:**
  1. **Phase 1 (Generic Pre-boot Base):** Hardened filters (anti-SQLi, anti-XSS, anti-path traversal `../`, IP sliding-window rate limiter, Cloudflare zero-trust ingress).
  2. **Phase 2 (Live Application Profiling):** Once the target application runs (WordPress, GED, CRM), the Parent Agent compiles an **exact positive allow-list of routes and HTTP verbs** (`GET /api/search`, `POST /api/upload`). Any request outside this shape is dropped at Layer 3 with a `403 Forbidden` in $0.1$ ms.
  3. **SSR Positive Cache:** Serves immutable product sheets, brochures, and public catalog pages in $0.3$ ms.
* **Cognition:** `D0` (deterministic packet filtering) + `D2` (post-boot route compilation).
* **Status:** `TARGET` (Specified in `doctrine/SOVEREIGN-WEB-CHAIN-WAF-AND-CACHE.md` and Rule 28).

---

## 🧱 2. `brick-billing` — Sovereign Payment Gateway & Subscriptions

* **Perimeter:** P2 (Platform Billing) / P3 (Client E-Commerce & Services).
* **Port:** `:8690`.
* **Role:** Receives payment provider webhooks (Stripe, PayPal, Mollie) with cryptographic HMAC signature verification, manages recurring subscription states, tracks usage quotas, and triggers automated invoice PDF generation stored into `brick-ged`.
* **Why the Agent loves it:** Zero manual reconciliation. Webhooks land in `brick-queue` as immutable events; invoices are compiled and dispatched autonomously.
* **Cognition:** `D0` (webhook verification & balance arithmetic).
* **Status:** `TARGET`.

---

## 🧱 3. `brick-voice` — Local Whisper STT & Low-Latency Voice Synthesis

* **Perimeter:** P2 (Operator Cockpit Voice) / P3 (Field Worker Audio Notes).
* **Port:** `:8670`.
* **Role:** Speech-to-Text (STT) transcription via Whisper / Faster-Whisper + Text-to-Speech (TTS) via Piper / XTTS. Provides low-latency streaming acknowledgment for voice-first interactions ($< 500$ ms).
* **Why the Agent loves it:** Enables tradespeople, field service workers, and doctors to record verbal memos on job sites and have them transcribed into structured JSON records and formal PDF quotes.
* **Cognition:** `D1` (audio transcription) + `T0` (voice streaming throughput $\ge 500$ tok/s).
* **Status:** `TARGET`.

---

## 🧱 4. `brick-messaging` — Instant Messaging Bridge (WhatsApp / Telegram / Signal)

* **Perimeter:** P3 (Business Communication Ingress).
* **Port:** `:8665`.
* **Role:** Bidirectional connector for WhatsApp Business Cloud API, Telegram Bot API, and Signal-CLI. Receives client text messages, photos, audio notes, and PDF attachments, converting them into queued jobs in `brick-queue`. Dispatches outbound notifications, payment links, and quote approvals.
* **Why the Agent loves it:** Clients do not need to log into a complicated web portal — they interact with the universe directly through their daily messaging app.
* **Cognition:** `D1` (message normalization) + `T1` (conversational response).
* **Status:** `TARGET`.

---

## 🧱 5. `brick-caldav` — 2-Way Calendar Engine & Online Appointment Booking

* **Perimeter:** P3 (Business Scheduling).
* **Port:** `:8675`.
* **Role:** Lightweight CalDAV / ICS server and synchronization bridge. Interacts with Apple iCloud, Google Calendar, and Nextcloud. Calculates real-time booking availability slots and handles instant slot reservation without third-party subscriptions (e.g. Calendly / Doctolib).
* **Why the Agent loves it:** Eliminates scheduling conflicts deterministically using RFC 5545 calendar standards.
* **Cognition:** `D0` (slot availability arithmetic).
* **Status:** `TARGET`.

---

## 🧱 6. `brick-pdf` — Deterministic PDF Toolkit & Digital Signature

* **Perimeter:** P1 / P3 (Document Operations).
* **Port:** `:8685` (or fast CLI container).
* **Role:** Binary PDF manipulation:
  - **Batch Splitting:** Splits multi-page scans (e.g. 100-page monthly payroll batches) into individual employee PDFs based on barcode or QR code delimiters.
  - **Merging & Stamping:** Injects official company headers, paid watermarks, and cryptographic QR verification codes.
  - **eIDAS Digital Signature:** Generates and appends X.509 timestamped digital signatures for non-repudiation.
* **Why the Agent loves it:** Completely deterministic; runs without LLM hallucinations to guarantee byte-for-byte document integrity.
* **Cognition:** `D0` (deterministic binary manipulation).
* **Status:** `TARGET`.

---

## 🧱 7. `brick-mail-intake` — Dedicated IMAP IDLE Daemon

* **Perimeter:** P2 (Operator Inbox) / P3 (Invoice & Support Inbound).
* **Port:** `:8655`.
* **Role:** Standalone container maintaining continuous `IMAP IDLE` connections to business mailboxes (e.g. `invoices@company.com`, `support@company.com`). Extracts MIME parts, saves attachments to CAS storage in `brick-ged`, and injects tasks into `brick-queue`.
* **Cognition:** `D1` (MIME parsing & header normalization).
* **Status:** `PARTIAL` (`@shaper/mail-agent` exists in-process; needs standalone OCI container packaging).

---

## 🧱 8. `brick-pipeline` — 8-Stage Multi-Witness Document Pipeline

* **Perimeter:** P3 (Deep Document Understanding).
* **Port:** `:8695`.
* **Role:** Complete implementation of the sovereign 8-stage document intelligence pipeline:
  $$\text{Ingestion} \rightarrow \text{Triage} \rightarrow \text{Dual OCR + Vision} \rightarrow \text{Mechanical Arbitration} \rightarrow \text{Fact Extraction} \rightarrow \text{Normalization} \rightarrow \text{384d Vectorization} \rightarrow \text{CAS Storage}$$
* **Why the Agent loves it:** Dual-witness validation eliminates OCR hallucinations; conflicting readings are sent to the mechanical arbiter rather than trusted blindly.
* **Cognition:** `D1` (OCR) + `D2` (Fact extraction) + `D3` (Arbitration of conflicting witnesses).
* **Status:** `TARGET` (Doctrine fully specified in `doctrine/DOCUMENT-PIPELINE.md`).

---

## 📊 Summary Matrix: Target Bricks

| Brick | Default Port | Perimeter | Primary Engine / Tech | Cognition Class |
| :--- | :---: | :---: | :--- | :--- |
| **`brick-waf`** | `8680` | P1/P2 | Node.js + Nginx Socket | `D0` / `D2` (`infra-ops`) |
| **`brick-billing`** | `8690` | P2/P3 | Node.js + Stripe SDK | `D0` (`infra-ops`) |
| **`brick-voice`** | `8670` | P2/P3 | Faster-Whisper + Piper | `D1` / `T0` (`fast-eval`) |
| **`brick-messaging`** | `8665` | P3 | WhatsApp Cloud / Telegram API | `D1` / `T1` (`rapid-iteration-ui`) |
| **`brick-caldav`** | `8675` | P3 | CalDAV Server / ICAL.js | `D0` (`infra-ops`) |
| **`brick-pdf`** | `8685` | P1/P3 | PDFtk / MuPDF / QPDF | `D0` (`heavy-engineering`) |
| **`brick-mail-intake`**| `8655` | P2/P3 | Node.js IMAP-Flow | `D1` (`infra-ops`) |
| **`brick-pipeline`** | `8695` | P3 | Dual-OCR + Vision + Arbiter | `D3` (`heavy-engineering`) |

---

## 🛠️ Implementation Contract for AI Agents

When an AI agent is instructed to build one of these target bricks:
1. **Never fork core libraries:** Consume `@shaper/vault`, `@shaper/logger`, and `@shaper/queue` as standard dependencies.
2. **One Container, One Intent:** Package the brick as an autonomous OCI container under `software/bricks/<brick-name>/`.
3. **Declare Cognition:** Write required reasoning depth, throughput, and degradation policy in the brick's `INTENT.md` (see [`COGNITION.md`](./COGNITION.md)).
4. **Ship Non-Regression Tests:** Every brick must ship with 100% passing unit and contract tests before being referenced in any manifest.
