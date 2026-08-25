# Package: @shaper/mail-agent

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)

## 1. Declarative Objective

Check mailbox inbox via IMAP — credentials from vault only, never from code or image.

## 2. Invariants

1. `vaultKey` required — fetch creds via VaultClient before any IMAP connection.
2. Every check logs `MAIL_INBOX_CHECK` to `@shaper/logger`.
3. Stub mode for tests (`MAIL_AGENT_STUB=1`) — no network.
4. Updates `checkpoint.json` with last unseen count.
