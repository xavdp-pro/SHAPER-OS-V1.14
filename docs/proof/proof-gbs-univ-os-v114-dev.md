# gbs-test sandbox — univ-os-v114-dev (V1.14 univ-base)

Recorded: 2026-09-15. Operator asked for a new LXC on `gbs-test` without
disturbing existing universes. PodMesh is out of scope for this lot.

## Host and isolation

| Field | Value |
| --- | --- |
| Host | `gbs-test` (SSH alias) |
| LXC name | `univ-os-v114-dev` |
| Profile | `podman-univ` |
| OS | Debian trixie (matrix image) |
| Source revision | `c547566` (synced tree) |

No existing instance was stopped, deleted, or modified.

## Universe

Canonical **`univ-base`** five-brick cell. State under:

`/root/SHAPER-OS-V1.14/software/universes/univ-base/`

Scripts:

| Script | Role |
| --- | --- |
| `software/universes/univ-base/deploy/gbs-test-bootstrap-v114.sh` | Registry lock, pinned deploy, partial `proof.sh` |
| `software/universes/univ-base/deploy/gbs-test-measure-opencode.sh` | Rule 7 model probe → `cfg-univ-base.env` |
| `software/universes/univ-base/deploy/gbs-test-run-full-proof.sh` | Job + artefact + full `proof.sh` |

## Image lock and registry (lesson from gbs-test)

1. Local registry: `podman run -d -p 5000:5000 docker.io/library/registry:2`
2. Push each brick with `podman push --digestfile .release/brick-*.digest`
3. `python3 scripts/record-image-lock.py universes/univ-base --registry=localhost:5000 --insecure`
4. Insecure registry config required for Podman pull by digest:

   `/etc/containers/registries.conf.d/shaper-local.conf` → `localhost:5000` insecure

Tag used on this host: `v114-gbs`.

## Proof run — partial (stub bridge)

Command: `bash deploy/proof.sh` (no `SHAPER_ALLOW_UNPINNED`, `BRIDGE_OPENCODE_STUB=1`).

| Section | Result |
| --- | --- |
| Vitals (5 bricks) | OK |
| Declared task `task-base-proof` | OK |
| Image lock servable from registry | OK (5/5 digests) |
| Persisted queue answer | OK |
| Artefact byte-exact (#2–#3) | SKIP (not declared) |
| Audit correlated to jobs (#4) | OK |

Exit **0** — closing verdict: proven for what was declared (no artefact).

## Proof run — full functional (live OpenCode, 2026-09-15)

1. **Rule 7 measurement** on the LXC (write-then-reply probe, runbook shape):

   | Candidate | Probe |
   | --- | --- |
   | `opencode/ling-3.0-tiny-free` | server error |
   | `opencode/deepseek-v4-flash-free` | server error |
   | `opencode/laguna-s-2.1-free` | server error |
   | `opencode/nemotron-3.5-lightning-free` | **contract OK** (~50s) |

2. **Cfg**: `OPENCODE_MODEL=opencode/nemotron-3.5-lightning-free`, `BRIDGE_OPENCODE_STUB=0`
3. **Redeploy**: `podman-up.sh` — all layers healthy, bridge `/api/health` OK (non-stub)
4. **Job** `agent.inject` → `job-1789488857952-2`, conversation `proof-v114-full-2`,
   marker `MARKER-V114-GBS` — **COMPLETED**, answer persisted `MARKER-V114-GBS`
5. **Artefact** (host path):

   `…/univ-base/.state/vol-univ-base-opencode-ws/proof-v114-full-2/marker.txt` — 15 bytes, `cmp` OK

6. **Command**:

```bash
PROOF_JOB_ID=job-1789488857952-2 \
PROOF_ANSWER=MARKER-V114-GBS \
PROOF_EXPECTED=MARKER-V114-GBS \
PROOF_ARTIFACT=…/proof-v114-full-2/marker.txt \
bash deploy/proof.sh
```

| Section | Result |
| --- | --- |
| Vitals | OK |
| Task registry | OK |
| Image lock | OK (5/5) |
| Persisted answer (#1) | OK |
| Artefact `cmp` (#2–#3) | OK |
| Audit (#4) | OK (25 events / 9 jobs) |

Exit **0**. Closing line:

> univ-base is proven: every declared brick answered, the declared task is held,
> the job persisted its answer, the declared artefact is byte-exact, and the audit
> trail joins a real job.

## Containers

`univ-base-ctr-vault`, `univ-base-ctr-logger`, `univ-base-ctr-queue`,
`univ-base-ctr-bridge-opencode`, `univ-base-ctr-maestro`, plus `shaper-registry`.

## Bridge Cursor CLI (optional, same LXC — 2026-09-15)

`univ-base` manifest still names **OpenCode only** (free tier for minimal testers).
Cursor is added as a **sidecar** so jobs can opt in with `payload.bridgeUrl`.

| Step | Result |
| --- | --- |
| `cursor-agent` tree under `/opt/cursor-agent/…` (not the `~/.local/bin` symlink) | OK |
| Image `brick-bridge-cursor:v114-gbs` | built + pushed to local registry |
| `cfg-univ-base.env`: `CURSOR_API_KEY`, `CURSOR_MODEL=composer-2.5`, `CURSOR_MODE=normal` | OK |
| Rule 7 probe on LXC | OK |
| Container `univ-base-ctr-bridge-cursor` `:4510` | health OK, stub off |
| Queue job `job-1789490698178-6` with `bridgeUrl` → cursor bridge | **COMPLETED**, exit 0 |
| Artefact `…/vol-univ-base-cursor-ws/proof-cursor-queue/marker.txt` | `MARKER-CURSOR-QUEUE`, cmp OK |

Helper: `deploy/gbs-test-cursor-bridge.sh`.

**Gap (honest):** the queue worker learns terminal answers from `response_complete`
(OpenCode) and `done` (Cursor bridge) does not carry `text`, so `result.answer` stayed
empty even though the run succeeded and the file is correct. Full `proof.sh` on
answer text still wants OpenCode or a bridge that persists the reply.

## Not done on this lot

- Fleet registry `10.213.199.234:5000` alignment (local `:5000` in LXC only)
- `npm run test:live` campaign / multi-engine cold campaign (workplan)
- Git tag `v1.14.4` / GitHub release publish
- Wire `bridge-cursor` into manifest / maestro task schedule (today: manual `bridgeUrl`)
