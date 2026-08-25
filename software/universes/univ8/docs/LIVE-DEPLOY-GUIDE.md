# UNIV8 — Guide de Déploiement Live & Podman

> Ce document résume le déploiement de la stack Podman complète pour UNIV8, avec agent OpenCode gratuit en conteneur ou Bridge AGY.

## 1. Objectif

Déployer l'univers **univ8** en conteneurs autonomes avec :
- Vraie vérification IMAP (ou mode stub pour les tests)
- Agent IA pilotable via HTTP/SSE (contrat bridge universel — Rule 8)
- Stack Podman autonome (Vault, Logger, Bridge AGY, Bridge OpenCode, Queue, Maestro)
- File de jobs volontaires (Queue auto-dispatch)

## 2. Commandes de Déploiement

### Démarrage de la stack Podman complète
```bash
bash deploy/podman-up.sh
```

### Déploiement en mode Live (IMAP réel + OpenCode)
```bash
bash deploy/podman-go-live.sh
```

### Envoi d'un job volontaire dans la queue
```bash
bash deploy/enqueue.sh "Fais un briefing sur les événements récents" test-session
```

### Arrêt de la stack
```bash
bash deploy/podman-down.sh
```

## 3. Architecture des Services Podman

| Service | Conteneur | Port | Description |
|---|---|---|---|
| **Vault** | `shaper-vault` | `8510` | Secrets chiffrés AES-256-GCM |
| **Logger** | `shaper-logger` | `8520` | Audit JSONL append-only |
| **Bridge AGY** | `shaper-bridge-agy` | `4330` | Pont Antigravity CLI |
| **Bridge OpenCode** | `shaper-bridge-opencode` | `4340` | Pont OpenCode gratuit ($0) |
| **Job Queue** | `shaper-queue` | `8540` | File asynchrone SSE + auto-dispatch |
| **Maestro** | `shaper-maestro` | `8530` | Beat scheduler cadencé (300s) |
