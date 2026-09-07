# Backups Are Pulled, Never Pushed

> **Status**: applied doctrine, settled with the operator on 7 September 2026.
> It is [`DIRECTION-IS-THE-BOUNDARY.md`](./DIRECTION-IS-THE-BOUNDARY.md)
> applied to the one case where the intuition points the wrong way, and where
> getting it wrong is discovered on the worst possible day.

## The case

Machines produce backups. A vault keeps them. Four shapes are available, and
the operator has weighed them more than once:

1. open the vault to every container and VPS over SSH;
2. create one backup user on the vault, shared;
3. create one user per machine to be backed up;
4. let the vault go and fetch, holding its own key.

The first three feel cheaper. They are the same gesture at three grains, and
all three are wrong for the same reason.

## Who holds power here

Not the machines. **The vault.** It holds every machine's data, across time,
including what was deleted elsewhere six months ago. Take the vault and you
have the estate — not one host, all of them, historically.

So the law applies to the vault, and the question is whether it has a door.

## What the first three shapes do

They give it one. Machines connect *into* the vault, and the work becomes
choosing the right lock and never getting it wrong again.

Worse than the door: **whoever may write may destroy.** A compromised
public-facing container encrypts or deletes its own backups on the vault. That
is not an exotic scenario, it is the ordinary path of ransomware — take an
exposed machine, then kill the copies. Per-machine users bound the blast to one
perimeter, which is better, and still leave one door per machine to maintain.

## The objection to pulling, met head on

Reverse it and the vault reaches out. Nothing can open a connection to it; it
has no bell to ring. The immediate objection is fair: **the vault now holds an
SSH key to every machine. Has the treasure simply moved?**

No, for two reasons.

**Risk concentrates on the least exposed node.** A container serving public
traffic is compromised orders of magnitude more often than a host with no
inbound port at all. Concentrating where nobody can enter is not moving the
risk; it is putting it out of reach.

**And the key it holds need not be a general key.** In each machine's
`authorized_keys`:

    restrict,command="rsync --server --sender -vlogDtpre.iLsfx . /path/to/backups/"

`restrict` removes the PTY, port forwarding and agent forwarding. `command=`
means the key knows exactly one gesture: read one directory. Holding the whole
vault then yields read access to a directory whose contents the vault already
had. This is the law applied one level down — not a guarded door, but a
corridor so narrow that only one gesture fits.

## The argument that decides it

**Pushed, a machine that stops backing up produces silence, and silence looks
like success.** Nobody is paged when nothing arrives. The gap is discovered on
the day the backup is needed.

**Pulled, absence becomes an event.** The vault tries, fails, and knows. It
cannot mistake "nothing to do" for "I could not".

`DIRECTION-IS-THE-BOUNDARY.md` already states this obligation in general —
*silence must be visible*. Pulling is the shape that satisfies it for free
instead of requiring a second mechanism to watch the first.

## What our estate does today, and the single change

The split is already right:

- **`backup-local.sh`** runs on the machine. Only the machine knows *when* its
  data is consistent — after the SQL dump, not during it. Preparation stays
  local, and must.
- **`backup-pra-sync.sh`** replicates to the central vault, encrypted with a
  key generated for backups and nothing else. That layer stays: a compromised
  vault then holds ciphertext. It was not always so — until V1.13 the script
  fell back to the vault master key, so breaking one backup handed over the key
  to every `vault.enc` inside it.

**Only the direction of the second script changes.** The machine prepares; the
vault comes and takes. Preparation, encryption and retention are untouched.

## The obligations that come with it

- **The restricted key is the doctrine, not an optimisation.** A pull
  implemented with an unrestricted key has moved the treasure after all.
- **Read-only on the machine, append-only on the vault.** Pulling stops a
  compromised machine from deleting its history only if the vault's own
  retention refuses deletion on its side too.
- **A machine that cannot be reached is reported, not retried in silence.**
  The event this shape creates is worth nothing if it is swallowed.
- **The vault is still the crown jewels.** It has no inbound door; it still
  deserves disk encryption, physical custody and a tested restore. This
  doctrine removes one class of catastrophe. It does not remove the work.

## A note on arbitration, and why it changed

The only real cost of the radical shape was setup time. That is precisely what
agents absorb. They do not absorb the cost of being wrong: a badly restricted
key is badly restricted whether a human or an agent wrote it.

So the arbitration moved. **Choose by failure mode, no longer by setup time** —
the argument that justified the shortcut, *the clean option takes too long*,
has stopped being an argument. That generalises well beyond backups.

## The test

Before shipping a backup path, answer the same one question, about the vault:
**who can open a connection to it?** Any answer other than "nobody" means the
design is not finished.
