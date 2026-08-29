# Security Follows Function — The Paranoia Phase Comes When the Symphony Plays

> **Status**: founding doctrine. It governs *when* security work happens and
> *who dictates its depth*. It weakens no rule: the floor listed at the end is
> never deferred.

## The idea, in one paragraph

We build ensembles — many small things that link together and play as one.
Security is designed **into the structure** from the first day, but security
*work* — the paranoid pass, the full panoply — comes **once the symphony
plays**: once the fractal lives as built, validates its functioning, and
answers its cahier des charges. Every security model depends exclusively on
that cahier des charges and on what the client — or the operator — actually
demands. Hardening a system before it works is paying for locks on rooms that
do not exist yet, and it submerges the builders: it is easy to overwhelm an AI
agent, and just as easy to overwhelm a human. An abstraction is already hard
to hold in one mind. **Ultra-simplicity is a security property.**

## Why the structure already defends us

The posture is not naive. The architecture closes most attack angles *by
shape*, before any dedicated security work:

| Layer | What it closes |
| :--- | :--- |
| **Cloudflare in front of everything published** | The raw internet never touches an origin |
| **The sovereign WAF** (Rust, target — [`SOVEREIGN-WEB-CHAIN-WAF-AND-CACHE.md`](./SOVEREIGN-WEB-CHAIN-WAF-AND-CACHE.md)) | The web chain filters before the live process |
| **Podman inside LXC, one brick one container** | An image carries **exactly the packages its function needs** — most bricks have no SSH, no shell worth taking, no egress, nothing to pivot from |
| **Operators come in from underneath** | Humans and agents act through the **host**, never through the published surface. The host is therefore the real door: SSH only, effectively unreachable from outside, a whitelist of friendly IPs |

An attacker facing this has few angles; the paranoid pass, when it comes,
narrows those that remain. Which paranoia is *actually useful* is a
measurement to be made then — never an assumption made up front, and never
inside SHAPER OS's own build-out.

## The depth is dictated by the cahier des charges, not by dogma

An artisan baker's shop faces very little; a bank faces everything. One
security model per demand, sized by what is really at stake — this is Rule 33
already: *security posture arrives with the client that demands it*, on that
client's fork, never imposed on every base from the start. And it is Rule 32's
sequencing: *build-out comes before governance — demonstrate the craft first,
then add the hardening layers on a base that already works*.

## The hardening pass, when its time comes

When the ensemble is quasi-finished and the symphony plays, the pass is done
**from underneath**, with the code open — and this is where an agent is
*stronger* than a traditional auditor, because it has read everything:

1. **Know the terrain.** The agent reads the service's code and knows every
   route to defend and how to defend it — not a scan from outside, a reading
   from inside.
2. **Attack it.** Injection tests and the whole known panoply, against the
   running service, from the attacker's side of the WAF.
3. **Make the service tell the truth.** Its logging is hardened so behaviour
   is never hazardous or silent: what happened is written, correlatable, and
   readable from outside the thing that produced it (Rule 0G).
4. **Then agents peel the logs.** Routine security analysis is agents reading
   the evidence — to correct, to alert, and to answer the operator's question
   *"is everything going well, security-wise?"* with findings, not vibes.

## What is never deferred — the floor

Deferring the paranoid pass defers **nothing** on this list. These hold from
the first commit, always, and `shaper verify` enforces what it can:

- No secret, credential or personal identity in git (Boot Contract 10b);
- A missing secret in production is a **halt**, never a fallback;
- Secrets live in the vault; bricks reach resources through declared contracts;
- The structural isolation itself — the container shapes above — is the
  build, not a hardening step;
- Every incident still climbs back into the repository (Boot Contract 8).

## The same sequencing governs inter-agent dialogue

Rules for how agents talk to each other — what one universe's agent may ask
of another's — will come, and they will be held to the same standard:
**ultra-simple, one page, written when the conversations exist** and shaped
by what they actually need. A grammar designed before the dialogue it governs
is the same premature lock as paranoia before function.

## Why this doctrine exists

SHAPER OS is a deployment tool for the best possible collaboration between a
human and the different levels of agentic AI — the human as the shaper, the
agents as the builders, conventions making the assembly rational and
reproducible the way a good hosting panel made servers reproducible. That
collaboration dies if either side is submerged. This doctrine is the guardian
of that balance: the original conception keeps security in mind — the final
responsibility for it arrives once the project is quasi-finished, sized by
the demand, and measured rather than assumed.
