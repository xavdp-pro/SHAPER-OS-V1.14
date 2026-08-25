# Brick: Agent

> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)  
> **Package**: `@shaper/agent` + bridge packages (`@shaper/bridge-agy`, etc.)

## 1. Declarative Objective

One generic agent brick — Maestro registers 1..N parameterized tasks (mail, ops, custom).

## 2. Invariants

1. **No brick-per-mailbox** — slug `mail-<local>-<domain>` is a registry entry, not a new image.
2. **Context via `contextPath`** — not a separate brick per universe.
3. Bridge CLI agnostic: agy, cursor, claude, opencode (HTTP Rule 8 contract).
4. Beat only while `GET /api/health` succeeds on the bridge.

### Illustrative Example (Non-Binding / Demonstration Only)

| Mailbox | Slug | Vault key |
| :--- | :--- | :--- |
| `contact@zoutik.example.com` | `mail-contact-zoutik-shop` | `secret/mail/contact-zoutik-shop` |
| `xavier@xavdp.pro` | `mail-xavier-xavdp-pro` | `secret/mail/xavier-xavdp-pro` |

Credentials live in vault — never in the brick image.

---

## Cognition

> Scales and semantics: [`docs/architecture/COGNITION.md`](../../../docs/architecture/COGNITION.md) · Extends Rule 21.

- **capacity-class**: heavy-engineering
- **role**: requires
- **depth**: D3
- **throughput**: T2
- **degraded**: queue
- **rationale**: Executes assigned tasks end to end and must judge when its own output satisfies the typed contract (Rule 20). Ambiguity resolution is the job, so depth cannot be lowered; latency is not user-visible, so it queues rather than degrading.
