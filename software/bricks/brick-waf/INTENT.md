> **Intent Classification**: GENERIC INTENT (Universal / Parameterized Blueprint)
> **Status**: **TARGET — not implemented.** This file is a specification. The
> chain it belongs to is described in
> [`doctrine/SOVEREIGN-WEB-CHAIN-WAF-AND-CACHE.md`](../../../doctrine/SOVEREIGN-WEB-CHAIN-WAF-AND-CACHE.md);
> the obligations it must satisfy are Rule 28.

# Brick: WAF (Sovereign Routing Firewall)

## 1. Declarative Objective

Answer one intent: **protect this application from what the web throws at it,
using what the agent knows about this application that no generic firewall can
know.**

A generic WAF knows attack signatures. It does not know that this deployment
exposes exactly eleven routes, that three of them accept `POST`, that one takes a
numeric id between 1 and 9999, and that everything else is noise. The agent that
built the application does know — it entered from underneath, it read the code,
the routes, the handlers. That knowledge is the whole point of this brick.

## 2. The split that keeps this honest

Rule 28 forbids hand-rolling generic signature filtering, and it is right: a
homegrown signature list is not maintained against tomorrow's attacks. Yet the
bespoke, agent-generated firewall described here is exactly what this system
should build. Both are true, because they are two different security models:

| Model | Question it answers | Who can answer it | Where it belongs |
| :--- | :--- | :--- | :--- |
| **Positive** — allow-list | "Is this request one of the shapes this application legitimately accepts?" | **Only the agent that read this application.** No maintained corpus knows your routes | **This brick.** Generated, bespoke, hardcoded per deployment |
| **Negative** — signatures | "Does this request match a known attack?" | A community that tracks attacks full time | **Delegated** to a maintained engine (OWASP CRS via Coraza / ModSecurity), per Rule 28 |

Positive security is what a bespoke engine does better than anyone. Negative
security is what it must never pretend to do alone. A deployment that ships only
the allow-list is not protected against tomorrow; a deployment that ships only
signatures is not protected against today's misuse of its own routes.

## 3. Invariants

1. **The rules are generated from the application, not configured by hand.** The
   parent agent reads the routes, verbs, parameter shapes and legitimate flows,
   and emits a **hardcoded** ruleset for this deployment. Configuration is not the
   deliverable — a ruleset that only fits this application is.
2. **No model in the request path.** Generation is `D3` reasoning; the runtime is
   `D0`, deterministic, and never calls an engine to decide about a request.
   Latency and attack surface both forbid it.
3. **An allow-list is a hypothesis until both corpora pass** (Rule 28). The
   versioned attack corpus (SQLi, XSS, path traversal, verb violation, rate
   saturation) must be blocked **and** the versioned legitimate-traffic corpus
   must pass. A WAF that blocks real customers is an outage, not a protection.
4. **The application changes, the ruleset regenerates.** Adding a WordPress
   plugin adds routes. A ruleset generated before that plugin is now wrong in
   both directions: blind to the new surface, and blocking legitimate traffic.
   Any change to the application's route surface re-triggers generation and both
   corpora, deployed canary-first (Rule 25).
5. **DEV runs without it, deliberately.** The WAF is not a development obstacle
   to be worked around. During DEV the goal is to build fast and well; the
   security pass comes after, and it is a pass, not an afterthought. A WAF is a
   second layer over code that must already be sound on its own.
6. **It is the router, and routing is its uncontested role.** Universe → Podman
   container. Nothing else in the world knows this universe tree.
7. **Everything it decides is logged, and an agent reviews the log.** Blocks,
   passes, near-misses and the rule that fired. The review loop is what turns an
   allow-list into a maintained one; without it the ruleset silently drifts away
   from the application.
8. **It never claims to be equivalent to a proven WAF** until both corpora are
   green — doctrine, not modesty.

## 4. Implementation language

Left to the implementing agent, with a measured constraint rather than a name:
the engine must sustain the universe's declared peak request rate inside its
declared memory budget, with a per-request decision cost that does not register
against Layer 4's own work. Compiled and predictable beats fashionable.

The operator's stated preference is Rust. **That is recorded here as a
preference, not a requirement** — for exactly the reason no rule in this
repository names a model (Rule 7): the agent that writes it chooses what it is
genuinely fluent in, because the code it can maintain beats the code it can only
produce once.

## 5. Position in the chain

```
Visitor → Cloudflare edge (tunnel, geo-IP, free tier)   ← first line, and the infra
                                                          is already invisible from outside
        → Nginx (static sprinter, proxy_cache)          ← do not reimplement what it does
        → THIS BRICK (allow-list, routing, precomputed cache)
        → Application container                          ← only real, unpredictable work
```

Two layers already protect before this one exists, and they are not decoration:
the Cloudflare tunnel means no inbound port is open at all, and rootless Podman
containers are minimal by construction. This brick is lock-down **added to**
lock-down by design, never a substitute for it.

Country-level blocking belongs to the Cloudflare edge free tier where it is
sufficient. Do not buy a WAF panel to obtain what this brick generates better
from the application it can read.

## 6. Proof of Correct Operation

Both corpora green, canary before fleet (Rule 25), and a typed deliverable under
Rule 20 — never a health endpoint. The dual corpus lives versioned in the
repository, because a guardian nobody re-tested is a guardian nobody trusts.

---

## Cognition

> Scales and semantics: [`../../../docs/architecture/COGNITION.md`](../../../docs/architecture/COGNITION.md) · Extends Rule 21.

This brick has two cognitive lives, and conflating them is the trap:

**Runtime — the request path**
- **capacity-class**: — (deterministic, no engine)
- **role**: neutral · **depth**: D0 · **throughput**: T0 · **horizon**: H0
- **degraded**: refuse — a firewall that cannot decide must fail closed, not guess
- **rationale**: Sub-millisecond decisions on hostile input. A model here would add both latency and attack surface.

**Generation — reading the application to emit its ruleset**
- **capacity-class**: heavy-engineering
- **role**: requires · **depth**: D3 · **throughput**: T2 · **horizon**: H2
- **degraded**: refuse — a ruleset produced by an engine too weak to understand the application is a hypothesis with no author
- **rationale**: Deriving a legitimate-traffic model from source requires resolving ambiguity across routes, handlers and flows. It runs offline, so latency is irrelevant; correctness is not.
