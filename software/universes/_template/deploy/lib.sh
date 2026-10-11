# Intent: software/universes/_template/INTENT.md#base-units
# Shared by deploy/podman-up.sh and deploy/proof.sh of a universe derived from
# the template. Sourced, never run. The universe is the directory above deploy/.
#
#   UNIV      the universe directory          MANIFEST  its manifest.json
#   BASE      UNIV/base: univ-minimal at one revision (deploy/install-base.sh)
#   ENV_FILE  the universe's variables file (default UNIV/cfg-universe.env),
#             exported so the base's scripts read the same file
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

# ── A variables file is read, never executed ──────────────────────────────────
# `source` EXECUTES every line that is not blank, a comment, or KEY=value: on the
# first night Rule 11 ran in production a human note in a variables file was run
# as a command (docs/proof/proof-rule-11-in-production.md, lesson 7). The two
# functions below are univ-minimal's and univ-base's, verbatim; a test holds
# them and scripts/lib/preflight-checks.mjs to the same grammar.
shaper_env_file_is_variables_only() {
  local file="$1" bad status=0
  # grep -v selects the lines that are NOT admitted. Its exit code is read
  # explicitly rather than hidden behind `|| true`: 1 means no line was
  # selected — the file is clean, the good outcome — and 2 means grep could
  # not read the file, which is a halt of its own, never a pass.
  bad="$(grep -nvE '^[[:space:]]*(#|$)|^[A-Z][A-Z0-9_]*=("([^"`$]|\$[^(])*\$?"|'"'"'[^'"'"']*'"'"'|[^[:blank:];&|()<>`'"'"'"]*)$' "$file")" || status=$?
  if (( status == 1 )); then
    return 0
  elif (( status == 2 )); then
    echo "[podman-up] cannot read $file — a file that cannot be checked is not sourced" >&2
    return 1
  fi
  echo "[podman-up] $file is not a variables file — these lines would be EXECUTED by source, not exported:" >&2
  echo "$bad" | sed 's/^/[podman-up]   line /' >&2
  echo "[podman-up] only blank lines, # comments and KEY=value are allowed, the value quoted or a bare word without whitespace or shell operators; put a note for a human behind #" >&2
  return 1
}
shaper_source_env() {
  shaper_env_file_is_variables_only "$1" || exit 1
  set -a; source "$1"; set +a
}

# The universe's one settings file: no shared default file (software/.env, a
# repository .env) is read — a universe is configured by its own file only.
# SHAPER_UNIVERSE must be the manifest's "universe": one name for the
# directory's declaration and for the units' container names.
load_universe_env() {
  ENV_FILE="${ENV_FILE:-$UNIV/cfg-universe.env}"
  [[ -f "$ENV_FILE" ]] \
    || halt "no settings file $ENV_FILE: copy $UNIV/cfg-universe.env.example to it and set SHAPER_UNIVERSE. Halt."
  shaper_source_env "$ENV_FILE"
  export ENV_FILE
  local declared
  declared="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["universe"])' "$MANIFEST")" \
    || halt "$MANIFEST cannot be read as a manifest. Halt."
  [[ -n "${SHAPER_UNIVERSE:-}" ]] || halt "SHAPER_UNIVERSE is not set in $ENV_FILE: it names the universe ($declared in the manifest). Halt."
  [[ "$SHAPER_UNIVERSE" == "$declared" ]] \
    || halt "SHAPER_UNIVERSE is $SHAPER_UNIVERSE in $ENV_FILE but the manifest declares $declared: one universe, one name. Halt."
}

# ── The earlier template is not adopted ───────────────────────────────────────
# Until the base release the template materialised file stores and an AI bridge
# under UNIV/sav (vault.enc, queue/jobs.jsonl, opencode-*) and named containers
# <universe>-vault, without -ctr-; univ-base, under UNIV/.state/vol-<universe>-*.
# Such a universe keeps the scripts it copied
# and the images it pinned; moving it to the one-container units is a
# migration, a separate decision.
refuse_earlier_template() {  # <universe name>
  local universe="$1" found=() path name
  for path in sav/vault/vault.enc sav/queue sav/opencode-bridge sav/opencode-ws \
              ".state/vol-$universe-vault" ".state/vol-$universe-bridge"; do
    [[ -e "$UNIV/$path" ]] && found+=("$UNIV/$path")
  done
  if command -v podman >/dev/null 2>&1; then
    for name in vault logger queue maestro bridge-opencode; do
      podman container exists "$universe-$name" 2>/dev/null && found+=("container $universe-$name")
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
}

# The universe declares the four base units exactly as the installed base
# births them — image, port, database (slug, uids, schema version, volumes) —
# in the base's boot order, first; any unit it adds comes after them and holds
# its own MariaDB inside its own container (Rules 4 and 26).
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
layers = len(base["bootOrder"])
if universe["bootOrder"][:layers] != base["bootOrder"]:
    problems.append(f"bootOrder: the base's layers {base['bootOrder']} must come first, as they are")
for name, unit in universe["bricks"].items():
    if name in base["bricks"]:
        continue
    db = unit.get("database") or {}
    if db.get("engine") != "mariadb" or db.get("placement") != "in-unit":
        problems.append(f"{name}: a unit of this universe holds its own MariaDB inside its own container (database.engine mariadb, placement in-unit)")
for p in problems:
    print(f"[universe]   {p}", file=sys.stderr)
sys.exit(1 if problems else 0)
PY
}

base_revision() { cut -c1-12 "$BASE/.shaper-revision"; }
