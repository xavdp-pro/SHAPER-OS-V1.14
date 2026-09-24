# univ-minimal

> **Intent Classification**: SPECIFIC INTENT (Universe: `univ-minimal`)

## Objective

The minimal composition of a SHAPER universe, materialised: **Vault, Logger,
Queue and Maestro**, each a functional Podman that owns its private MariaDB
(Rules 4 and 26). No cognition adapter, no catalogue brick, no domain, no
public door. It is the floor every other universe of the current construction
model stands on; the reference universe adds the OpenCode bridge on top of it
(profile `agent`).

Maestro is present and idle: with no declared schedule it submits nothing.

## Exact runtime — four units, eight containers

| Unit | App container | Private database | Account / uid |
| :--- | :--- | :--- | :--- |
| Vault | `<universe>-ctr-vault` :8610 | `<universe>-ctr-vault-mariadb` | `vault` / 10610 |
| Logger | `<universe>-ctr-logger` :8620 | `<universe>-ctr-logger-mariadb` | `logger` / 10620 |
| Queue | `<universe>-ctr-queue` :8640 | `<universe>-ctr-queue-mariadb` | `queue` / 10640 |
| Maestro | `<universe>-ctr-maestro` :8630 | `<universe>-ctr-maestro-mariadb` | `maestro` / 10630 |

Application containers use the universe's host network and bind `127.0.0.1`
only: the units speak to each other inside the universe container and to
nothing outside it.

<a id="private-mariadb"></a>
## Each unit's database is its own

What `scripts/provision-unit-mariadb.sh` materialises for every unit, and what
`deploy/proof.sh` checks from outside the unit:

1. **One name everywhere.** The functional slug is the Linux account in the
   universe container and in the image (same fixed uid), the MariaDB account
   and the database.
2. **No network path to any database.** Each MariaDB container runs with
   `--network none` and `--skip-networking`. The only entry is the unit's socket
   directory `/apps/<slug>/nosav/run/mysqld`, mounted into that unit's own
   application container and no other.
3. **Two paths, never mixed.** The application account holds `SELECT, INSERT,
   UPDATE, DELETE` on its own database. Root authenticates by `unix_socket`
   from inside the MariaDB container only; network root accounts and the
   image's default accounts are removed at birth. The schema is read from the
   unit's own image and applied as root.
4. **The password is a private file.** `/apps/<slug>/etc/mysql/localhost/passwd`,
   generated once, mode `0600`, owned by the unit's account, mounted read-only.
   It travels on standard input when the administrative path sets it, never on
   a command line.
5. **Born with the function.** The database, the account and the schema exist
   before the application starts; an application that finds its schema absent
   refuses to start. The durable state of every unit is in its database —
   no JSON, JSONL or SQLite store serves in this universe.
6. **Persistent and restorable.** The datadir `/apps/<slug>/sav/mariadb` survives
   the containers; `deploy/restore-drill.sh` dumps each unit, restores it into a
   throwaway MariaDB with no network, and checks it with the unit's own
   semantics (the Vault decrypts a controlled secret with its key and refuses a
   wrong one).

The Vault master key is `/apps/vault/etc/vault/master.key` (`0400`, owned by
`vault`, mounted read-only). It is generated only when the Vault is born; a
Vault whose datadir exists without its key is a halt, never a new key.

<a id="host"></a>
## What the universe container must provide

Checked by `deploy/podman-up.sh` before anything starts, or recorded here as
measured on terrain:

- `podman`, `nftables` (Rule 11), `jq`, `openssl`, `curl`, `iproute2` (`ss`);
- `podman-restart.service` enabled, so the `--restart=always` containers come
  back after the universe container restarts;
- on a Proxmox **unprivileged** LXC (`proxmox` family): `nesting=1,keyctl=1`,
  **and `/dev/net/tun` passed to the container** (`pct set <id> --dev0
  /dev/net/tun,mode=0666`, then a restart). Without it, every `RUN` step of a
  `podman build` fails inside the container (`pasta … /dev/net/tun: No such
  file or directory`), while `podman run` of a prebuilt image works — a host
  that only runs containers looks fit and is not.

<a id="proof"></a>
## What the proof shows, and what it does not

`deploy/proof.sh` exits 0 only when every unit passes the Rule 26 gate —
database present and answering, no network listener, identity equal to the
slug, passwd `0600` owned by the unit, least privilege, application running as
its account, another unit's credential refused, the application refused as
root, the socket absent from every other unit's container — and each unit
proves one real effect read back from its database through the root path.

A green health endpoint is not in that list as a proof: it shows a process is
up, never that work happened.

<a id="image-lock"></a>
## Images

`cfg-image-lock.json` names one immutable digest per brick the manifest
declares, filled from the registry's answer to `podman push --digestfile`. The
MariaDB image is pinned by digest in the instance configuration
(`SHAPER_MARIADB_IMAGE`). A DEV instance may run from a freshly published tag
(`SHAPER_REGISTRY` + `SHAPER_IMAGE_TAG`); a TEST or PROD one may not.

<a id="gaps"></a>
## What this universe does not yet do

Recorded so nobody reads the floor as the full target contract of the units
(`operator-deliverables/*-FUNCTIONAL-UNIT-TARGET-2026-09-22.md`):

- no short-lived, Vault-signed unit credentials: the internal APIs rely on the
  `127.0.0.1` boundary and Vault's bearer token (Rule 0K);
- no transactional outbox to Logger: audit events are still sent over HTTP;
- no Logger cross-event chain or external checkpoint;
- no Queue leases, attempts table or dead letter; no Maestro scheduler leases;
- no automated partition maintenance, off-host encrypted recovery points or
  R2 layout (Rule 16 level 5);
- the Vault master key and the database backup live in the same universe
  container, so a container-level backup carries both (Rule 12 gap).
