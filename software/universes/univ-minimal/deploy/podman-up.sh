#!/usr/bin/env bash
# Intent: software/universes/univ-minimal/INTENT.md#private-mariadb
# Materialises univ-minimal — Vault, Logger, Queue and Maestro — inside the
# universe container: one container per unit, holding the application and its
# own MariaDB server (Rules 4 and 26, Turbinobash method).
#
# It does only what the manifest declares, in the order bootOrder states, from
# the images the lock (or an explicitly published tag) names. Each unit image
# births its own database through its own root path (runtime/unit-mariadb);
# this script prepares the unit's three volumes, the Vault's key material, and
# waits for each unit's readiness, which is gated on its MariaDB.
#
# Names follow docs/architecture/NAMING.md, prefixed by the instance slug:
#   <universe>-ctr-<slug>          the unit: its application and its MariaDB
# There is no <universe>-ctr-<slug>-mariadb any more; one found is refused.
set -euo pipefail

UNIV="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$UNIV/manifest.json"
LOCK="$UNIV/cfg-image-lock.json"

# ── 1. Configuration: a variables file is read, never executed ─────────────
shaper_env_file_is_variables_only() {
  local file="$1" bad status=0
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
if [[ -n "${ENV_FILE:-}" && -f "$ENV_FILE" ]]; then
  shaper_source_env "$ENV_FILE"
elif [[ -f "$UNIV/cfg-univ-minimal.env" ]]; then
  shaper_source_env "$UNIV/cfg-univ-minimal.env"
fi

for tool in podman jq openssl ss; do
  command -v "$tool" >/dev/null || { echo "[podman-up] $tool is missing in the universe container — install it at first boot" >&2; exit 1; }
done

UNIVERSE="${SHAPER_UNIVERSE:-univ-minimal}"
APPS_ROOT="${SHAPER_APPS_ROOT:-/apps}"
[[ "$UNIVERSE" =~ ^univ-[a-z0-9]+(-[a-z0-9]+)*$ ]] || { echo "[podman-up] SHAPER_UNIVERSE must be an instance slug (univ-…), got $UNIVERSE" >&2; exit 1; }

# ── 2. Images: pinned, or explicitly published, never guessed ───────────────
# SHAPER_REGISTRY=localhost with SHAPER_IMAGE_TAG names images built on this
# machine with SHAPER_PUSH=0 — a DEV qualification only, never a TEST or PROD.
resolve_image() {
  local key="$1" pinned
  pinned="$(jq -r --arg k "$key" '.images[$k] // empty' "$LOCK")"
  if [[ -n "$pinned" ]]; then echo "$pinned"; return; fi
  if [[ -n "${SHAPER_REGISTRY:-}" && -n "${SHAPER_IMAGE_TAG:-}" ]]; then
    echo "${SHAPER_REGISTRY}/shaper/brick-${key#img-}:${SHAPER_IMAGE_TAG}"; return
  fi
  echo "[podman-up] $key is not pinned in cfg-image-lock.json and no SHAPER_REGISTRY/SHAPER_IMAGE_TAG is set." >&2
  echo "[podman-up] The registry is an infrastructure prerequisite, one per machine — ask the operator which one this machine uses." >&2
  exit 1
}

# ── 3. The declared ports are free, or held by this universe's own units ────
while read -r brick port; do
  slug="$(jq -r --arg b "$brick" '.bricks[$b].database.slug' "$MANIFEST")"
  if ss -ltnH "sport = :$port" | grep -q .; then
    if ! podman ps --format '{{.Names}}' | grep -qx "${UNIVERSE}-ctr-${slug}"; then
      echo "[podman-up] port $port declared by $brick is held by something that is not ${UNIVERSE}-ctr-${slug} — stop and disable it; no second port is invented" >&2
      ss -ltnpH "sport = :$port" >&2 || true
      exit 1
    fi
  fi
done < <(jq -r '.bricks | to_entries[] | "\(.key) \(.value.port)"' "$MANIFEST")

# ── 4. The shape: one container per unit, nothing beside it ─────────────────
while read -r slug; do
  if podman container exists "${UNIVERSE}-ctr-${slug}-mariadb"; then
    echo "[podman-up] ${UNIVERSE}-ctr-${slug}-mariadb exists: a separate database container, the shape Rule 4 forbids." >&2
    echo "[podman-up] Migrate it with a logical dump into the unit's fresh volume (INTENT.md#migration); this script never adopts it. Halt." >&2
    exit 1
  fi
done < <(jq -r '.bricks[].database.slug' "$MANIFEST")

# ── 5. Instance secrets the construction path owns ──────────────────────────
# The API token and the master key live under the Vault's etc/vault/, which is
# never mounted as a directory: the container receives the key file alone,
# read-only, and the token through its environment.
VAULT_UID="$(jq -r '.bricks["brick-vault"].database.uid' "$MANIFEST")"
VAULT_ETC="$APPS_ROOT/vault/etc/vault"
install -d -m 0755 -o root -g root "$APPS_ROOT" "$APPS_ROOT/vault" "$APPS_ROOT/vault/etc"
install -d -m 0700 -o root -g root "$VAULT_ETC"
TOKEN_FILE="$VAULT_ETC/api-token"
if [[ ! -s "$TOKEN_FILE" ]]; then
  ( umask 077; openssl rand -hex 32 > "$TOKEN_FILE" )
fi
chmod 0600 "$TOKEN_FILE"
VAULT_TOKEN="$(<"$TOKEN_FILE")"

KEY_FILE="$VAULT_ETC/master.key"
if [[ ! -s "$KEY_FILE" ]]; then
  if [[ -d "$APPS_ROOT/vault/sav/mariadb/vault" ]]; then
    echo "[podman-up] the Vault database exists but its master key $KEY_FILE does not." >&2
    echo "[podman-up] Restore the key from the operator's key material; a new key would orphan every secret. Halt." >&2
    exit 1
  fi
  ( umask 077; openssl rand -hex 32 > "$KEY_FILE" )
  echo "[podman-up] Vault master key generated for a Vault being born ($KEY_FILE)"
fi
# The key belongs to the account that reads it, and to nobody else.
chown "$VAULT_UID:$VAULT_UID" "$KEY_FILE"; chmod 0400 "$KEY_FILE"

# ── 6. Units, layer by layer, in the declared bootOrder ─────────────────────
port_of() { jq -r --arg b "brick-$1" '.bricks[$b].port' "$MANIFEST"; }
LOGGER_URL="http://127.0.0.1:$(port_of logger)"
QUEUE_URL="http://127.0.0.1:$(port_of queue)"

# What each unit needs beyond its database — declared once, here.
unit_args() {
  local slug="$1" port="$2"
  case "$slug" in
    vault)
      echo "-e VAULT_PORT=$port -e VAULT_MASTER_KEY_FILE=/apps/vault/etc/vault/master.key -e VAULT_TOKEN"
      echo "-v $KEY_FILE:/apps/vault/etc/vault/master.key:ro,Z"
      ;;
    logger)
      echo "-e LOGGER_PORT=$port"
      ;;
    queue)
      echo "-e QUEUE_PORT=$port -e LOGGER_URL=$LOGGER_URL -e QUEUE_AUTO_DISPATCH=0"
      ;;
    maestro)
      echo "-e MAESTRO_PORT=$port -e MAESTRO_AUTO_START=1 -e LOGGER_URL=$LOGGER_URL -e MAESTRO_QUEUE_URL=$QUEUE_URL"
      echo "-e MAESTRO_TASKS_FILE=/apps/maestro/etc/task-schedule.json"
      echo "-v $UNIV/task-schedule.json:/apps/maestro/etc/task-schedule.json:ro,Z"
      ;;
    *) echo "[podman-up] no runtime wiring declared for unit $slug" >&2; return 1 ;;
  esac
}

# The unit's three volumes: its password (etc/mysql), its datadir and dumps
# (sav), its log. Single directories only — the unit's supervisor converges the
# rest from inside, and nothing here changes ownership recursively.
prepare_volumes() {
  local slug="$1" uid="$2" engine="$3" owner
  install -d -m 0755 -o root -g root "$APPS_ROOT/$slug" "$APPS_ROOT/$slug/etc" "$APPS_ROOT/$slug/etc/mysql" "$APPS_ROOT/$slug/sav"
  install -d -m 0750 -o "$uid" -g "$uid" "$APPS_ROOT/$slug/log"
  if [[ -d "$APPS_ROOT/$slug/sav/mariadb" ]]; then
    owner="$(stat -c %u "$APPS_ROOT/$slug/sav/mariadb")"
    if [[ "$owner" != "$engine" ]]; then
      echo "[podman-up] $APPS_ROOT/$slug/sav/mariadb belongs to uid $owner; the $slug image's engine account is $engine." >&2
      echo "[podman-up] It is a datadir of another shape or image. Move it aside and restore its logical dump (INTENT.md#migration); no recursive chown is made. Halt." >&2
      exit 1
    fi
  fi
}

wait_ready() {
  local slug="$1" ctr="${UNIVERSE}-ctr-$1" tries=180 state
  while (( tries-- )); do
    if podman exec "$ctr" unit-ready >/dev/null 2>&1; then
      echo "  OK   $slug — $(podman exec "$ctr" unit-ready 2>/dev/null)"
      return 0
    fi
    state="$(podman inspect -f '{{.State.Status}}' "$ctr" 2>/dev/null || echo absent)"
    if [[ "$state" != running ]]; then
      echo "  FAIL $slug — container $state" >&2
      podman logs --tail 40 "$ctr" >&2 || true
      return 1
    fi
    sleep 1
  done
  echo "  FAIL $slug — not ready after 180s: $(podman exec "$ctr" unit-ready 2>&1)" >&2
  podman logs --tail 40 "$ctr" >&2 || true
  return 1
}

export VAULT_TOKEN
layer=0
while read -r bricks; do
  echo "[podman-up] layer $layer — $bricks"
  for brick in $bricks; do
    db="$(jq -c --arg b "$brick" '.bricks[$b].database' "$MANIFEST")"
    slug="$(jq -r '.slug' <<<"$db")"; uid="$(jq -r '.uid' <<<"$db")"; engine="$(jq -r '.engineUid' <<<"$db")"
    port="$(jq -r --arg b "$brick" '.bricks[$b].port' "$MANIFEST")"
    image="$(resolve_image "$(jq -r --arg b "$brick" '.bricks[$b].image' "$MANIFEST")")"
    [[ "$(jq -r '.engine' <<<"$db")" == mariadb && "$(jq -r '.placement' <<<"$db")" == in-unit ]] \
      || { echo "[podman-up] $brick declares no MariaDB inside its own container — Rules 4 and 26 forbid starting it" >&2; exit 1; }

    podman pull -q "$image" >/dev/null 2>&1 || podman image exists "$image" \
      || { echo "[podman-up] image $image is neither pullable nor present" >&2; exit 1; }
    label="$(podman image inspect -f '{{index .Labels "org.shaper.unit.slug"}}:{{index .Labels "org.shaper.unit.uid"}}:{{index .Labels "org.shaper.unit.engine-uid"}}' "$image")"
    [[ "$label" == "$slug:$uid:$engine" ]] \
      || { echo "[podman-up] $image declares unit $label; the manifest declares $slug:$uid:$engine" >&2; exit 1; }

    prepare_volumes "$slug" "$uid" "$engine"

    # A restore into a fresh volume: RESTORE_DUMP_<slug>=/apps/<slug>/sav/restore/<file>.sql
    restore_var="RESTORE_DUMP_${slug}"
    restore=()
    [[ -n "${!restore_var:-}" ]] && restore=(-e "UNIT_RESTORE_DUMP=${!restore_var}")

    # shellcheck disable=SC2046
    podman run -d --name "${UNIVERSE}-ctr-${slug}" --replace --network host --restart=always \
      --stop-timeout 90 \
      --cap-drop=all --cap-add=CHOWN,DAC_OVERRIDE,FOWNER,KILL,SETGID,SETUID \
      --security-opt=no-new-privileges \
      --health-cmd=/usr/local/bin/unit-ready --health-interval=15s --health-retries=3 --health-start-period=180s \
      -e HOST=127.0.0.1 -e SHAPER_UNIVERSE_ID="$UNIVERSE" \
      -e UNIT_HEALTH_URL="http://127.0.0.1:$port/api/health" \
      "${restore[@]}" \
      -v "$APPS_ROOT/$slug/etc/mysql:/apps/$slug/etc/mysql:Z" \
      -v "$APPS_ROOT/$slug/sav:/apps/$slug/sav:Z" \
      -v "$APPS_ROOT/$slug/log:/apps/$slug/log:Z" \
      $(unit_args "$slug" "$port") \
      "$image" >/dev/null
  done
  for brick in $bricks; do
    wait_ready "$(jq -r --arg b "$brick" '.bricks[$b].database.slug' "$MANIFEST")"
  done
  layer=$((layer + 1))
done < <(jq -r '.bootOrder[] | join(" ")' "$MANIFEST")

echo "[podman-up] $UNIVERSE is up. Prove it: bash $UNIV/deploy/proof.sh"
