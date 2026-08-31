# The Direction of the Link Is the Boundary

> **Status**: founding doctrine, stated by the operator on 31 August 2026 while
> designing the demo SaaS: *"this, for me, is the foundation of logical
> security."* It does not replace [`SECURITY-FOLLOWS-FUNCTION.md`](./SECURITY-FOLLOWS-FUNCTION.md);
> it is the structural half of it. That doctrine says *when* hardening
> happens. This one says what the structure must already be on day one.

## The law, in two lines

**What holds power has no inbound door. What is reachable holds no power.**

A component that can act on infrastructure is never called; it calls. A
component that answers the public can never act on infrastructure. Between
the two, the only link runs outward from the powerful one — so there is no
path in, and no filter to get wrong.

## Why this is structural, not a hardening measure

A firewall rule, an allowlist, a token check: each is a filter, and a filter
is a thing that can be misconfigured, bypassed, or forgotten on a Friday
evening. **A link that does not exist cannot be misconfigured.**

The distinction matters at the moment of a mistake. When a filter is wrong,
the attacker reaches the powerful component and the filter was the only thing
between them. When the direction is right, a wrong filter costs a leak of the
public surface — never the host.

## The shape

    public ──▶ the surface that answers (no power over the machine)
                        ▲
                        │  outbound only: it asks "what should I do?"
                        │
               the component that acts (root on the host, listens on nothing)

Three properties follow, and they are the reason to prefer this shape even
when a firewall would "do the job":

1. **No inbound surface to defend.** The powerful component exposes no port,
   holds no certificate, needs no allowlist. It cannot be scanned, because
   there is nothing to scan.
2. **It moves without ceremony.** Behind NAT, on a laptop, on a new host, in
   another country: nothing to open, nothing to declare. It reaches out.
3. **It becomes a fleet by addition.** One actor per machine, all asking the
   same surface for the work destined to their host. Adding a machine adds a
   client, never a route.

## Where this already lives in our estate

- **WireGuard clients on `gbs-vps`**: passive, no public address, they go
  fetch. The pattern this doctrine generalises.
- **The demo SaaS (UNIVDEMOPROOF)**: the public form is the SaaS; the maker,
  which holds root SSH on the host, polls it for work. A form field can never
  reach a shell, because no path leads there.
- **The queue and its consumers**: a consumer asks the queue for PENDING work
  of its type and reports back. Measured on 30 August under a 40-job burst:
  none lost, none crossed, three correlated audit witnesses per job.
- **Instances that testify**: a universe pushes its own events outward to the
  ledger. Observability travels the same direction as everything else, so no
  door is opened anywhere to collect it.

## The obligations that come with it

Choosing this shape is not free of duties, and pretending otherwise would be
the usual security lie:

- **The outbound credential is a real secret.** It lives in the vault, it is
  scoped to asking for work and reporting on it, and it is rotated like any
  other. A stolen one lets an attacker impersonate a worker; it must never
  let one command a host.
- **The actor executes a fixed recipe with typed parameters.** Pulling work
  is not permission to interpret it. Data that came from a form never becomes
  part of a command; it is passed as an argument, never concatenated into a
  shell string. *(Operator ruling, same day: "the maker can be a simple robot,
  with an agent that only has the power to check that all goes well.")*
- **The public surface is still a public surface.** It carries the accounts
  and the personal data, so it gets the ordinary web hardening on its own
  schedule. This doctrine removes one class of catastrophe; it does not
  remove the work.
- **Silence must be visible.** An actor that stops asking is indistinguishable
  from an actor with nothing to do — unless absence is itself watched. The
  surface declares how long is too long, and says so out of band (Rule 27).

## The test

Before shipping any component that can act on infrastructure, answer one
question: **who can open a connection to it?** If the answer is anything other
than "nobody", the design is not finished.
