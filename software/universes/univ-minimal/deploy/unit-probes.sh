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

# The container's processes, read from /proc inside it, and the facts the
# inventory checks, computed there from what was read: pid 1, the unit
# supervisor, its children, any root process under it, the engine.
# The supervisor is the node process whose script is the runtime's
# supervisor.mjs — not tini, pid 1, whose own command line carries the same
# words (`tini -- node …/supervisor.mjs node server.js`; CT121, 11 Oct 2026).
#   node -e "$UNIT_PROCESSES_JS" [<proc root, /proc>] [<engine socket>]
UNIT_PROCESSES_JS='
const fs = require("fs");
const root = process.argv[1] || "/proc", socket = process.argv[2] || "";
const procs = new Map();
for (const d of fs.readdirSync(root)) {
  if (!/^\d+$/.test(d) || (root === "/proc" && Number(d) === process.pid)) continue;
  try {
    const status = fs.readFileSync(`${root}/${d}/status`, "utf8");
    const argv = fs.readFileSync(`${root}/${d}/cmdline`, "utf8").split("\0").filter(Boolean);
    const comm = fs.readFileSync(`${root}/${d}/comm`, "utf8").trim();
    procs.set(Number(d), {
      pid: Number(d),
      ppid: Number(/^PPid:\s+(\d+)/m.exec(status)[1]),
      uid: Number(/^Uid:\s+(\d+)/m.exec(status)[1]),
      comm,
      args: argv.join(" "),
      isSupervisor: comm === "node" && /(^|\/)unit-mariadb\/supervisor\.mjs$/.test(argv[1] || ""),
    });
  } catch {}
}
const list = [...procs.values()];
const supervisors = list.filter((p) => p.isSupervisor);
const supervisor = supervisors.length === 1 ? supervisors[0] : null;
for (const p of list) {
  let q = procs.get(p.ppid), under = false;
  for (let hops = 0; q && hops < 64; hops += 1, q = procs.get(q.ppid)) if (supervisor && q.pid === supervisor.pid) { under = true; break; }
  p.underSupervisor = under;
}
const engines = list.filter((p) => p.comm === "mariadbd");
const one = procs.get(1);
process.stdout.write(JSON.stringify({
  supervisorCount: supervisors.length,
  supervisor: supervisor ? `${supervisor.uid}:${supervisor.ppid}` : "",
  pid1: one ? `${one.comm}:${one.uid}` : "",
  children: supervisor ? list.filter((p) => p.ppid === supervisor.pid).map((p) => `${p.comm}:${p.uid}`).sort().join(",") : "",
  rootUnderSupervisor: list.filter((p) => p.underSupervisor && p.uid === 0).length,
  enginePid: engines.length === 1 ? String(engines[0].pid) : "",
  engineArgs: engines.length === 1 && /(^|\/)mariadbd --no-defaults /.test(engines[0].args)
    && engines[0].args.split(" ").includes("--skip-networking") && Boolean(socket) && engines[0].args.split(" ").includes(`--socket=${socket}`),
  processes: list,
}));
'
#   unit_processes <ctr> <engine socket>
unit_processes() { podman exec "$1" node -e "$UNIT_PROCESSES_JS" /proc "$2" 2>/dev/null || echo '{}'; }

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

# Predicates over unit_processes' JSON: plain fields, computed inside the
# container from /proc; what cannot be read is empty and fails.
probe_supervisor_root() {  # <procs-json>
  [[ "$(jq -r '.supervisorCount' <<<"$1")" == 1 && "$(jq -r '.supervisor' <<<"$1")" == "0:1" && "$(jq -r '.pid1' <<<"$1")" == "tini:0" ]]
}
probe_two_processes() {  # <procs-json> <engine-uid> <unit-uid>
  [[ "$(jq -r '.supervisorCount' <<<"$1")" == 1 ]] \
    && [[ "$(jq -r '.children' <<<"$1")" == "$(printf '%s\n' "mariadbd:$2" "node:$3" | sort | paste -sd,)" ]]
}
probe_no_root_application() {  # <procs-json>
  [[ "$(jq -r '.supervisorCount' <<<"$1")" == 1 && "$(jq -r '.rootUnderSupervisor' <<<"$1")" == 0 ]]
}
probe_engine_args() {  # <procs-json>  (the socket was given to unit_processes)
  [[ "$(jq -r '.engineArgs' <<<"$1")" == true ]]
}
engine_pid_of() { jq -r '.enginePid // empty' <<<"$1"; }

# ── Identity and authenticated calls ────────────────────────────────────────
# Who holds a Vault-signed credential — every unit that owes evidence to
# Logger, each with the grants grants_of declares — and who pins Vault's public
# key: every unit that verifies a credential, or the ones it receives.
# deploy/podman-up.sh registers and pins exactly these; the proofs check
# exactly these. Every grant is explicit and separate (DECISIONS-20261011 §E):
# Maestro enqueues into Queue and reads it back, nothing more.
HOLDS_CREDENTIAL="vault queue maestro"
PINNED="logger queue maestro"
#   grants_of <unit>   → audience=scope …
grants_of() {
  case "$1" in
    vault|queue) echo "logger=logger:ingest" ;;
    maestro) echo "logger=logger:ingest queue=queue:enqueue queue=queue:read" ;;
    *) return 1 ;;
  esac
}
holds_credential() { [[ " $HOLDS_CREDENTIAL " == *" $1 "* ]]; }
# The parent's record of each identity it registered (podman-up.sh
# write_record): root-only JSON — unit, incarnation, epoch, grants, the
# bootstrap's SHA-256 — what Vault must hold, and what renew-bootstraps.sh
# checks it against.
RECORDS_DIR="$APPS_ROOT/vault/etc/vault/registration/records"
#   record_field <unit> <field>
record_field() {
  [[ -s "$RECORDS_DIR/$1.json" ]] || return 0
  if [[ "$2" == grants ]]; then jq -c '.grants' "$RECORDS_DIR/$1.json"; else jq -r --arg f "$2" '.[$f] // empty' "$RECORDS_DIR/$1.json"; fi
}
# An identity is live when Vault holds exactly the recorded incarnation,
# epoch, grants and bootstrap digest, not revoked, its bootstrap unexpired,
# and the bootstrap file in place is the one recorded. Root path, fails closed.
#   identity_live <unit> <bootstrap-file>
identity_live() {
  local unit="$1" file="$2" want got
  [[ -s "$RECORDS_DIR/$unit.json" && -s "$file" ]] || return 1
  [[ "$(sha256sum < "$file" | cut -c1-64)" == "$(record_field "$unit" bootstrapDigest)" ]] || return 1
  want="$(record_field "$unit" incarnation) $(record_field "$unit" epoch) $(record_field "$unit" bootstrapDigest) $(record_field "$unit" grants)"
  got="$(rootsql vault vault -e "SELECT CONCAT(incarnation, ' ', epoch, ' ', bootstrap_digest, ' ', grants) FROM unit_identities WHERE universe_id = '$(universe_uuid)' AND unit_id = '$unit' AND NOT revoked AND bootstrap_expires_at > UTC_TIMESTAMP(3)" 2>/dev/null)"
  [[ -n "$got" && "$got" == "$want" ]]
}

# The proof's own identity (unit "proof", a qualification identity, no Vault
# administration): it writes its own events and reads them back, runs Queue
# jobs as a consumer (enqueue, read, claim, update under its attempt), and
# reads and administers Maestro to tick a proof schedule. Each right explicit.
PROOF_GRANTS="logger=logger:ingest logger=logger:read:own queue=queue:enqueue queue=queue:read queue=queue:claim queue=queue:attempt maestro=maestro:read maestro=maestro:admin"
# The grants as the registration tool records them in Vault (JSON, audiences
# in first-seen order, each audience's scopes in the order given).
#   grants_json <audience=scope>…
grants_json() {
  local -a auds=(); local -A scopes=(); local g a out=""
  for g in "$@"; do
    a="${g%%=*}"
    [[ -v "scopes[$a]" ]] || auds+=("$a")
    scopes[$a]+="${scopes[$a]:+,}\"${g#*=}\""
  done
  for a in "${auds[@]}"; do out+="${out:+,}\"$a\":[${scopes[$a]}]"; done
  printf '{%s}' "$out"
}

# ── Secrets each unit consumes: private files, never its environment ───────
# SOL-DECISIONS-2 §M. The parent keeps each source root-only (0600) under the
# universe's secrets store, one directory per unit, its ancestors protected;
# the unit receives a copy owned by its own account (0400) under mount/,
# mounted alone and read-only at /run/secrets/<NAME>, and the variable
# <NAME>_FILE names it. The store and its directories are never mounted; no
# secret is sourced or exported into a process environment. The Vault master
# key and the bootstraps keep their own delivery (etc/vault/master.key,
# etc/identity/bootstrap); the MariaDB passwords keep their canonical place.
SECRETS_ROOT="${SHAPER_SECRETS_ROOT:-$APPS_ROOT/.state/secrets}"
SECRETS_IN_UNIT=/run/secrets
#   secrets_of <unit>   → the names of the secrets the unit consumes
secrets_of() {
  case "$1" in
    vault) echo VAULT_TOKEN ;;   # the generic secret API's bearer (Rule 0K)
    *) ;;
  esac
}
#   secret_source <unit> <NAME>    the parent's root-only source
secret_source() { printf '%s/%s/%s\n' "$SECRETS_ROOT" "$1" "$2"; }
#   secret_mounted <unit> <NAME>   the consumer's copy, the one file mounted
secret_mounted() { printf '%s/%s/mount/%s\n' "$SECRETS_ROOT" "$1" "$2"; }

# A path no account but root can replace: every existing component, the path
# itself included, belongs to root and is writable by nobody else unless it is
# a sticky directory (/tmp). The path is resolved first. In a namespace that
# maps a single uid (`unshare -r`, the rehearsal) the unmapped owner of the
# outer directories reads as the overflow uid and counts as root there: no
# other account exists in that namespace. Prints the first fault.
#   path_protected <path>
path_protected() {
  local p owner mode overflow="" map
  map="$(cat /proc/self/uid_map 2>/dev/null)"
  if [[ "$(wc -l <<<"$map")" == 1 && "$(awk '{print $3}' <<<"$map")" == 1 ]]; then
    overflow="$(cat /proc/sys/kernel/overflowuid 2>/dev/null)"
  fi
  p="$(readlink -m -- "$1")" || { echo "$1 cannot be resolved"; return 1; }
  while :; do
    if [[ -e "$p" ]]; then
      read -r owner mode < <(stat -c '%u %a' -- "$p") || { echo "$p cannot be read"; return 1; }
      if [[ "$owner" != 0 && ( -z "$overflow" || "$owner" != "$overflow" ) ]]; then echo "$p belongs to uid $owner, not root"; return 1; fi
      if (( (8#$mode & 8#022) && !(8#$mode & 8#1000) )); then echo "$p is writable by group or others (mode $mode)"; return 1; fi
    fi
    [[ "$p" == / ]] && return 0
    p="$(dirname -- "$p")"
  done
}

# Every secret value the universe holds, one per line, into a root-only file —
# for the proof to look for them without printing one: the secrets store's
# sources, the Vault master key, every bootstrap (the units' and the
# proof's) and every unit's MariaDB password. Values shorter than 16
# characters are not secrets this universe generates and are left out, so a
# short string can never match by accident.
#   secret_values_file <out-file> <unit>…
secret_values_file() {
  local out="$1" s f; shift
  ( umask 077; : > "$out" ) || return 1
  {
    for f in "$SECRETS_ROOT"/*/*; do [[ -f "$f" && ! -L "$f" ]] && printf '%s\n' "$(tr -d '\n' < "$f")"; done
    [[ -s "$APPS_ROOT/vault/etc/vault/master.key" ]] && printf '%s\n' "$(tr -d '\n' < "$APPS_ROOT/vault/etc/vault/master.key")"
    [[ -s "$PROOF_DIR/identity/bootstrap" ]] && printf '%s\n' "$(tr -d '\n' < "$PROOF_DIR/identity/bootstrap")"
    for s in "$@"; do
      for f in "$APPS_ROOT/$s/etc/identity/bootstrap" "$APPS_ROOT/$s/etc/mysql/localhost/passwd"; do
        [[ -s "$f" ]] && printf '%s\n' "$(tr -d '\n' < "$f")"
      done
    done
    :  # a last absent file is no failure of the list
  } | awk 'length($0) >= 16' | sort -u > "$out"
}

# The host processes of a unit container: PID 1 (as podman reports it) and
# every process in its pid namespace — its children and anything exec'd in.
#   container_pids <ctr> [<proc root>]
container_pids() {
  local ctr="$1" proc="${2:-/proc}" pid1 ns d
  pid1="$(podman inspect -f '{{.State.Pid}}' "$ctr" 2>/dev/null)"
  [[ "$pid1" =~ ^[1-9][0-9]*$ ]] || return 1
  ns="$(readlink "$proc/$pid1/ns/pid" 2>/dev/null)" || return 1
  [[ -n "$ns" ]] || return 1
  for d in "$proc"/[0-9]*; do
    [[ "$(readlink "$d/ns/pid" 2>/dev/null)" == "$ns" ]] && echo "${d##*/}"
  done
  return 0
}

# No secret value in a unit's argv or environment: PID 1 and every process
# of its pid namespace, read from the host's /proc (root reads every
# process's initial environment there), each value matched as a fixed string
# from the root-only values file — nothing printed but the verdict. An
# unreadable environ or cmdline fails, never counts as clean. Prints
# "<processes read> <processes holding a secret>".
#   secrets_in_processes <ctr> <values-file> [<proc root>]
secrets_in_processes() {
  local ctr="$1" values="$2" proc="${3:-/proc}" pid read=0 hits=0 pids
  [[ -s "$values" ]] || { echo "0 unknown"; return 1; }
  pids="$(container_pids "$ctr" "$proc")" || { echo "0 unknown"; return 1; }
  [[ -n "$pids" ]] || { echo "0 unknown"; return 1; }
  local env cmd
  for pid in $pids; do
    # A process gone between the listing and the read (a health check's exec)
    # is not counted; one still there that cannot be read fails the probe.
    if ! env="$(tr '\0' '\n' < "$proc/$pid/environ" 2>/dev/null)" || ! cmd="$(tr '\0' ' ' < "$proc/$pid/cmdline" 2>/dev/null)"; then
      [[ -d "$proc/$pid" ]] && { echo "$read unknown"; return 1; }
      continue
    fi
    read=$((read + 1))
    if grep -qFf "$values" <<<"$env" || grep -qFf "$values" <<<"$cmd"; then hits=$((hits + 1)); fi
  done
  echo "$read $hits"
  (( read > 0 && hits == 0 ))
}

# No secret value anywhere in what podman holds for the container: its whole
# inspect document — environment, command, arguments, labels, annotations,
# mounts and the create command.
#   secrets_in_inspect <ctr> <values-file>
secrets_in_inspect() {
  local doc
  [[ -s "$2" ]] || return 1
  doc="$(podman inspect "$1" 2>/dev/null)" && [[ -n "$doc" ]] || return 1
  ! grep -qFf "$2" <<<"$doc"
}

# What podman-up.sh, the parent, wrote: the universe UUID beside the Vault's
# key material, and the proof's own reader identity (unit "proof") under the
# proof's state directory.
VAULT_ETC_DIR="$APPS_ROOT/vault/etc/vault"
PROOF_DIR="${PROOF_STATE_DIR:-/var/lib/univ-proof/$UNIVERSE}"
universe_uuid() { cat "$VAULT_ETC_DIR/universe-id" 2>/dev/null; }
vault_base() { echo "http://127.0.0.1:$(jq -r '.bricks["brick-vault"].port' "$MANIFEST")"; }

# A credential never reaches a command line: curl reads the Authorization
# header from a root-only file (-H @file), written by the shell's own printf —
# a builtin, so the value is in no process's argv — and removed once used.
#   write_header <header-file> <token-file>
write_header() {
  ( umask 077; printf 'Authorization: Bearer %s\n' "$(tr -d '\n' < "$2")" > "$1" )
}
#   curl_with_header <header-file> <curl args…>   (the header file is removed after the call)
curl_with_header() {
  local header="$1" status; shift
  curl -H @"$header" "$@"; status=$?
  rm -f -- "$header"
  return "$status"
}

# The Vault's administrative API, with the token the construction path holds:
# read by root from its source in the secrets store, never from the unit.
#   vault_curl <curl args…>
vault_curl() {
  install -d -m 0700 "$PROOF_DIR" "$PROOF_DIR/identity"
  write_header "$PROOF_DIR/identity/vault.header" "$(secret_source vault VAULT_TOKEN)" || return 1
  curl_with_header "$PROOF_DIR/identity/vault.header" "$@"
}

# A Vault-signed credential for the proof's identity and one audience (logger
# by default), written as an Authorization header to <header-file>
# (root-only). The token goes from Vault's answer to the file through jq, never
# through a variable or an argument; the bootstrap's header is removed at once.
#   issue_proof_credential <header-file> [audience]
issue_proof_credential() {
  local dir="$PROOF_DIR/identity" header="$1" audience="${2:-logger}" incarnation status
  incarnation="$(cat "$dir/incarnation" 2>/dev/null)"
  [[ -n "$incarnation" && -s "$dir/bootstrap" ]] || { echo "issue_proof_credential: no proof identity in $dir — run deploy/podman-up.sh" >&2; return 1; }
  local boot
  boot="$(mktemp --suffix=.header "$dir/bootstrap-XXXXXX")" || return 1
  write_header "$boot" "$dir/bootstrap" || { rm -f -- "$boot"; return 1; }
  curl_with_header "$boot" -sf -X POST -H 'Content-Type: application/json' \
    -d "{\"unit\":\"proof\",\"incarnation\":\"$incarnation\",\"audience\":\"$audience\"}" \
    "$(vault_base)/api/identity/issue" \
    | ( umask 077; jq -er '"Authorization: Bearer " + .token' > "$header" )
  status=$?
  if (( status != 0 )); then
    rm -f -- "$header"
    echo "issue_proof_credential: Vault issued no credential to the proof's identity" >&2
    return 1
  fi
}

# A unit's API under a credential issued to the proof's identity for this call
# alone — it lives 300 s at most, and a recreated universe registers a new
# incarnation, so none is kept. Each call has its own root-only header file,
# removed after use: calls may run in parallel.
#   proof_curl <audience> <curl args…>
proof_curl() {
  local audience="$1" header; shift
  install -d -m 0700 "$PROOF_DIR" "$PROOF_DIR/identity"
  header="$(mktemp --suffix=.header "$PROOF_DIR/identity/$audience-XXXXXX")" || return 1
  issue_proof_credential "$header" "$audience" || { rm -f -- "$header"; return 1; }
  curl_with_header "$header" "$@"
}
#   logger_curl <curl args…>
logger_curl() { proof_curl logger "$@"; }
# Maestro answers credentials only (DECISIONS-20261011 §E).
#   maestro_curl <curl args…>
maestro_curl() { proof_curl maestro "$@"; }

# ── Queue, as a client of its API ───────────────────────────────────────────
queue_base() { echo "http://127.0.0.1:$(jq -r '.bricks["brick-queue"].port' "$MANIFEST")"; }
# Queue answers credentials only (DECISIONS-20261011 §E).
#   queue_curl <curl args…>
queue_curl() { proof_curl queue "$@"; }
# A job run to its end the way a consumer runs one (DECISIONS-20261011 §G):
# claimed — a durable attempt bound to the caller — then completed under that
# attempt. Prints the completion's HTTP status; fails when no claim was granted.
#   queue_complete <job-id> [<result-json>] [<queue-base-url>]
queue_complete() {
  local job="$1" result="${2:-}" base="${3:-$(queue_base)}" attempt
  [[ -n "$result" ]] || result='{}'
  attempt="$(queue_curl -s -X POST "$base/api/jobs/$job/claim" -H 'Content-Type: application/json' -d '{}' | jq -r '.attempt.id // empty')"
  [[ -n "$attempt" ]] || return 1
  queue_curl -s -o /dev/null -w '%{http_code}' -X PATCH "$base/api/jobs/$job" -H 'Content-Type: application/json' \
    -d "{\"attempt\":\"$attempt\",\"status\":\"COMPLETED\",\"progress\":100,\"step\":1,\"result\":$result}"
}

# renew-bootstraps.sh prints one line per identity, "  <unit> <state> bootstrap
# expires …"; its summary line also holds the word "renewed" (CT121: a daily
# run that renewed nothing was counted as renewing), so only the per-identity
# lines are counted.
#   count_state <renewal-output> <state>
count_state() { grep -cE "^  [a-z][a-z0-9_-]* +$2 " <<<"$1" || true; }

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
  # Waits until the rows exist and every one carries its receipt.
  while (( tries-- > 0 )); do
    [[ "$(rootsql "$s" "$s" -e "SELECT CONCAT(COUNT(*) > 0, SUM(receipt IS NULL)) FROM event_outbox WHERE ($where)" 2>/dev/null)" == 10 ]] && break
    sleep 1
  done
  [[ "$(rootsql "$s" "$s" -e "SELECT COUNT(*) FROM event_outbox WHERE ($where) AND receipt IS NULL" 2>/dev/null)" == 0 ]] || return 1
  ids="$(rootsql "$s" "$s" -e "SELECT CONCAT(\"'\", event_id, \"'\") FROM event_outbox WHERE ($where)" 2>/dev/null | paste -sd,)"
  n="$(rootsql "$s" "$s" -e "SELECT COUNT(*) FROM event_outbox WHERE ($where)" 2>/dev/null)"
  [[ -n "$ids" && "$n" =~ ^[1-9][0-9]*$ ]] || return 1
  [[ "$(rootsql logger logger -e "SELECT COUNT(*) FROM ingest_keys WHERE pod = '$s' AND source_event_id IN ($ids)" 2>/dev/null)" == "$n" ]]
}
