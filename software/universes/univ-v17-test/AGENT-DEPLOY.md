# AGENT-DEPLOY — univ-v17-test

> **Audience**: autonomous deploy agent only — not a human installer and not the runtime AI.
> **Lifecycle**: TEST.

## Mission

Materialize and prove the exact state declared by `manifest.json` inside the fresh `univ-v17-test` LXC. Treat commands and scripts as materialization mechanisms only; never use them as a substitute for the authority chain.

## Mandatory read order

1. `INTENT.md`
2. `../../docs/PERIMETERS.md`
3. `manifest.json`
4. This file
5. `../../topology.json`
6. Every brick `intent` referenced by the manifest

Stop if a requested action contradicts an invariant or if a referenced intent/path is absent.

## Autonomous capabilities

The deploy agent MAY:

1. Inspect the LXC, Podman, repository commit, network, resources, and local service state.
2. Generate TEST-only values for `VAULT_MASTER_KEY`, `VAULT_TOKEN`, and bridge authentication in ignored files inside the LXC.
3. Copy the development Vault resource example to the ignored `../../resources/vault-resources.local.json`; it may not introduce production data.
4. Run the repository unit tests and this universe's contract/live tests.
5. Build only the five images referenced by the manifest and tag each `localhost/shaper-<brick>:v1.7.1-<git-short-sha>`.
6. Discover free models with the OpenCode CLI in the built bridge image, select one that answers a real ping, and write only its non-secret name to `deploy/env`.
7. Start services with `deploy/podman-up.sh`, observe `bootOrder`, inspect logs, and repair repository defects with regression tests when the clean-sheet proof exposes them.
8. Export sanitized evidence to `proof/` and to the `gbs-test` parent before destroying the TEST LXC.

## Forbidden

The deploy agent MUST NOT:

1. Use a production secret, mailbox, Vault file, tunnel token, or production data.
2. Set `BRIDGE_OPENCODE_STUB=1`, fake an agent completion, or call a health response a functional proof.
3. Expose an LXC or Podman port publicly, enable Helm/tunnel, or create a public proxy.
4. Deploy a SHAPER image tagged `latest`, build a brick absent from the manifest, or copy package/Containerfile implementations into this universe.
5. print, commit, or export secret values.
6. Leave the TEST LXC running after all evidence has been exported and the parent verdict is recorded.

## Materialization protocol

1. Validate manifest paths, environment=`test`, brick set, boot graph, and absence of public exposure.
2. Check out the requested branch and record `git rev-parse HEAD`; derive `SHAPER_IMAGE_TAG=v1.7.1-$(git rev-parse --short HEAD)`.
3. Generate ignored TEST configuration and run `npm test` plus `npm test` in this universe.
4. Build the five manifest images with the immutable tag. Record image IDs and digests.
5. Discover and ping a real free OpenCode model. Record the model name and redacted result.
6. Start each boot layer and require all earlier health checks before proceeding.
7. Run the live suite, then inject one distinctive job through Queue. Require a real terminal state, non-empty agent answer, and correlated logger evidence.
   Verify the resulting artifact independently and byte-for-byte when the goal
   is byte-exact. Shell command substitution strips trailing newlines, so
   `test "$(cat file)" = value` cannot prove their presence or absence; use
   `cmp` against explicitly generated expected bytes.
8. Capture resource vitals and sanitized logs. Write the parent verdict.
9. Stop/remove the Podman containers, export `proof/`, then destroy `univ-v17-test` from `gbs-test`.

## Success criteria

- Repository and universe contract tests are green.
- Five immutable-tag containers are healthy in manifest boot order.
- OpenCode is not stubbed and a discovered free model answers.
- A queued job reaches a real terminal state with an answer and audit evidence.
- Sanitized evidence survives on `gbs-test`; the TEST LXC no longer exists.

## Model-selection obligation

The free catalogue and provider capacity are rotating runtime state. At every
TEST deployment, the agent MUST:

1. discover the current catalogue with the embedded CLI;
2. treat public tokens/second leaderboards as advisory observations only;
3. run a bounded local ping from the target LXC;
4. select the fastest candidate that actually answers locally, recording
   time-to-first-response, failure/timeout, and observation timestamp;
5. never keep a benchmark winner as default when it times out on the target.

Observed on `gbs-test` on 25 August 2026: the public leaderboard placed
`opencode/nemotron-3.5-lightning-free` first, but two bounded local attempts
produced no response; `opencode/mimo-v2.5-free` returned a valid marker and was
therefore selected for this TEST run. This is an observation, not a permanent
model ranking.
