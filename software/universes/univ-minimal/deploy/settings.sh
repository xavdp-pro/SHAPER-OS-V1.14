#!/usr/bin/env bash
# Intent: software/universes/univ-minimal/INTENT.md#settings
# The base's one settings reader (SOL-DECISIONS-4 §5, ENV-PARSER-ALLOWLIST).
# Sourced, never run, by every script of deploy/ that reads its settings, and
# by a template universe's deploy/lib.sh from base/deploy/. Definitions only;
# shaper_settings_load does the work, before anything is changed:
#
#   1. Which file. ENV_FILE when it is named — it must be a regular file, or
#      /dev/null for "no settings file"; a named file that does not exist is a
#      halt, never a silent fall back to another one. Without ENV_FILE, the
#      universe's own cfg-univ-minimal.env when it exists, else none.
#   2. The file is READ, one line at a time, never sourced, evaluated or
#      expanded. A line is a blank, a # comment, or KEY=value (an optional
#      `export ` before it); the value is a bare word, '…' or "…", with an
#      optional # comment after whitespace. Its key must be a parameter of the
#      catalogue below. Refused, each by key and line, never by value: an
#      unknown key; a secret given a value (a secret-shaped name, or one of the
#      base's secrets); executable or expanding syntax ($, backquote, ;, |, &,
#      <, >, parentheses, a second word); a key given twice; a run-time knob
#      in the file; a value not of its parameter's form.
#   3. The inherited environment is held to the same catalogue: a parameter
#      inherited from the caller must have its form and may not contradict
#      the file; a secret of the base, or a secret-shaped name of its
#      namespaces, holding a value is refused; so is an unknown SHAPER_* or
#      RESTORE_DUMP_* name (a typo would otherwise be ignored), a variable
#      that changes how a shell or the loader behaves (BASH_ENV, LD_PRELOAD,
#      …), an inherited shell function and an entry whose name no shell can
#      hold. Anything else inherited is never read and never passed on.
#   4. The values become shell variables of the script, none of them exported,
#      and the script's exported environment is reduced to SHAPER_ENV_PASS:
#      every command it runs (podman, conmon, jq, openssl, systemctl…) receives
#      that environment and the arguments the script gives it, nothing else.
#      A base script it runs receives an environment built explicitly
#      (shaper_settings_child_env, then env -i).
#
# Diagnostics name keys and line numbers, never a value and never a line's
# text: a refused line may be a secret pasted in the wrong place.

SHAPER_SETTINGS_TAG="[settings]"

# ── The parameter catalogue ────────────────────────────────────────────────
#   <name> <scope> <form>
# scope  setting  a property of the universe: the settings file, or inherited
#        run      a knob of one invocation: inherited only, refused in the file
# form   see shaper_settings_form_ok. Every form accepts the empty value, which
#        leaves the parameter to its default.
# RESTORE_DUMP_<slug> is a family: one per unit, the slug in lowercase with
# underscores (RESTORE_DUMP_vault).
SHAPER_SETTINGS_CATALOGUE=(
  "SHAPER_UNIVERSE           setting universe"
  "SHAPER_APPS_ROOT          setting path"
  "SHAPER_SECRETS_ROOT       setting path"
  "SHAPER_REGISTRY           setting registry"
  "SHAPER_IMAGE_TAG          setting tag"
  "SHAPER_UNIVERSE_ID        setting uuid"
  "PROOF_STATE_DIR           setting path"
  "RENEWAL_EXTRA_IDENTITIES  setting slugs"
  "RENEWAL_ALERT_UNIT        setting service"
  "PARENT_LOCK_WAIT_SECONDS  setting count"
  "PODMAN_UP_RECREATE        run     slugs"
  "RENEW_WITHIN_SECONDS      run     count"
  "RENEW_EXTEND_SECONDS      run     count"
  "DRILL_PORT_SHIFT          run     count"
  "SYSTEMD_DIR               run     path"
  "NO_SYSTEMCTL              run     flag"
  "RESTORE_DUMP_*            run     dump"
)
_SHAPER_RESTORE_DUMP_RE='^RESTORE_DUMP_[a-z][a-z0-9_]*$'

# ── The base's secrets ─────────────────────────────────────────────────────
# Never a value in the settings file or the inherited environment: each lives
# in its own root-only file (INTENT.md#secret-files). An empty line of one of
# them is the retired line an earlier settings file kept ("leave its line
# empty"), accepted and ignored. <NAME>_FILE is accepted only with the one
# value the base gives it, the file mounted in the unit (/run/secrets/<NAME>):
# any other value would be ignored, so it is refused.
SHAPER_SETTINGS_SECRETS=(VAULT_TOKEN VAULT_MASTER_KEY UNIT_BOOTSTRAP_TOKEN)
SHAPER_SETTINGS_DELIVERED=(VAULT_TOKEN)
SECRET_NAME_RE='(^|_)(TOKEN|SECRET|PASSWORD|PASSWD|PWD|PASSPHRASE|API_KEY|MASTER_KEY|PRIVATE_KEY|ENCRYPTION_KEY|SECRET_KEY|ACCESS_KEY)$'
# The base's namespaces: a secret-shaped name in one of them, inherited with a
# value, is refused; outside them it is only never read nor passed on.
SHAPER_SETTINGS_NAMESPACE_RE='^(SHAPER|VAULT|UNIT|LOGGER|QUEUE|MAESTRO|PROOF|RENEW|RENEWAL|RESTORE|DRILL|PODMAN|PARENT|MARIADB|MYSQL)_'

# ── What every command the script runs receives ────────────────────────────
SHAPER_ENV_PASS=(PATH HOME LANG LANGUAGE TZ TERM TMPDIR USER LOGNAME XDG_RUNTIME_DIR
  CONTAINERS_CONF CONTAINERS_STORAGE_CONF CONTAINERS_REGISTRIES_CONF)
# Inherited variables that change how bash, the loader or a child shell
# behaves: refused when they hold a value.
SHAPER_ENV_REFUSED=(BASH_ENV ENV SHELLOPTS BASHOPTS CDPATH GLOBIGNORE BASH_XTRACEFD POSIXLY_CORRECT
  LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT)

#   shaper_settings_entry <name>   → "<scope> <form>", or status 1
shaper_settings_entry() {
  local entry name scope form
  for entry in "${SHAPER_SETTINGS_CATALOGUE[@]}"; do
    read -r name scope form <<<"$entry"
    if [[ "$name" == "$1" || ( "$name" == 'RESTORE_DUMP_*' && "$1" =~ $_SHAPER_RESTORE_DUMP_RE ) ]]; then
      printf '%s %s\n' "$scope" "$form"; return 0
    fi
  done
  return 1
}

# Patterns with characters [[ =~ ]] would read as shell syntax, held in
# variables.
_SHAPER_PATH_RE='^/[A-Za-z0-9._/@+-]*$'
_SHAPER_DOT_RE='(^|/)\.\.?(/|$)'
_SHAPER_EXPANSION_RE='^[][A-Za-z0-9_{(@*#?!$-]$'
_SHAPER_BARE_RE='^[A-Za-z0-9._/:@%+=,#~^-]*$'
_SHAPER_AFTER_RE='^[[:space:]]+(#.*)?$'
#   shaper_settings_form_ok <form> <value>
shaper_settings_form_ok() {
  local v="$2"
  [[ -z "$v" ]] && return 0
  case "$1" in
    universe) [[ "$v" =~ ^univ-[a-z0-9]+(-[a-z0-9]+)*$ ]] ;;
    path)     [[ "$v" =~ $_SHAPER_PATH_RE && ! "$v" =~ $_SHAPER_DOT_RE ]] ;;
    registry) [[ "$v" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?(/[a-z0-9._-]+)*$ ]] ;;
    tag)      [[ "$v" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] ;;
    uuid)     [[ "$v" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] ;;
    slugs)    [[ "$v" =~ ^[a-z][a-z0-9_-]*( +[a-z][a-z0-9_-]*)*$ ]] ;;
    service)  [[ "$v" =~ ^[A-Za-z0-9@._:-]+\.service$ ]] ;;
    count)    [[ "$v" =~ ^[0-9]{1,10}$ ]] ;;
    flag)     [[ "$v" =~ ^[01]$ ]] ;;
    dump)     [[ "$v" =~ ^/apps/[a-z][a-z0-9_-]*/sav/restore/[A-Za-z0-9._-]+\.sql$ ]] ;;
    *) return 1 ;;
  esac
}

# What each form is, for a diagnostic.
shaper_settings_form_says() {
  case "$1" in
    universe) echo "an instance slug (univ-…)" ;;
    path)     echo "an absolute path of letters, digits and . _ / @ + -, without . or .. components" ;;
    registry) echo "a registry host[:port][/path]" ;;
    tag)      echo "an image tag" ;;
    uuid)     echo "a lowercase UUID" ;;
    slugs)    echo "unit slugs separated by spaces" ;;
    service)  echo "one systemd service name (….service)" ;;
    count)    echo "a whole number" ;;
    flag)     echo "0 or 1" ;;
    dump)     echo "/apps/<slug>/sav/restore/<file>.sql" ;;
  esac
}

_shaper_in() { local x="$1" y; shift; for y; do [[ "$x" == "$y" ]] && return 0; done; return 1; }

# One value as the file writes it, never evaluated: sets _SHAPER_V (the value)
# and _SHAPER_E (why it is refused, empty when accepted). The forms an earlier
# settings file used, and `source` read, are kept: a bare word, '…', "…" with
# \$ \` \" \\ escapes, then whitespace and a # comment.
_shaper_settings_value() {
  local s="$1" c next word i n
  _SHAPER_V=""; _SHAPER_E=""
  [[ -z "$s" ]] && return 0
  c="${s:0:1}"
  if [[ "$c" == "'" ]]; then
    s="${s:1}"
    [[ "$s" == *"'"* ]] || { _SHAPER_E="an unterminated single quote"; return 1; }
    _SHAPER_V="${s%%"'"*}"; s="${s#*"'"}"
  elif [[ "$c" == '"' ]]; then
    i=1; n=${#s}
    while (( i < n )); do
      c="${s:i:1}"
      case "$c" in
        '"') break ;;
        '\')
          next="${s:i+1:1}"
          case "$next" in
            '$'|'`'|'"'|'\') _SHAPER_V+="$next"; i=$((i + 2)) ;;
            '') _SHAPER_E="a line continuation"; return 1 ;;
            *) _SHAPER_V+='\'; i=$((i + 1)) ;;
          esac ;;
        '`') _SHAPER_E="a command substitution (backquote)"; return 1 ;;
        '$')
          next="${s:i+1:1}"
          if [[ "$next" =~ $_SHAPER_EXPANSION_RE ]]; then _SHAPER_E="an expansion (\$)"; return 1; fi
          _SHAPER_V+='$'; i=$((i + 1)) ;;
        *) _SHAPER_V+="$c"; i=$((i + 1)) ;;
      esac
    done
    (( i < n )) || { _SHAPER_E="an unterminated double quote"; return 1; }
    s="${s:i+1}"
  else
    word="${s%%[[:space:]]*}"
    s="${s:${#word}}"
    if [[ ! "$word" =~ $_SHAPER_BARE_RE ]]; then
      _SHAPER_E="a character a shell would interpret (\$, backquote, ;, |, &, <, >, parentheses, quotes, \\ or a glob): quote the value"
      return 1
    fi
    if [[ "$word" == '~'* || "$word" == *':~'* ]]; then _SHAPER_E="a tilde expansion"; return 1; fi
    _SHAPER_V="$word"
  fi
  # After the value: nothing, or whitespace and a comment.
  if [[ -n "$s" ]]; then
    if [[ "$s" =~ $_SHAPER_AFTER_RE ]]; then :
    elif [[ "$s" =~ ^[[:space:]] ]]; then _SHAPER_E="a second word after the value: a shell would run it as a command"; return 1
    else _SHAPER_E="text joined to a quoted value"; return 1
    fi
  fi
  return 0
}

declare -gA SHAPER_SETTINGS_FILE_VALUE=() SHAPER_SETTINGS_FILE_LINE=()
SHAPER_SETTINGS_ERRORS=()
_shaper_settings_refuse() { SHAPER_SETTINGS_ERRORS+=("$*"); }

#   shaper_settings_parse_file <file>
# Reads the file into SHAPER_SETTINGS_FILE_VALUE / _LINE; every refusal goes to
# SHAPER_SETTINGS_ERRORS. Nothing is assigned to the script's variables here.
shaper_settings_parse_file() {
  local file="$1" raw line n=0 key rest entry scope form
  SHAPER_SETTINGS_FILE_VALUE=(); SHAPER_SETTINGS_FILE_LINE=()
  if [[ ! -r "$file" ]]; then _shaper_settings_refuse "$file cannot be read: a file that cannot be checked is not used"; return 0; fi
  while IFS= read -r raw || [[ -n "$raw" ]]; do
    n=$((n + 1))
    line="${raw%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*(#.*)?$ ]] && continue
    if [[ ! "$line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      _shaper_settings_refuse "line $n: not KEY=value — a shell would run it as a command (put a note for a human behind #)"
      continue
    fi
    key="${BASH_REMATCH[2]}"; rest="${BASH_REMATCH[3]}"
    if [[ -n "${SHAPER_SETTINGS_FILE_LINE[$key]:-}" ]]; then
      _shaper_settings_refuse "line $n: $key is given twice (first on line ${SHAPER_SETTINGS_FILE_LINE[$key]}): one value per parameter"
      continue
    fi
    SHAPER_SETTINGS_FILE_LINE[$key]="$n"
    if ! _shaper_settings_value "$rest"; then
      _shaper_settings_refuse "line $n: $key — its value holds $_SHAPER_E; a settings file is read, never executed"
      continue
    fi
    # A secret: the base's own, or any secret-shaped name, holding a value.
    # (PWD and OLDPWD are the shell's working directories, not secrets.)
    if _shaper_in "$key" "${SHAPER_SETTINGS_SECRETS[@]}" || { [[ "$key" =~ $SECRET_NAME_RE && "$key" != PWD && "$key" != OLDPWD ]] && ! shaper_settings_entry "$key" >/dev/null; }; then
      if [[ -n "$_SHAPER_V" ]]; then
        _shaper_settings_refuse "line $n: $key gives a secret a value — a settings file carries parameters only; the secret goes in its root-only source file (the secrets store, deploy/unit-probes.sh secrets_of)"
      elif ! _shaper_in "$key" "${SHAPER_SETTINGS_SECRETS[@]}"; then
        _shaper_settings_refuse "line $n: $key is not a parameter of the base (deploy/settings.sh, SHAPER_SETTINGS_CATALOGUE): remove the line"
      fi
      continue
    fi
    if [[ "$key" == *_FILE ]] && _shaper_in "${key%_FILE}" "${SHAPER_SETTINGS_DELIVERED[@]}"; then
      [[ -z "$_SHAPER_V" || "$_SHAPER_V" == "/run/secrets/${key%_FILE}" ]] \
        || _shaper_settings_refuse "line $n: $key names another file than the one the base delivers (/run/secrets/${key%_FILE}); the base reads no other: remove the line"
      continue
    fi
    if ! entry="$(shaper_settings_entry "$key")"; then
      _shaper_settings_refuse "line $n: $key is not a parameter of the base (deploy/settings.sh, SHAPER_SETTINGS_CATALOGUE): remove the line, or correct its name"
      continue
    fi
    read -r scope form <<<"$entry"
    if [[ "$scope" == run ]]; then
      _shaper_settings_refuse "line $n: $key is a knob of one run, not a setting of the universe: give it on the command line of that run, never in the file"
      continue
    fi
    if ! shaper_settings_form_ok "$form" "$_SHAPER_V"; then
      _shaper_settings_refuse "line $n: $key must be $(shaper_settings_form_says "$form")"
      continue
    fi
    SHAPER_SETTINGS_FILE_VALUE[$key]="$_SHAPER_V"
  done < "$file"
  return 0
}

#   shaper_settings_check_inherited
# The caller's environment, as this process received it.
shaper_settings_check_inherited() {
  local name value entry scope form fn names
  local -A inherited=()
  # The process's own initial environment: what the caller handed over,
  # including the names a shell cannot hold (bash does not import them, but
  # would pass them to every command).
  if [[ -r /proc/$$/environ ]]; then
    while IFS= read -r -d '' entry; do
      name="${entry%%=*}"
      inherited[$name]=1
      [[ "$name" == BASH_FUNC_* || "$name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] \
        || _shaper_settings_refuse "the inherited environment holds an entry whose name is no variable (${name//[^A-Za-z0-9_.-]/?}): remove it (env -u)"
    done < "/proc/$$/environ"
  else
    for name in $(compgen -e); do inherited[$name]=1; done
  fi
  for fn in $(declare -F -x 2>/dev/null | awk '$2 == "-fx" {print $3}'); do
    _shaper_settings_refuse "the inherited environment exports the shell function $fn, which would replace a command: remove it"
  done
  for name in "${SHAPER_ENV_REFUSED[@]}"; do
    [[ -n "${inherited[$name]:-}" && -n "${!name:-}" ]] \
      && _shaper_settings_refuse "the inherited environment sets $name, which changes how a shell or a program loads: unset it"
  done
  mapfile -t names < <(compgen -e)
  for name in "${names[@]}"; do
    [[ "$name" == PWD || "$name" == OLDPWD ]] && continue
    value="${!name-}"
    if entry="$(shaper_settings_entry "$name")"; then
      read -r scope form <<<"$entry"
      if ! shaper_settings_form_ok "$form" "$value"; then
        _shaper_settings_refuse "inherited $name must be $(shaper_settings_form_says "$form")"
      elif [[ -n "$value" && -n "${SHAPER_SETTINGS_FILE_LINE[$name]:-}" && "$value" != "${SHAPER_SETTINGS_FILE_VALUE[$name]-}" ]]; then
        _shaper_settings_refuse "inherited $name contradicts line ${SHAPER_SETTINGS_FILE_LINE[$name]} of the settings file: set it in one place"
      fi
      continue
    fi
    [[ -n "$value" ]] || continue
    if _shaper_in "$name" "${SHAPER_SETTINGS_SECRETS[@]}" || [[ "$name" =~ $SHAPER_SETTINGS_NAMESPACE_RE && "$name" =~ $SECRET_NAME_RE ]]; then
      _shaper_settings_refuse "the inherited environment gives the secret $name a value: the base reads secrets from their root-only files only; unset it (env -u $name)"
    elif [[ "$name" =~ ^(SHAPER|RESTORE_DUMP)_ ]]; then
      _shaper_settings_refuse "inherited $name is not a parameter of the base (deploy/settings.sh, SHAPER_SETTINGS_CATALOGUE): unset it, or correct its name"
    fi
  done
  return 0
}

# The file read, empty when none (for a script that renders it elsewhere).
SHAPER_SETTINGS_FILE=""

#   shaper_settings_load <tag>
# Steps 1-4 above. On a refusal: every reason, then status 1, and nothing has
# been assigned, exported or changed. The caller halts.
shaper_settings_load() {
  local tag="${1:-$SHAPER_SETTINGS_TAG}" file="" e name entry scope form value
  SHAPER_SETTINGS_ERRORS=()
  if [[ -n "${ENV_FILE:-}" ]]; then
    if [[ "$ENV_FILE" == /dev/null ]]; then file=""
    elif [[ -f "$ENV_FILE" ]]; then file="$ENV_FILE"
    else
      echo "$tag ENV_FILE names $ENV_FILE, which is not a file: no other settings file is read in its place (ENV_FILE=/dev/null names none). Halt." >&2
      return 1
    fi
  elif [[ -n "${UNIV:-}" && -f "$UNIV/cfg-univ-minimal.env" ]]; then
    file="$UNIV/cfg-univ-minimal.env"
  fi
  SHAPER_SETTINGS_FILE_VALUE=(); SHAPER_SETTINGS_FILE_LINE=()
  [[ -n "$file" ]] && shaper_settings_parse_file "$file"
  shaper_settings_check_inherited
  if (( ${#SHAPER_SETTINGS_ERRORS[@]} )); then
    echo "$tag the settings${file:+ ($file)} are refused — nothing was read into this run, nothing was changed:" >&2
    for e in "${SHAPER_SETTINGS_ERRORS[@]}"; do echo "$tag   $e" >&2; done
    echo "$tag A settings file holds blank lines, # comments and KEY=value lines of the base's parameters (univ-minimal INTENT.md#settings). Halt." >&2
    return 1
  fi
  SHAPER_SETTINGS_FILE="$file"
  # The values: the file's line when it has one, else the inherited value.
  for name in "${!SHAPER_SETTINGS_FILE_VALUE[@]}"; do
    printf -v "$name" '%s' "${SHAPER_SETTINGS_FILE_VALUE[$name]}"
  done
  # The script's exported environment: SHAPER_ENV_PASS and LC_*, nothing else.
  # A parameter stays a variable of this script, never exported.
  local names
  mapfile -t names < <(compgen -e)
  for name in "${names[@]}"; do
    _shaper_in "$name" "${SHAPER_ENV_PASS[@]}" && continue
    [[ "$name" == LC_* ]] && continue
    export -n "$name"
  done
  return 0
}

#   shaper_settings_child_env [--with-run]
# Fills SHAPER_CHILD_ENV with the environment a base script receives from
# this one (env -i "${SHAPER_CHILD_ENV[@]}" … bash <script>): the passed
# variables, ENV_FILE when one was named, and every setting that holds a value;
# with --with-run, the run knobs too (a template's deploy/base.sh hands its
# caller's to the base). The child reads and checks them again.
shaper_settings_child_env() {
  local with_run=0 name entry scope form
  [[ "${1:-}" == --with-run ]] && with_run=1
  SHAPER_CHILD_ENV=()
  for name in $(compgen -e); do
    if [[ "$name" == LC_* ]] || _shaper_in "$name" "${SHAPER_ENV_PASS[@]}"; then SHAPER_CHILD_ENV+=("$name=${!name}"); fi
  done
  [[ -n "${ENV_FILE:-}" ]] && SHAPER_CHILD_ENV+=("ENV_FILE=$ENV_FILE")
  for name in $(compgen -v); do
    entry="$(shaper_settings_entry "$name")" || continue
    read -r scope form <<<"$entry"
    [[ "$scope" == run && "$with_run" == 0 ]] && continue
    [[ -n "${!name:-}" ]] && SHAPER_CHILD_ENV+=("$name=${!name}")
  done
  return 0
}
