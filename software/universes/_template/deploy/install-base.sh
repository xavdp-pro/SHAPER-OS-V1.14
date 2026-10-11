#!/usr/bin/env bash
# Intent: software/universes/_template/INTENT.md#base-units
# Installs the universe's base units: univ-minimal of SHAPER OS at one revision,
# taken from a checkout with `git archive`, into <universe>/base/.
#
#   deploy/install-base.sh --shaper-repo <SHAPER-OS-V1.14 checkout> --shaper-commit <revision>
#
# base/ is univ-minimal as that revision holds it — the birth of Vault, Logger,
# Queue and Maestro with their identities, the proof, the lifecycle and restore
# drills, the daily bootstrap renewal — less its rehearsal (test/). Its schedule,
# its image lock and its settings are the universe's own:
#
#   base/task-schedule.json   -> ../tasks/task-schedule.json
#   base/cfg-image-lock.json  -> ../cfg-image-lock.json
#   base/cfg-univ-minimal.env -> ../cfg-universe.env
#   base/.shaper-revision        the full revision installed
#
# A previous base/ is kept as base.before-install-<UTC time>. Nothing else is
# written: no settings file, no lock, no volume; nothing is built, pulled,
# registered or started. The revision must contain the qualified base release
# (QUALIFIED_BASE below), and its univ-minimal must declare the four units,
# each with its MariaDB inside its own container, one per layer.
set -euo pipefail

# The base release qualified on a real podman host (11 October 2026: kit proof
# 82/82, base lifecycle drill 78/0, restore drill 33/0). An earlier revision is
# refused: its birth, probes or renewal are the ones that failed there.
QUALIFIED_BASE=e83f73188a804b3144cfe987ccb5e57133be9fab

UNIV="$(cd "$(dirname "$0")/.." && pwd)"
TAG="[install-base]"
# shellcheck source=/dev/null
source "$UNIV/deploy/lib.sh"

SHAPER_REPO="" SHAPER_COMMIT=""
while (( $# )); do
  case "$1" in
    --shaper-repo|--shaper-commit)
      (( $# >= 2 )) || halt "$1 takes a value — install-base.sh --shaper-repo <checkout> --shaper-commit <revision>"
      if [[ "$1" == --shaper-repo ]]; then SHAPER_REPO="$2"; else SHAPER_COMMIT="$2"; fi
      shift 2 ;;
    *) halt "unknown argument $1 — install-base.sh --shaper-repo <checkout> --shaper-commit <revision>" ;;
  esac
done
[[ -n "$SHAPER_REPO" && -n "$SHAPER_COMMIT" ]] \
  || halt "the base units need --shaper-repo <SHAPER-OS-V1.14 checkout> and --shaper-commit <base release revision>"
refuse_the_mold

UNIVERSE="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["universe"])' "$MANIFEST")" \
  || halt "$MANIFEST cannot be read as a manifest. Halt."
refuse_earlier_template "$UNIVERSE"

# ── The revision ────────────────────────────────────────────────────────────
REV="$(git -C "$SHAPER_REPO" rev-parse --verify --quiet "$SHAPER_COMMIT^{commit}")" \
  || halt "no commit '$SHAPER_COMMIT' in $SHAPER_REPO. Halt."
if ! git -C "$SHAPER_REPO" cat-file -e "$QUALIFIED_BASE^{commit}" 2>/dev/null; then
  halt "$SHAPER_REPO does not hold the qualified base release ${QUALIFIED_BASE:0:12}: fetch the base release branch first. Halt."
fi
git -C "$SHAPER_REPO" merge-base --is-ancestor "$QUALIFIED_BASE" "$REV" \
  || halt "${REV:0:12} does not contain the qualified base release ${QUALIFIED_BASE:0:12}: its base units are not the ones qualified. Halt."

TREE=software/universes/univ-minimal
for f in manifest.json deploy/podman-up.sh deploy/unit-probes.sh deploy/proof.sh deploy/proof-effects.sh \
         deploy/proof-effects-units.sh deploy/lifecycle-drill.sh deploy/restore-drill.sh \
         deploy/renew-bootstraps.sh deploy/install-renewal-timer.sh \
         systemd/bootstrap-renewal.service.in systemd/bootstrap-renewal.timer.in; do
  git -C "$SHAPER_REPO" cat-file -e "$REV:$TREE/$f" 2>/dev/null \
    || halt "the base at ${REV:0:12} has no $TREE/$f. Halt."
done
git -C "$SHAPER_REPO" show "$REV:$TREE/manifest.json" | python3 -c '
import json, sys
m = json.load(sys.stdin)
want = [["brick-vault"], ["brick-logger"], ["brick-queue"], ["brick-maestro"]]
order = m["bootOrder"]
if order != want or sorted(m["bricks"]) != sorted(b[0] for b in want):
    sys.exit(f"the base manifest declares {order}, not {want}")
for name, unit in m["bricks"].items():
    db = unit.get("database") or {}
    if db.get("engine") != "mariadb" or db.get("placement") != "in-unit" or db.get("slug") != name[len("brick-"):]:
        sys.exit(f"{name}: no MariaDB of its own inside its unit")
' || halt "the base at ${REV:0:12} is not the four one-container units. Halt."

# ── Staged beside base/, then put in place ──────────────────────────────────
STAGE="$(mktemp -d "$UNIV/.base-install.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
git -C "$SHAPER_REPO" archive --format=tar "$REV:$TREE" | tar -C "$STAGE" -xf -
rm -rf "$STAGE/test"
rm -f "$STAGE/task-schedule.json" "$STAGE/cfg-image-lock.json" "$STAGE/cfg-univ-minimal.env"
ln -s ../tasks/task-schedule.json "$STAGE/task-schedule.json"
ln -s ../cfg-image-lock.json "$STAGE/cfg-image-lock.json"
ln -s ../cfg-universe.env "$STAGE/cfg-univ-minimal.env"
printf '%s\n' "$REV" > "$STAGE/.shaper-revision"
chmod 0755 "$STAGE"

if [[ -e "$UNIV/base" || -L "$UNIV/base" ]]; then
  # A name of its own, even for two installs in the same second; -T never
  # moves base/ into an existing directory.
  STEM="$UNIV/base.before-install-$(date -u +%Y%m%dT%H%M%SZ)"
  KEPT="$STEM"; n=1
  while [[ -e "$KEPT" || -L "$KEPT" ]]; do KEPT="$STEM-$n"; n=$((n + 1)); done
  mv -T "$UNIV/base" "$KEPT"
  echo "$TAG the previous base/ is kept as $KEPT"
fi
mv -T "$STAGE" "$UNIV/base"
trap - EXIT
echo "$TAG $UNIVERSE: base units = univ-minimal at ${REV:0:12} in $UNIV/base"
echo "$TAG next: cfg-universe.env (from cfg-universe.env.example), the image lock, then bash $UNIV/deploy/podman-up.sh"
