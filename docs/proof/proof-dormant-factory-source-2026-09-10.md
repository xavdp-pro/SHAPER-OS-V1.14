# Explicit image locks and dormant startup — source verification

Date: 2026-09-10. Baseline inspected: `89095b0`. Scope: the generic base image
resolver and `_template/deploy/podman-up.sh`. No deployment, canonical rule
amendment, model choice or image rebuild was performed by this verification.

## Defects and correction

The image resolver described explicit pins but ignored them; the factory always
passed active Queue/Maestro flags and a network-wide bridge bind. Consequently a
consumer could declare digest locks and dormant startup while running different
artifacts and active services.

`SHAPER_IMAGE_LOCK_FILE` now resolves required image keys from a flat JSON map or
its `images` member and requires OCI SHA256 references. An explicitly invalid
lock fails before container operations instead of returning a mutable tag.
Without a lock, existing registry/tag behavior is preserved.

`QUEUE_AUTO_DISPATCH`, `MAESTRO_AUTO_START` and `OPENCODE_BRIDGE_BIND` are preserved
across environment defaults and passed to their actual container arguments.
Explicit flags must be `0` or `1`, and the bind must be an IP address. Invalid
values fail before any container operation. With no supplied values, defaults
remain `1`, `1` and `0.0.0.0` for compatibility.

## Evidence

The new argument-recorder regression runs the real template shell and resolver
against temporary input files. Its recorder substitutes for Podman only to
inspect arguments; curl/sleep are bypassed because no service is started. This
is deliberately a source/argument unit test, never a runtime proof.

- Original four-test corpus on the old source: three failures, one compatibility
  pass. Local log: `/tmp/shaper-dormant-before.log`.
- Same corpus after the fix plus existing environment/registry/halt regressions:
  twelve tests passed.
- Final full base suite: 554 tests passed, no failure or skip.
  Local log: `/tmp/shaper-base-full-after.log`.
- The final new corpus contains six tests, including flat locks, missing files
  and explicit empty exports refusing instead of inheriting active defaults.
- Bash syntax validation and `git diff --check` passed.

These logs are operator-local observations, not committed test artifacts. A fresh-clone release verification remains the deployer's responsibility;
this result was obtained in the active source checkout.

## Runtime acceptance still required

An actual target must inspect the launched image digests, configured flags,
listener and authentication. It must show Queue does not automatically dispatch,
Maestro does not automatically execute tasks, and an explicitly requested bounded
job has a persisted result with Logger correlation. Fresh per-universe Vault
material and a target-measured model remain prerequisites; neither a placeholder
key nor an example model constitutes valid deployment input.

This correction does not implement rollback, dynamic manifest boot execution,
a Vox integration, a production promotion, a matrix or a maker recipe. Those are
separate contracts; shell argument correctness does not satisfy them.

## Additional loopback qualification

The factory also preserves and validates explicit `VAULT_HOST`, `LOGGER_HOST`,
`QUEUE_HOST` and `MAESTRO_HOST` IP addresses. Their existing default remains
`0.0.0.0`; the Vox DEV assembly explicitly selects `127.0.0.1` for all four.
Three further recorder regressions failed before this correction and now pass,
including empty/invalid values refused before any Podman operation. Nine focused
factory tests pass. Actual listener addresses still require target inspection.
