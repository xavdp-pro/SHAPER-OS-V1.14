# Universe Profiles & Human Archetypes — Naming What to Build

> **Why this page exists.** Two agents were asked, in the same words, to build
> "the base universe". One built five containers, the other six. Neither was
> wrong: the phrase had no definition. This page gives the starting points names —
> whether you speak in **business archetypes** (human mode) or in **modular Lego
> formulas** (agent mode) — so that a single phrase in a prompt settles what gets
> built, and everything after that phrase is yours to shape.

A profile is a **floor, not a cage.** It says where to start. What you add on top
is the work.

---

## 🧭 The 3 Ways to Prompt a Universe

You can prompt a universe in whichever way feels natural to you:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 1. BY HUMAN ARCHETYPE (1 Word / Business Preset)                                       │
│    "Build me a store universe..."  OR  "Build me a document-hub universe..."           │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 2. BY MODULAR LEGO FORMULA (Floor + Options)                                           │
│    "Build me an agent +documents +public universe..."                                  │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 3. BY HYBRID COMBINATION (Archetype + Modular Extensions)                              │
│    "Build me a store +voice +waf universe..."                                          │
│    "Build me a document-hub +intake +waf universe..."                                  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🏛️ 1. Human Archetypes (Business Presets)

Direct business names you can use in your prompts. The AI agent resolves the
archetype into its canonical base formula and required bricks:

| Human Archetype | Manifest Alias | Canonical Formula | Bricks Deployed | What It Does for the Business |
| :--- | :--- | :--- | :--- | :--- |
| **E-Commerce Store** | `store` | `passive +data +public` | `logger`, `wordpress`, `mariadb`, `vitals`, `tunnel` | Online transactional store with database, health probes, and payment readiness |
| **Document & AI Hub** | `document-hub` | `agent +documents +public` | `vault`, `logger`, `bridge`, `queue`, `maestro`, `ged`, `qdrant`, `rag`, `tunnel` | Sovereign document management, OCR, 384d vector search & multimodal AI |
| **Fleet Manager (Parent)** | `fleet-manager` | `agent +parent +public` | `vault`, `logger`, `bridge`, `queue`, `maestro`, `supervisor`, `manager-gateway`, `tunnel` | Supervisor cockpit repairing ($K+1$) and provisioning child universes |
| **Field Service & Quotes** | `field-service` | `agent +documents +voice` | `vault`, `logger`, `bridge`, `queue`, `maestro`, `ged`, `rag`, `voice` | Turns voice notes & job site photos into structured quotes & PDF reports |
| **Accounting & Reconciliation** | `accounting-vault` | `agent +documents +data` | `vault`, `logger`, `bridge`, `queue`, `maestro`, `ged`, `rag`, `mariadb` | Ingests supplier invoices & bank statements, reconciles lines & exports journals |
| **Omnichannel Helpdesk** | `helpdesk` | `agent +intake +documents` | `vault`, `logger`, `bridge`, `queue`, `maestro`, `mail-agent`, `ged`, `rag` | Automatic email/chat triage, vector knowledge lookup & ticket escalation |
| **Booking Engine** | `booking-engine` | `passive +data +public` | `logger`, `mariadb`, `calendar-sync`, `tunnel` | Online appointment booking with CalDAV/ICS sync and SMS/email alerts |
| **Online Academy / LMS** | `academy` | `passive +data +public` | `logger`, `mariadb`, `auth`, `tunnel` | Member portal for video courses and PDF deliverables (0% platform fee) |
| **Watchdog & Scraping** | `watchdog` | `agent +clock` | `vault`, `logger`, `bridge`, `queue`, `maestro` | Autonomous cron tasks, supplier API sync, competitor scraping & alerts |
| **Public Brochure** | `brochure` | `passive +public` | `logger`, `nginx/static`, `tunnel` | Ultra-fast, lightweight public presence with zero attack surface |

---

## 🧱 2. The Two Canonical Floors

### `passive` — it runs, and it can be proven

```
logger                                    :8620
```

Plus whatever service it watches (a website, a store, a database). The `logger`
is the one brick that never leaves, because the currency of SHAPER OS is proof —
a universe that cannot show what happened is outside the doctrine.

**Nothing reasons here.** No agent, no queue, no clock.

### `agent` — it reasons, works in the background, and starts on its own

```
vault    :8610      the secrets
logger   :8620      the memory and the proof
bridge   :4440      the AI agent
queue    :8640      asynchronous work, and the answer persisted
maestro  :8630      autonomous heartbeat / scheduled beats
```

Boot order: `vault ∥ logger → bridge → queue → maestro`.

**This is the default.** When nobody names a profile, this is what gets built.
It is what `manifest.tier-a.json` has always declared; `tier-a` stays as an alias.

---

## 🧩 3. Modular Options & Extensions

Options attach to either floor or any archetype:

| Option (Lego) | Human Alias | Adds | What It Buys |
| :--- | :--- | :--- | :--- |
| **`+waf`** | `+security` | `@shaper/waf-engine` *(TARGET)* | **Adaptive Sovereign Firewall & positive cache (shaped live)** |
| **`+billing`** | `+payment` | `brick-billing` *(TARGET)* | Stripe webhooks, subscriptions, customer billing & auto-invoicing |
| **`+voice`** | `+audio` | `brick-voice` *(TARGET)* | Whisper voice transcription (STT) & vocal response synthesis (TTS) |
| **`+messaging`** | `+whatsapp` | `brick-messaging` *(TARGET)* | WhatsApp Pro / Telegram / Signal client photo & chat intake |
| **`+calendar`** | `+agenda` | `brick-caldav` *(TARGET)* | CalDAV / ICS booking availability & 2-way agenda sync |
| **`+pdf-toolkit`** | `+pdf` | `brick-pdf` *(TARGET)* | Multi-page PDF splitting, barcode tagging, and digital signature |
| **`+documents`** | `+dms` | `ged`, `qdrant`, `@shaper/rag` | Full document ingestion, OCR, and 384d semantic vector search |
| **`+data`** | `+db` | `mariadb` | Relational database state that outlives the execution run |
| **`+web`** | `+cockpit` | `helm`, `auth` | Operator `/console` cockpit and authenticated browser interface |
| **`+public`** | `+online` | `tunnel` (Cloudflare Zero Trust) | Public HTTPS routing with **zero open inbound ports** |
| **`+intake`** | `+mail` | `@shaper/mail-agent` | Automatic inbound IMAP mail listening & background job intake |
| **`+parent`** | `+supervisor` | `@shaper/supervisor`, SSH authority | Supervisor role: grades child vitals (R23) and performs repairs |
| **`+clock`** | `+cron` | `maestro` | Heartbeat scheduler (for `passive` floor only; `agent` already has it) |

---

## 🛡️ Special Focus: The Adaptive Sovereign WAF (`+waf`)

> **Doctrine Reminder (Rule 28 & Sovereign Web Chain)**:  
> *A WAF cannot be an arbitrary static black-box. It must be structurally prepared with a generic base, and then **shaped in live execution according to the specific application it protects**.*

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                     THE 2-PHASE ADAPTIVE SOVEREIGN WAF ARCHITECTURE                    │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ PHASE 1 : GENERIC STRUCTURAL BASE (Pre-boot)                                           │
│ • Zero Trust Cloudflare Ingress (0 open inbound ports on the host).                    │
│ • Deterministic low-level filters (< 0.2 ms): Anti-SQLi, Anti-XSS, Path-Traversal.    │
│ • IP sliding-window rate limiting & brute-force shield.                                │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ PHASE 2 : LIVE APPLICATION SHAPING (Post-boot / Positive Security)                     │
│ • Once the application runs (WordPress, GED, CRM...), the Parent Agent inspects the   │
│   active routes and compiles an **exact positive whitelist** (`GET /api/search`...).  │
│ • Precomputed SSR cache for read-only pages (served in 0.3 ms without waking Node.js). │
│ • Any request outside the positive application shape is dropped at layer 3 in 0.1 ms. │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

Adding **`+waf`** to any universe activates this adaptive guardian.

---

## 💬 4. Real-World Prompt Examples Across Lifecycles

Here is how humans and AI agents formulate instructions in plain English across the 3 lifecycle stages (`DEV`, `TEST`, `PROD`):

### Example 1 — E-Commerce Store with Adaptive WAF (DEV)
> *"Build me a **`store +waf`** universe called `univ-shoes-dev`, DEV lifecycle. It runs a WooCommerce shop with an adaptive firewall and precomputed product cache for catalog pages."*

### Example 2 — Field Service Quotes with Voice & WhatsApp (DEV)
> *"Build me a **`field-service +messaging +billing`** universe called `univ-renov-dev`, DEV lifecycle. Artisans send photos and audio notes via WhatsApp; the agent produces signed quotes and collects Stripe deposit payments."*

### Example 3 — Accounting Hub with Auto-Mail Ingestion (DEV → TEST)
> *"Build me an **`accounting-vault +intake +waf`** universe called `univ-accounting-test`, TEST lifecycle. Invoices arriving at `invoices@company.com` are automatically parsed, OCR-verified, reconciled against bank records, and filed into the GED. Rebuild from scratch, validate the full test suite, then destroy."*

### Example 4 — Booking Engine for Healthcare / Consultants (DEV)
> *"Build me a **`booking-engine +messaging`** universe called `univ-clinic-dev`, DEV lifecycle. Patients book slots online, syncing with Apple/Google Calendar and receiving appointment reminders on WhatsApp."*

### Example 5 — Private Video Academy (PROD)
> *"Deploy the validated tag `v1.2.0` on the **`academy +billing +waf`** universe called `univ-courses-prod`, PROD lifecycle, under domain `academy.company.com`. Private member portal selling video masterclasses with Stripe subscriptions and zero third-party platform fees."*

### Example 6 — Multi-Tenant Fleet Manager (PROD)
> *"Deploy a **`fleet-manager +waf`** universe called `univ-manager-prod`, PROD lifecycle, on port `9470`. It will supervise and repair 50 child store universes across our bare-metal fleet via asymmetric SSH authority."*

---

## 📋 5. Declared and Machine-Checked

The profile is declared in the universe manifest:

```json
{
  "universe": "univ-shoes-dev",
  "environment": "dev",
  "profile": "store +waf"
}
```

The test suite (`software/packages/queue/test/universe-profile.test.js`) automatically resolves human archetypes and verifies that all required base bricks are present before any deployment is permitted.

---

## 🚫 What No Profile Contains

Its own repair authority. A universe emits its raw vitals; a level above ($K+1$)
grades them and repairs it (Rule 23), or a human operator does (Rule 24).
`+parent` makes a universe the supervisor of **others** — never the one who
modifies itself in flight.
