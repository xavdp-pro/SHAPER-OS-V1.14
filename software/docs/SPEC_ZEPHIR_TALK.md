# 🎙️ Spécifications — Zephir Talk (`/talk`)

> **STATUS: OBSOLETE (2026-08-19)**  
> The `/talk` and `/voice` routes **redirect to `/console`**. Operator voice (STT/TTS, Groq ack) lives **inside `/console`** (P2).  
> **Active law**: [`PERIMETERS.md`](./PERIMETERS.md) · [`DOC-INDEX.md`](./DOC-INDEX.md).  
> This file is kept as **historical reference only** — do not implement from it.

---

**Version :** 1.0.0 (archived)  
**Date :** 19 Août 2026  
**Auteurs :** Xavier & Antigravity  
**Former status :** Spec for dedicated Talk page — superseded by console-integrated voice

---

## 1. Vision & Positionnement

### 1.1 Qu'est-ce que Zephir Talk ?
**Zephir Talk** est le copilote vocal exécutif et grand public de **SHAPER-OS**.  
Contrairement au mode **Maker / Console (`/console`)** qui est un environnement de développement et d'ingénierie lourde (fichiers, terminal, code complexe, raisonnement long), **Zephir Talk** est conçu pour être un **interlocuteur oral direct, naturel, percutant et réactif du tac au tac**.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            SHAPER-OS ECOSYSTEM                              │
├──────────────────────────────────────┬──────────────────────────────────────┤
│        LE MAKER / LA CONSOLE         │           ZEPHIR TALK                │
│              (/console)              │             (/talk)                  │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ • Utilisateur : Concepteur / Dev     │ • Utilisateur : Dirigeant / Opérateur│
│ • Modalité : Texte, Images, Fichiers │ • Modalité : 100% Voix (Hands-free)  │
│ • Sortie : Code, Tableaux, Diffs     │ • Sortie : Phrases courtes orales    │
│ • Modèles : Claude 3.7 / OpenCode    │ • Modèles : gpt-oss-120b / Deepgram  │
│ • Latence : 5s - 30s (Deep Thinking) │ • Latence : < 400ms (Temps réel)     │
└──────────────────────────────────────┴──────────────────────────────────────┘
```

### 1.2 Règle Fondatrice d'Expérience Conversationnelle
> **Interdiction absolue des accusés de réception passifs ou creux.**  
> Zephir ne doit **jamais** se comporter comme un simple répondeur ("C'est noté", "Bien reçu, je m'en occupe").  
> Il répond **directement et concrètement** aux questions (explications claires, résultats de calculs, synthèses, questions de cadrage) en **1 à 2 phrases orales vivantes**.

---

## 2. Architecture Technique & Flux Temps Réel

```
  [ Microphone Utilisateur ]
              │ (Audio PCM 16 kHz)
              ▼
  ┌───────────────────────────────┐
  │  Deepgram Nova-3 (Live STT)   │ ───► Transcription temps réel (VAD)
  │    /api/voice/stt-stream      │
  └───────────────┬───────────────┘
                  │ Texte transcrit
                  ▼
  ┌───────────────────────────────┐
  │   Moteur Conversationnel      │ ───► Modèle : openai/gpt-oss-120b (Groq)
  │      POST /api/voice/chat     │      Latence moyenne : ~350ms
  └───────────────┬───────────────┘
                  │ Réponse texte orale (1-2 phrases)
                  ▼
  ┌───────────────────────────────┐
  │  Deepgram Aura-2 (Live TTS)   │ ───► Voix : aura-2-agathe-fr (PCM 24 kHz)
  │    /api/voice/tts-stream      │      Streaming audio immédiat vers Web Audio API
  └───────────────┬───────────────┘
                  │ Flux Audio
                  ▼
   [ Haut-Parleur Utilisateur ]
```

### 2.1 Composants de la Chaîne Vocale
1. **STT (Speech-to-Text)** :
   - Moteur : **Deepgram Nova-3** (Français multilingue).
   - Flux : WebSocket bidirectionnel `/api/voice/stt-stream`.
   - Format d'entrée : PCM 16 kHz Mono (capturé via `AudioContext` / `ScriptProcessor` ou `AudioWorklet`).
   - Détection de fin de parole : Voice Activity Detection (VAD) avec endpointing automatique.

2. **LLM Conversationnel Direct** :
   - Endpoint : `POST /api/voice/chat`.
   - Modèle Primaire : `openai/gpt-oss-120b` via Groq (temps de génération $< 400$ ms).
   - Modèle Fallback : `groq/compound-mini`.
   - Système de Prompt (`CONVERSATIONAL_SYSTEM`) :
     - Concision stricte (1 à 2 phrases max adaptées à la voix).
     - Zéro markdown lourd (pas d'étoiles, pas de puces, pas de liens URLs bruts).
     - Richesse sémantique et intelligence directe.

3. **TTS (Text-to-Speech)** :
   - Moteur : **Deepgram Aura-2** (`aura-2-agathe-fr`).
   - Flux : WebSocket streaming `/api/voice/tts-stream`.
   - Format de sortie : PCM 24 kHz (lecture fluide et continue via buffer audio Web Audio API).

---

## 3. Exclusivité & Cycle de Vie Audio

Pour éviter tout conflit de périphérique ou de double écoute :
1. **Exclusivité Mutuelle** :
   - Le mode `/console` est 100% visuel (aucun écouteur micro persistant en tâche de fond).
   - Le mode `/talk` détient le verrou exclusif sur le micro et la synthèse vocale.
2. **Nettoyage automatique à la navigation** :
   - Clic sur `Talk` depuis la console $\rightarrow$ arrêt immédiat de tout lecteur audio en cours.
   - Clic sur `Mode Console` depuis Talk $\rightarrow$ arrêt immédiat de la capture micro (`stopDeepgramStt()`) et de la synthèse (`stopCurrentTts()`).
   - Démontage du composant (`useEffect` cleanup) $\rightarrow$ fermeture propre de tous les WebSockets et contextes audio.

---

## 4. Spécifications Ergonomiques & UI/UX

### 4.1 L'Orbe Central Interactif (`VoiceOrb`)
L'orbe central est le composant maître de l'interface. Il remplit un double rôle : **indicateur d'état** et **déclencheur tactile principal** (Tap to speak / Tap to mute).

| État | Couleur / Animation | Icône & Label SVG (100% vectoriel) |
| :--- | :--- | :--- |
| **`idle`** | Respiration cyan/indigo subtile | `<span className="...">Appuyer</span>` |
| **`listening`** | Anneaux néon émeraude + onde d'écho | `<Mic size={13} /> Écoute…` |
| **`thinking`** | Tourbillon d'énergie violet / indigo | `<Sparkles size={13} /> Réflexion…` |
| **`speaking`** | Ondes dorées / cyan synchronisées | `<Volume2 size={13} /> Zephir parle…` |

### 4.2 Disposition & Mobile Viewport (`h-dvh`)
- **Structure Mobile First** : Plein écran strict `h-dvh max-h-dvh overflow-hidden`.
- **Aucun défilement requis** : Tout l'écran tient dans la hauteur visible (iPhone 14 / Android 390×844 à 430×932).
- **Suppression du bouton micro inférieur redondant** : L'orbe central étant grand et directement cliquable, le bas de page est allégé avec un simple rappel sobre :  
  *« Touchez l'orbe ou parlez librement en mode mains-libres. »*
- **Bulle de sous-titres dynamique** : Affiche le texte en cours d'écoute ou la réponse prononcée avec effet de verre dépoli (`backdrop-blur-md`).
- **Puces d'exemples rapides** : Suggestions en 1 clic ("Bonjour Zephir !", "Fais-moi le point sur les documents", "Génère un bilan comptable", "Créer un devis client").

---

## 5. Intégrations avec le Système SHAPER-OS

```
  ┌────────────────────────────────────────────────────────┐
  │                    ZEPHIR TALK                         │
  └──────────────┬──────────────────────────┬──────────────┘
                 │                          │
                 ▼                          ▼
     ┌────────────────────────┐ ┌────────────────────────┐
     │  MINI-GED EXPLORER     │ │   QUEUE ASYNCHRONE     │
     │      (/ged)            │ │   (@shaper/queue)      │
     ├────────────────────────┤ ├────────────────────────┤
     │ • Consultation directe │ │ • Tâches de fond       │
     │ • Accès aux rapports   │ │ • Délégation au Maker  │
     │ • Tags & Dossiers      │ │ • shaper-task.sh       │
     └────────────────────────┘ └────────────────────────┘
```

1. **Accès Direct à la Mini-GED** : Bouton d'accès direct dans le header vers `/ged` pour consulter instantanément les pièces jointes, factures et documents du système.
2. **Délégation de Tâches Asynchrones** : Lorsque l'utilisateur formule un ordre nécessitant un travail de fond (ex: "Génère le bilan financier complet du mois"), Zephir confirme oralement la prise en charge et délègue l'exécution à `@shaper/queue` sans bloquer la voix.
3. **Évolution Future (RAG & Reborn Partagé)** : Connexion au cluster vectoriel Qdrant (`univ9-qdrant`) pour injecter en temps réel le contexte documentaire pertinent dans le prompt de Zephir.

---

## 6. Contrats d'API & Références

### 6.1 Endpoint Conversationnel Direct
- **Route** : `POST /api/voice/chat`
- **Authentification** : Cookie de session ou Bearer Token requis.
- **Corps de la requête (JSON)** :
  ```json
  {
    "message": "Quel est le résultat de 45 fois 2 ?",
    "locale": "fr",
    "history": [
      { "role": "user", "content": "Bonjour" },
      { "role": "assistant", "content": "Bonjour ! Comment puis-je vous aider ?" }
    ]
  }
  ```
- **Réponse (JSON)** :
  ```json
  {
    "text": "Le résultat de 45 fois 2 est 90.",
    "model": "openai/gpt-oss-120b",
    "locale": "fr"
  }
  ```

### 6.2 Endpoint Streaming STT
- **Route** : `GET /api/voice/stt-stream` (Protocole WebSocket)
- **Données envoyées par le client** : Chunks binaires PCM 16 kHz (16-bit Mono, Little Endian).
- **Messages reçus par le client (JSON)** :
  ```json
  {
    "type": "transcript",
    "text": "Bonjour Zephir",
    "is_final": true,
    "speech_final": true
  }
  ```

### 6.3 Endpoint Streaming TTS
- **Route** : `GET /api/voice/tts-stream` (Protocole WebSocket)
- **Données envoyées par le client (JSON)** :
  ```json
  {
    "text": "Bonjour ! Que puis-je faire pour vous aujourd'hui ?"
  }
  ```
- **Flux reçu par le client** : Chunks binaires audio PCM 24 kHz lus instantanément par l'AudioBuffer.

---

## 7. Critères d'Acceptation & Matrice de Validation

| ID | Critère | Statut |
| :--- | :--- | :--- |
| **SPEC-01** | Réponse orale directe et naturelle sans accusé d'attente creux | ✅ Validé |
| **SPEC-02** | Latence de génération conversationnelle $< 400$ ms | ✅ Validé (Groq gpt-oss-120b) |
| **SPEC-03** | Pure Deepgram (Nova-3 STT + Aura-2 TTS) | ✅ Validé |
| **SPEC-04** | Exclusivité audio stricte entre `/console` et `/talk` | ✅ Validé |
| **SPEC-05** | Aucune icône ou glyphe cassé `▯` (100% Lucide SVG) | ✅ Validé |
| **SPEC-06** | Affichage mobile iPhone / Android sans défilement (`h-dvh`) | ✅ Validé |
| **SPEC-07** | Interaction tactile directe sur le VoiceOrb | ✅ Validé |
| **SPEC-08** | Suite de tests E2E Playwright / Puppeteer automatisée | ✅ Validé |
