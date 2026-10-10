#!/usr/bin/env bash
# Intent: software/universes/univ-minimal/INTENT.md#proof
# Sourced by proof.sh, lifecycle-drill.sh and restore-drill.sh, definitions
# only: how a unit is observed from outside — through podman, as root or as one
# of the unit's two accounts, inside the unit's own container. Every probe
# fails closed: what cannot be read is not counted as absent.

# Root path into a unit's database: the local client, as OS root, by
# unix_socket, inside the unit's own container. Queries only (-e): no -i, so a
# probe never reads the caller's standard input.
#   rootsql <slug> [database] -e <sql>
rootsql() { local s="$1"; shift; podman exec "${UNIVERSE}-ctr-$s" mariadb --no-defaults -S "/run/$s/mysqld.sock" -uroot -N -B "$@"; }

# The container's processes, read from /proc inside it: pid, ppid, uid, comm,
# args, and whether the process descends from the unit supervisor.
UNIT_PROCESSES_JS='
const fs = require("fs");
const procs = new Map();
for (const d of fs.readdirSync("/proc")) {
  if (!/^\d+$/.test(d) || Number(d) === process.pid) continue;
  try {
    const status = fs.readFileSync(`/proc/${d}/status`, "utf8");
    procs.set(Number(d), {
      pid: Number(d),
      ppid: Number(/^PPid:\s+(\d+)/m.exec(status)[1]),
      uid: Number(/^Uid:\s+(\d+)/m.exec(status)[1]),
      comm: fs.readFileSync(`/proc/${d}/comm`, "utf8").trim(),
      args: fs.readFileSync(`/proc/${d}/cmdline`, "utf8").split("\0").filter(Boolean).join(" "),
    });
  } catch {}
}
const supervisor = [...procs.values()].find((p) => p.args.includes("unit-mariadb/supervisor.mjs"));
for (const p of procs.values()) {
  let q = procs.get(p.ppid), under = false;
  for (let hops = 0; q && hops < 64; hops += 1, q = procs.get(q.ppid)) if (supervisor && q.pid === supervisor.pid) { under = true; break; }
  p.underSupervisor = under;
}
process.stdout.write(JSON.stringify([...procs.values()]));
'
unit_processes() { podman exec "$1" node -e "$UNIT_PROCESSES_JS" 2>/dev/null || echo '[]'; }

# Listening TCP sockets held by mariadbd, matched by inode against its own file
# descriptors — read as the engine uid, which may read them; an unreadable fd
# table answers "unknown", never 0.
ENGINE_LISTENERS_JS='
const fs = require("fs");
const pid = Number(fs.readFileSync(process.argv[1], "utf8").trim());
const inodes = new Set();
for (const fd of fs.readdirSync(`/proc/${pid}/fd`)) {
  try { const m = /^socket:\[(\d+)\]$/.exec(fs.readlinkSync(`/proc/${pid}/fd/${fd}`)); if (m) inodes.add(m[1]); } catch {}
}
if (inodes.size === 0) { process.stdout.write("unknown"); process.exit(0); }
let listening = 0;
for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
  for (const line of fs.readFileSync(table, "utf8").split("\n").slice(1)) {
    const c = line.trim().split(/\s+/);
    if (c[3] === "0A" && inodes.has(c[9])) listening += 1;
  }
}
process.stdout.write(String(listening));
'
engine_tcp_listeners() {
  local ctr="$1" engine="$2" s="${1#"${UNIVERSE}"-ctr-}"
  podman exec --user "$engine" "$ctr" node -e "$ENGINE_LISTENERS_JS" "/run/$s/mysqld.pid" 2>/dev/null || echo unknown
}

# The application path: as the unit's uid, inside its container, the password
# read there from the unit's own file into the client's environment.
#   app_sql <ctr> <slug> <uid> <database-or-empty> <sql>
app_sql() {
  podman exec --user "$3" "$1" sh -c \
    'MYSQL_PWD="$(cat "/apps/$1/etc/mysql/localhost/passwd")" exec mariadb --no-defaults -S "/run/$1/mysqld.sock" -u "$1" -N -B ${2:+--database="$2"} -e "$3"' \
    _ "$2" "$4" "$5" 2>&1
}

# Another unit's credential, presented to this unit's server: the password on
# standard input, never on a command line.
#   foreign_sql <ctr> <slug> <uid> <other-slug> <other-passwd-file>
foreign_sql() {
  podman exec -i --user "$3" "$1" sh -c \
    'read -r pw; MYSQL_PWD="$pw" exec mariadb --no-defaults -S "/run/$1/mysqld.sock" -u "$2" -N -B -e "SELECT 1"' \
    _ "$2" "$4" < "$5" 2>&1
}

# Paths the unit's uid could modify, by access(2) inside its container.
#   app_writable <ctr> <uid> <path>...
app_writable() {
  local ctr="$1" uid="$2"; shift 2
  podman exec --user "$uid" "$ctr" sh -c 'for p; do [ -e "$p" ] || { echo "$p(absent)"; continue; }; [ -w "$p" ] && echo "$p"; done; true' _ "$@" 2>&1 | paste -sd' '
}

# Predicates over unit_processes' JSON.
probe_supervisor_root() {  # <procs-json>
  [[ "$(jq -r '[.[] | select(.args | contains("unit-mariadb/supervisor.mjs")) | "\(.uid):\(.ppid)"] | join(",")' <<<"$1")" == "0:1" ]] \
    && [[ "$(jq -r '.[] | select(.pid == 1) | "\(.comm):\(.uid)"' <<<"$1")" == "tini:0" ]]
}
probe_two_processes() {  # <procs-json> <engine-uid> <unit-uid>
  local sup
  sup="$(jq -r '.[] | select(.args | contains("unit-mariadb/supervisor.mjs")) | .pid' <<<"$1")"
  [[ "$sup" =~ ^[0-9]+$ ]] || return 1
  [[ "$(jq -r --argjson p "$sup" '[.[] | select(.ppid == $p) | "\(.comm):\(.uid)"] | sort | join(",")' <<<"$1")" \
     == "$(printf '%s\n' "mariadbd:$2" "node:$3" | sort | paste -sd,)" ]]
}
probe_no_root_application() {  # <procs-json>
  [[ "$(jq -r '.[] | select(.args | contains("unit-mariadb/supervisor.mjs")) | .pid' <<<"$1")" =~ ^[0-9]+$ ]] \
    && [[ "$(jq -r '[.[] | select(.underSupervisor and .uid == 0)] | length' <<<"$1")" == 0 ]]
}
probe_engine_args() {  # <procs-json> <socket>
  [[ "$(jq -r --arg s "$2" '[.[] | select(.comm == "mariadbd") | (.args | test("(^|/)mariadbd --no-defaults ")) and (.args | contains("--skip-networking")) and (.args | contains("--socket=" + $s))] | map(tostring) | join(",")' <<<"$1")" == true ]]
}
engine_pid_of() { jq -r '[.[] | select(.comm == "mariadbd") | .pid] | if length == 1 then .[0] else "" end' <<<"$1"; }

# ── Identity and authenticated calls ────────────────────────────────────────
# What podman-up.sh, the parent, wrote: the universe UUID beside the Vault's
# key material, and the proof's own reader identity (unit "proof",
# logger:ingest and logger:read:own) under the proof's state directory.
VAULT_ETC_DIR="$APPS_ROOT/vault/etc/vault"
PROOF_DIR="${PROOF_STATE_DIR:-/var/lib/univ-proof/$UNIVERSE}"
universe_uuid() { cat "$VAULT_ETC_DIR/universe-id" 2>/dev/null; }
vault_base() { echo "http://127.0.0.1:$(jq -r '.bricks["brick-vault"].port' "$MANIFEST")"; }

# A credential never reaches a command line: curl reads the Authorization
# header from a root-only file (-H @file), written by the shell's own printf —
# a builtin, so the value is in no process's argv.
#   write_header <header-file> <token-file>
write_header() {
  ( umask 077; printf 'Authorization: Bearer %s\n' "$(tr -d '\n' < "$2")" > "$1" )
}

# The Vault's administrative API, with the token the construction path holds.
#   vault_curl <curl args…>
vault_curl() {
  install -d -m 0700 "$PROOF_DIR" "$PROOF_DIR/identity"
  write_header "$PROOF_DIR/identity/vault.header" "$VAULT_ETC_DIR/api-token" || return 1
  curl -H @"$PROOF_DIR/identity/vault.header" "$@"
}

# Logger, under a Vault-signed credential issued to the proof's identity for
# this call — it lives 300 s at most, and a recreated universe registers a new
# incarnation, so one is never kept. The token goes from Vault's answer to the
# header file through jq, never through a variable or an argument.
#   logger_curl <curl args…>
logger_curl() {
  local dir="$PROOF_DIR/identity" incarnation
  incarnation="$(cat "$dir/incarnation" 2>/dev/null)"
  [[ -n "$incarnation" && -s "$dir/bootstrap" ]] || { echo "logger_curl: no proof identity in $dir — run deploy/podman-up.sh" >&2; return 1; }
  write_header "$dir/bootstrap.header" "$dir/bootstrap" || return 1
  curl -sf -X POST -H @"$dir/bootstrap.header" -H 'Content-Type: application/json' \
    -d "{\"unit\":\"proof\",\"incarnation\":\"$incarnation\",\"audience\":\"logger\"}" \
    "$(vault_base)/api/identity/issue" \
    | ( umask 077; jq -er '"Authorization: Bearer " + .token' > "$dir/logger.header" ) \
    || { echo "logger_curl: Vault issued no credential to the proof's identity" >&2; return 1; }
  curl -H @"$dir/logger.header" "$@"
}

# One variable of a unit container's environment, as podman created it.
#   unit_env <ctr> <NAME>
unit_env() {
  podman inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$1" 2>/dev/null | sed -n "s/^$2=//p" | head -n1
}

# Evidence delivered: every row of <slug>'s outbox matching <where> carries
# Logger's receipt (waiting up to <seconds>), and Logger holds each of them
# under the unit's own name — read from both databases by the root path,
# never from either unit's answer.
#   evidence_delivered <slug> <sql-where> [seconds]
evidence_delivered() {
  local s="$1" where="$2" tries="${3:-60}" ids n
  while (( tries-- > 0 )); do
    [[ "$(rootsql "$s" "$s" -e "SELECT COUNT(*) FROM event_outbox WHERE ($where) AND receipt IS NULL" 2>/dev/null)" == 0 ]] && break
    sleep 1
  done
  [[ "$(rootsql "$s" "$s" -e "SELECT COUNT(*) FROM event_outbox WHERE ($where) AND receipt IS NULL" 2>/dev/null)" == 0 ]] || return 1
  ids="$(rootsql "$s" "$s" -e "SELECT CONCAT(\"'\", event_id, \"'\") FROM event_outbox WHERE ($where)" 2>/dev/null | paste -sd,)"
  n="$(rootsql "$s" "$s" -e "SELECT COUNT(*) FROM event_outbox WHERE ($where)" 2>/dev/null)"
  [[ -n "$ids" && "$n" =~ ^[1-9][0-9]*$ ]] || return 1
  [[ "$(rootsql logger logger -e "SELECT COUNT(*) FROM ingest_keys WHERE pod = '$s' AND source_event_id IN ($ids)" 2>/dev/null)" == "$n" ]]
}
