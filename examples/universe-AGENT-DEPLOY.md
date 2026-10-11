# AGENT-DEPLOY — <univ_slug>

> Audience: install agent only — not the runtime AI.  
> Lifecycle of this universe: `dev` | `test` | `prod`

## Mission

Materialise this universe from the template's base units: Vault, Logger, Queue
and Maestro of `univ-minimal`, at one recorded revision of SHAPER OS
(`base/.shaper-revision`) — each one functional Podman holding its application
and its own MariaDB server (Rules 4 and 26) — then the units this universe
adds, each of the same shape. Prove it. Do not copy a `Containerfile`,
`packages/` or univ-minimal's scripts here.

## You MAY

1. Read `INTENT.md`, `manifest.json` and the `INTENT.md` of each unit it declares
2. Run `npm test` in the SHAPER OS checkout — it must be green before any image is built
3. Build the unit images under a **new** tag (`scripts/build-all-bricks.sh`) and pin
   `cfg-image-lock.json` from the registry's answer (`scripts/record-image-lock.py`);
   `prod` and `test` start from the lock only
4. Install the base units: `deploy/install-base.sh --shaper-repo <checkout> --shaper-commit <revision>`
5. Run `deploy/podman-up.sh --preflight`, then `deploy/podman-up.sh`, inside the universe container
6. Install the bootstrap renewal once: `deploy/base.sh install-renewal-timer.sh`
7. Prove: `deploy/proof.sh`, `deploy/base.sh lifecycle-drill.sh`, `deploy/base.sh restore-drill.sh`;
   `test/socle-live.test.js` is a smoke test, never the proof
8. If `test`: after the proof, **destroy** this universe

## You MUST NOT without a human

1. Commit secrets, `cfg-universe.env`, a master key, a password file or a tunnel token
2. Generate, copy or print a secret the base units generate themselves
3. Push over a tag a registry already serves, or rebuild under a tag a lock has pinned
4. Edit `base/`, or run the base's scripts from `base/deploy/` directly
5. Declare a unit before its start and proof are added to `deploy/podman-up.sh` and
   `deploy/proof.sh`, or one without its own MariaDB inside its own container
6. Deploy to a public host
7. Enable live mail (`MAIL_AGENT_STUB=0`) without explicit OK — never production mail in dev/test
8. Run over a universe of the earlier template's shape (file stores, an AI bridge): that is a migration
9. If `prod`: edit running files by hand or copy a DEV tree onto it

## Success

- [ ] `npm test` green
- [ ] `deploy/podman-up.sh` exit 0, every unit in `bootOrder` running
- [ ] `deploy/proof.sh` exit 0 — the Rule 26 inventory of every unit and one real effect each
- [ ] `lifecycle-drill.sh` and `restore-drill.sh` green
- [ ] If test: destroyed after the run
