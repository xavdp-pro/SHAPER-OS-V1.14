# Intent: software/universes/_template/INTENT.md#base-units
# Shared by deploy/podman-up.sh and deploy/proof.sh of a universe derived from
# the template. Sourced, never run. The universe is the directory above deploy/.
#
#   UNIV      the universe directory          MANIFEST  its manifest.json
#   BASE      UNIV/base: univ-minimal at one revision (deploy/install-base.sh)
#   ENV_FILE  the universe's settings file (default UNIV/cfg-universe.env),
#             handed to the base's scripts so they read the same file
UNIV="${UNIV:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
MANIFEST="$UNIV/manifest.json"
BASE="$UNIV/base"
TAG="${TAG:-[universe]}"

halt() { echo "$TAG $*" >&2; exit 1; }

# The template is a mold: it is copied to its own directory, never run in place.
refuse_the_mold() {
  [[ "$(basename "$UNIV")" != _template ]] \
    || halt "$UNIV is the template itself: copy it to the universe's own directory (outside this repository) and run it there. Halt."
}

# ── The settings are read, never executed ─────────────────────────────────────
# `source` EXECUTES every line that is not blank, a comment, or KEY=value: on the
# first night Rule 11 ran in production a human note in a variables file was run
# as a command (docs/proof/proof-rule-11-in-production.md, lesson 7). The
# universe's settings file is the base's (base/cfg-univ-minimal.env links to it),
# so the base's own declarative reader reads it here too — base/deploy/settings.sh
# at the revision installed (univ-minimal INTENT.md#settings): only the base's
# parameters, no secret, no executable syntax, no key twice, the inherited
# environment held to the same catalogue. Nothing is sourced or exported; the
# base's scripts receive an environment built explicitly (base_script).
#
# The universe's one settings file: no shared default file (software/.env, a
# repository .env) is read — a universe is configured by its own file only.
# SHAPER_UNIVERSE must be the manifest's "universe": one name for the
# directory's declaration and for the units' container names.
load_universe_env() {
  ENV_FILE="${ENV_FILE:-$UNIV/cfg-universe.env}"
  [[ -f "$ENV_FILE" ]] \
    || halt "no settings file $ENV_FILE: copy $UNIV/cfg-universe.env.example to it and set SHAPER_UNIVERSE. Halt."
  [[ -f "$BASE/deploy/settings.sh" ]] \
    || halt "no base units in $BASE with a settings reader (base/deploy/settings.sh): run deploy/install-base.sh --shaper-repo <SHAPER-OS checkout> --shaper-commit <base release> first. Halt."
  # shellcheck source=/dev/null
  source "$BASE/deploy/settings.sh"
  shaper_settings_load "$TAG" || exit 1
  # What a base script receives: the settings, ENV_FILE, and the run knobs the
  # operator gave this run (PODMAN_UP_RECREATE, RESTORE_DUMP_<slug>, …).
  shaper_settings_child_env --with-run
  local declared
  declared="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["universe"])' "$MANIFEST")" \
    || halt "$MANIFEST cannot be read as a manifest. Halt."
  [[ -n "${SHAPER_UNIVERSE:-}" ]] || halt "SHAPER_UNIVERSE is not set in $ENV_FILE: it names the universe ($declared in the manifest). Halt."
  [[ "$SHAPER_UNIVERSE" == "$declared" ]] \
    || halt "SHAPER_UNIVERSE is $SHAPER_UNIVERSE in $ENV_FILE but the manifest declares $declared: one universe, one name. Halt."
}

# base_script <script> [argument]...: one of the base's scripts, in an
# environment built explicitly (load_universe_env): nothing else this shell
# inherited reaches it.
base_script() { env -i "${SHAPER_CHILD_ENV[@]}" bash "$BASE/deploy/$1" "${@:2}"; }

# ── The earlier template is not adopted ───────────────────────────────────────
# Until the base release the template materialised file stores and an AI bridge
# under UNIV/sav (vault.enc, queue/jobs.jsonl, opencode-*) and named containers
# <slug>-vault, without -ctr- (the slug was UNIV_SLUG or the directory's name);
# univ-base kept its volumes under UNIV/.state/vol-<name>-*. Such a universe
# keeps the scripts it copied and the images it pinned; moving it to the
# one-container units is a migration, a separate decision.
refuse_earlier_template() {  # <universe name>
  local found=() path name prefix
  for path in sav/vault/vault.enc sav/queue sav/opencode-bridge sav/opencode-ws "$UNIV"/.state/vol-*-vault "$UNIV"/.state/vol-*-bridge; do
    path="${path#"$UNIV"/}"
    [[ -e "$UNIV/$path" ]] && found+=("$UNIV/$path")
  done
  if command -v podman >/dev/null 2>&1; then
    for prefix in $(printf '%s\n' "$1" "$(basename "$UNIV")" | sort -u); do
      for name in vault logger queue maestro bridge-opencode; do
        podman container exists "$prefix-$name" 2>/dev/null && found+=("container $prefix-$name")
      done
    done
  fi
  (( ${#found[@]} == 0 )) && return 0
  echo "$TAG this universe has the earlier template's shape (file stores, an AI bridge):" >&2
  printf '%s   %s\n' "$TAG" "${found[@]}" >&2
  echo "$TAG it keeps the scripts it copied and the images it pinned; moving it to the one-container units is a migration, a separate decision (INTENT.md#earlier-template). Nothing was changed. Halt." >&2
  exit 1
}

# ── The base units: univ-minimal at one revision, installed in base/ ──────────
check_base_layout() {
  [[ -s "$BASE/.shaper-revision" && -f "$BASE/deploy/podman-up.sh" && -f "$BASE/manifest.json" ]] \
    || halt "no base units in $BASE: run deploy/install-base.sh --shaper-repo <SHAPER-OS checkout> --shaper-commit <base release> first. Halt."
  local link want
  for link in task-schedule.json:tasks/task-schedule.json cfg-image-lock.json:cfg-image-lock.json; do
    want="$UNIV/${link#*:}"
    [[ "$(readlink -f "$BASE/${link%%:*}")" == "$(readlink -f "$want")" && -f "$want" ]] \
      || halt "$BASE/${link%%:*} is not the universe's own $want: one schedule, one lock (reinstall with deploy/install-base.sh). Halt."
  done
  # What a base script reads when nobody names ENV_FILE: the universe's own
  # settings file, never a file of base/ that would default to univ-minimal.
  [[ -L "$BASE/cfg-univ-minimal.env" && "$(readlink -f "$BASE/cfg-univ-minimal.env")" == "$(readlink -f "$UNIV/cfg-universe.env")" ]] \
    || halt "$BASE/cfg-univ-minimal.env is not a link to the universe's own cfg-universe.env (reinstall with deploy/install-base.sh). Halt."
}

# The universe declares the four base units exactly as the installed base
# births them — image, port, database (slug, uids, schema version, volumes) —
# in the base's boot order, and nothing else: the template does not yet start
# or prove a unit a universe adds, so declaring one is refused rather than
# accepted and silently never started (INTENT.md#materialise).
check_base_units_agree() {
  python3 - "$MANIFEST" "$BASE/manifest.json" "$(cut -c1-12 "$BASE/.shaper-revision")" <<'PY' || halt "the manifest and the installed base disagree (above). Halt."
import json, sys
universe, base, rev = json.load(open(sys.argv[1])), json.load(open(sys.argv[2])), sys.argv[3]
problems = []
for name, unit in base["bricks"].items():
    mine = universe["bricks"].get(name)
    if mine is None:
        problems.append(f"{name}: the base at {rev} births it; the manifest does not declare it")
        continue
    for key in ("image", "port", "database"):
        if mine.get(key) != unit.get(key):
            problems.append(f"{name}.{key}: the manifest declares {json.dumps(mine.get(key))}, the base at {rev} births {json.dumps(unit.get(key))}")
if universe["bootOrder"] != base["bootOrder"]:
    problems.append(f"bootOrder: the manifest declares {universe['bootOrder']}, the base at {rev} births {base['bootOrder']}")
for name in universe["bricks"]:
    if name not in base["bricks"]:
        problems.append(f"{name}: the template does not yet start or prove a unit the universe adds; declare only the base units")
for p in problems:
    print(f"[universe]   {p}", file=sys.stderr)
sys.exit(1 if problems else 0)
PY
}

base_revision() { cut -c1-12 "$BASE/.shaper-revision"; }
