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

Direct business names you can use in your prompts. The agent resolves the
archetype into its canonical base formula and required bricks:

| Human Archetype (EN / FR) | Manifest Alias | Canonical Formula | Bricks Deployed | What It Does for the Business |
| :--- | :--- | :--- | :--- | :--- |
| **E-Commerce Store**<br>*(Boutique E-Commerce)* | `store` | `passive +data +public` | `logger`, `wordpress`, `mariadb`, `vitals`, `tunnel` | Online transactional store with database, health probes & payments |
| **Document & AI Hub**<br>*(GED & IA Documentaire)* | `document-hub` | `agent +documents +public` | `vault`, `logger`, `bridge`, `queue`, `maestro`, `ged`, `qdrant`, `rag`, `tunnel` | Sovereign document management, OCR, 384d vector search & multimodal AI |
| **Fleet Manager (Parent)**<br>*(Gestionnaire de Flotte Père)* | `fleet-manager` | `agent +parent +public` | `vault`, `logger`, `bridge`, `queue`, `maestro`, `supervisor`, `manager-gateway`, `tunnel` | Supervisor cockpit repairing ($K+1$) and provisioning child universes |
| **Field Service & Quotes**<br>*(Devis & Rapports de Chantier)* | `field-service` | `agent +documents +voice` | `vault`, `logger`, `bridge`, `queue`, `maestro`, `ged`, `rag`, `voice` | Turns voice notes & job site photos into structured quotes & PDF reports |
| **Accounting & Reconciliation**<br>*(Rapprochement & Compta)* | `accounting-vault` | `agent +documents +data` | `vault`, `logger`, `bridge`, `queue`, `maestro`, `ged`, `rag`, `mariadb` | Ingests supplier invoices & bank statements, reconciles lines & exports journals |
| **Omnichannel Helpdesk**<br>*(Support Client Omnicanal)* | `helpdesk` | `agent +intake +documents` | `vault`, `logger`, `bridge`, `queue`, `maestro`, `mail-agent`, `ged`, `rag` | Automatic email/chat triage, vector knowledge lookup & ticket escalation |
| **Booking Engine**<br>*(Prise de Rendez-Vous)* | `booking-engine` | `passive +data +public` | `logger`, `mariadb`, `calendar-sync`, `tunnel` | Online appointment booking with CalDAV/ICS sync and SMS/email alerts |
| **Online Academy / LMS**<br>*(Plateforme Formations)* | `academy` | `passive +data +public` | `logger`, `mariadb`, `auth`, `tunnel` | Member portal for video courses and PDF deliverables (0% platform fee) |
| **Watchdog & Scraping**<br>*(Agent de Veille & Tâches)* | `watchdog` | `agent +clock` | `vault`, `logger`, `bridge`, `queue`, `maestro` | Autonomous cron tasks, supplier API sync, competitor scraping & alerts |
| **Public Brochure**<br>*(Site Vitrine Souverain)* | `brochure` | `passive +public` | `logger`, `nginx/static`, `tunnel` | Ultra-fast, lightweight public presence with zero attack surface |

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

---

## 🧩 3. Modular Options & Extensions

Options attach to either floor or any archetype:

| Option (Lego) | Human Alias | Adds | What It Buys |
| :--- | :--- | :--- | :--- |
| **`+waf`** | `+security` | `@shaper/waf-engine` *(TARGET)* | **Adaptive Sovereign Firewall & positive cache (shaped live)** |
| **`+billing`** | `+paiement` | `brick-billing` *(TARGET)* | Stripe webhooks, subscriptions, customer billing & auto-invoicing |
| **`+voice`** | `+voix` | `brick-voice` *(TARGET)* | Whisper voice transcription (STT) & vocal response synthesis (TTS) |
| **`+messaging`** | `+whatsapp` | `brick-messaging` *(TARGET)* | WhatsApp Pro / Telegram / Signal client photo & chat intake |
| **`+calendar`** | `+agenda` | `brick-caldav` *(TARGET)* | CalDAV / ICS booking availability & 2-way agenda sync |
| **`+pdf-toolkit`** | `+pdf` | `brick-pdf` *(TARGET)* | Multi-page PDF splitting, barcode tagging, and digital signature |
| **`+documents`** | `+ged` | `ged`, `qdrant`, `@shaper/rag` | Full document ingestion, OCR, and 384d semantic vector search |
| **`+data`** | `+bdd` | `mariadb` | Relational database state that outlives the execution run |
| **`+web`** | `+cockpit` | `helm`, `auth` | Operator `/console` cockpit and authenticated browser interface |
| **`+public`** | `+online` | `tunnel` (Cloudflare Zero Trust) | Public HTTPS routing with **zero open inbound ports** |
| **`+intake`** | `+mail` | `@shaper/mail-agent` | Automatic inbound IMAP mail listening & background job intake |
| **`+parent`** | `+superviseur` | `@shaper/supervisor`, SSH authority | Supervisor role: grades child vitals (R23) and performs repairs |
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

## 💬 4. Real-World Prompt Examples (English & French)

Here is how you can formulate your requests in natural language:

### Example 1 — E-Commerce Store with Adaptive WAF
* **EN:** *"Build me a **`store +waf`** universe called `univ-shoes-dev`, DEV lifecycle. It runs a WooCommerce shop with an adaptive firewall and precomputed product cache."*
* **FR:** *« Crée-moi un univers **`store +waf`** nommé `univ-chaussures-dev`, cycle DEV. Il héberge une boutique avec firewall adaptatif et cache produit précalculé. »*

### Example 2 — Job Site Quotes with Voice & WhatsApp
* **EN:** *"Build me a **`field-service +messaging +billing`** universe called `univ-renov-dev`, DEV lifecycle. Artisans send photos and audio notes via WhatsApp; the agent produces signed quotes and collects Stripe deposit payments."*
* **FR:** *« Crée-moi un univers **`field-service +messaging +billing`** nommé `univ-renov-dev`, cycle DEV. Les artisans envoient des photos et mémos vocaux par WhatsApp ; l'agent produit les devis signés et encaisse les acomptes Stripe. »*

### Example 3 — Accounting Hub with Auto-Mail Ingestion
* **EN:** *"Build me an **`accounting-vault +intake +waf`** universe called `univ-accounting-dev`, DEV lifecycle. Invoices arriving at `invoices@company.com` are automatically parsed, OCR-verified, reconciled against bank records, and filed into the GED."*
* **FR:** *« Crée-moi un univers **`accounting-vault +intake +waf`** nommé `univ-compta-dev`, cycle DEV. Les factures reçues par mail sont extraites par OCR, rapprochées des lignes bancaires et classées dans la GED. »*

### Example 4 — Booking Engine for Healthcare / Consultants
* **EN:** *"Build me a **`booking-engine +messaging`** universe called `univ-clinic-dev`, DEV lifecycle. Patients book slots online, syncing with Apple/Google Calendar and receiving appointment reminders on WhatsApp."*
* **FR:** *« Crée-moi un univers **`booking-engine +messaging`** nommé `univ-cabinet-dev`, cycle DEV. Prise de RDV en ligne synchronisée avec Google/Apple Calendar et rappels WhatsApp. »*

### Example 5 — Private Video Academy
* **EN:** *"Build me an **`academy +billing +waf`** universe called `univ-courses-dev`, DEV lifecycle. Private member portal selling video masterclasses with Stripe subscriptions and zero third-party platform fees."*
* **FR:** *« Crée-moi un univers **`academy +billing +waf`** nommé `univ-formation-dev`, cycle DEV. Espace membres vendant des cours vidéo par abonnement Stripe sans commission de plateforme tierce. »*

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

The test suite automatically resolves human archetypes and verifies that all
required base bricks are present before any deployment is permitted.

---

## 🚫 What No Profile Contains

Its own repair authority. A universe emits its raw vitals; a level above ($K+1$)
grades them and repairs it (Rule 23), or a human operator does (Rule 24).
`+parent` makes a universe the supervisor of **others** — never the one who
modifies itself in flight.
