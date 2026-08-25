# Instance: mail-contact-zoutik-shop (univ7)

> **Intent Classification**: SPECIFIC INTENT (Universe: univ7)  
> **Extends**: `bricks/brick-agent` (generic — do NOT copy Containerfile)

## 1. Declarative Objective

Test mailbox agent beat on `contact@zoutik.example.com` — test env only, not prod.

## 2. Invariants

1. Credentials in vault key `secret/mail/contact-zoutik-shop` — seeded from `resources/vault-resources.local.json`.
2. Uses generic `brick-agent` image — this folder is params only.
3. Context: `universes/univ7/context/AGENT-CONTEXT.md`.
4. Cadence 300s via Maestro task registry.
