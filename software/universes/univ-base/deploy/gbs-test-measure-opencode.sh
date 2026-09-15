#!/usr/bin/env bash
# Intent: software/universes/univ-base/INTENT.md#proof
# Rule 7: probe free OpenCode models from this host and write OPENCODE_MODEL into cfg.
set -euo pipefail

UNIV="$(cd "$(dirname "$0")/.." && pwd)"
CFG="$UNIV/cfg-univ-base.env"
export SHAPER_REGISTRY="${SHAPER_REGISTRY:-localhost:5000}"
export SHAPER_IMAGE_TAG="${SHAPER_IMAGE_TAG:-v114-gbs}"
IMG="$SHAPER_REGISTRY/shaper/brick-bridge-opencode:$SHAPER_IMAGE_TAG"

probe_one() {
  local cand="$1"
  local probe_dir
  probe_dir="$(mktemp -d)"
  if timeout 180 podman run --rm --tls-verify=false \
    -v "$probe_dir:/probe" -w /probe --entrypoint opencode "$IMG" \
    run --pure --model "$cand" \
    "Write the exact text PROBE-OK, with no trailing newline, into marker.txt. Then reply with exactly PROBE-OK and nothing else." \
    >/dev/null 2>&1 \
    && printf '%s' PROBE-OK | cmp -s - "$probe_dir/marker.txt"; then
    rm -rf "$probe_dir"
    echo "$cand"
    return 0
  fi
  rm -rf "$probe_dir"
  return 1
}

candidates=(
  opencode/nemotron-3.5-lightning-free
  opencode/deepseek-v4-flash-free
  opencode/laguna-s-2.1-free
  opencode/ling-3.0-tiny-free
  opencode/mimo-v2.5-free
)

picked=""
for c in "${candidates[@]}"; do
  echo "[measure] probing $c ..."
  if picked="$(probe_one "$c")"; then
    echo "[measure] contract OK: $picked"
    break
  fi
  echo "[measure] $c failed the write-then-reply contract"
done

if [[ -z "$picked" ]]; then
  echo "[measure] no model passed — leave BRIDGE_OPENCODE_STUB=1 or fix outbound access" >&2
  exit 1
fi

python3 - "$CFG" "$picked" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
model = sys.argv[2]
lines = p.read_text().splitlines() if p.exists() else []
out, seen_o, seen_s = [], False, False
for line in lines:
    if line.startswith("OPENCODE_MODEL="):
        out.append(f"OPENCODE_MODEL={model}")
        seen_o = True
    elif line.startswith("BRIDGE_OPENCODE_STUB="):
        out.append("BRIDGE_OPENCODE_STUB=0")
        seen_s = True
    else:
        out.append(line)
if not seen_o:
    out.append(f"OPENCODE_MODEL={model}")
if not seen_s:
    out.append("BRIDGE_OPENCODE_STUB=0")
p.write_text("\n".join(out) + "\n")
PY

echo "[measure] wrote OPENCODE_MODEL=$picked and BRIDGE_OPENCODE_STUB=0 to $CFG"
