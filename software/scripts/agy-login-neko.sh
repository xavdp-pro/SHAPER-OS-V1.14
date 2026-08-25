#!/usr/bin/env bash
# Opens an Antigravity session inside a throwaway universe that carries both the
# browser (Neko, streamed over WebRTC) and the `agy` client.
#
# Why both in one container: the Google consent and the token write then happen
# in the same place, under the same file identity. The human authenticates in
# the browser themselves; nothing they type passes through the caller.
#
#   AGY_HOME=~/.gemini-b ./agy-login-neko.sh start     # raise the universe
#   AGY_HOME=~/.gemini-b ./agy-login-neko.sh login     # start the OAuth flow
#   ./agy-login-neko.sh stop
#
# One identity directory per account: that is what lets several sit side by side
# and be swapped without anything leaving the machine.
set -euo pipefail

NAME="${NEKO_NAME:-univ-oauth-neko}"
PORT="${NEKO_PORT:-9450}"
IMAGE="${NEKO_IMAGE:-ghcr.io/m1k1o/neko/chromium:latest}"
AGY_BIN="${AGY_BIN:-$HOME/.local/bin/agy}"
AGY_HOME="${AGY_HOME:-$HOME/.gemini-b}"
NEKO_USER_HOME="${NEKO_USER_HOME:-/home/neko}"
# The v3 image hardcodes "neko" / "admin" in /etc/neko/neko.yaml. The variables
# NEKO_PASSWORD / NEKO_PASSWORD_ADMIN are v2 names: they are ignored in silence
# and the file wins, which shows up as "Unauthorized" at login. The
# member.multiuser.* names are the ones that count.
PASSWORD="${NEKO_PASSWORD:-$(head -c 9 /dev/urandom | base64 | tr -d '/+=' )}"

# The browser profile outlives the container: without it the Google session
# disappears on the first restart. One profile per account, like the identity.
#
# A named volume rather than a host mount: in rootless podman a host directory
# arrives with ownership the `neko` user cannot write, and Chromium dies in a
# loop (SIGTRAP, profile cannot be created). Podman seeds a named volume from
# the image, so the permissions are right.
NEKO_PROFILE="${NEKO_PROFILE:-neko-profile-b}"

# Port 8080 only serves the interface. The picture itself arrives over WebRTC:
# with no multiplexing port published, the page loads and stays "disconnected".
# One mux port is enough — UDP with a TCP fallback, both on the loopback.
MUX="${NEKO_MUX_PORT:-9451}"

case "${1:-start}" in

start)
  [ -x "$AGY_BIN" ] || { echo "agy binary not found: $AGY_BIN" >&2; exit 1; }
  mkdir -p "$AGY_HOME"
  podman rm -f "$NAME" >/dev/null 2>&1 || true

  # --cgroups=disabled: rootless podman 4.3.1 otherwise refuses every `podman exec`
  podman run -d --name "$NAME" \
    --shm-size=1g \
    --cgroups=disabled \
    -p "127.0.0.1:${PORT}:8080" \
    -p "127.0.0.1:${MUX}:${MUX}/udp" \
    -p "127.0.0.1:${MUX}:${MUX}/tcp" \
    -e "NEKO_WEBRTC_UDPMUX=${MUX}" \
    -e "NEKO_WEBRTC_TCPMUX=${MUX}" \
    -e "NEKO_WEBRTC_NAT1TO1=127.0.0.1" \
    -e "NEKO_MEMBER_MULTIUSER_USER_PASSWORD=${PASSWORD}" \
    -e "NEKO_MEMBER_MULTIUSER_ADMIN_PASSWORD=${PASSWORD}" \
    -e "NEKO_SCREEN=${NEKO_SCREEN:-1280x720@30}" \
    -v "${AGY_BIN}:/usr/local/bin/agy:ro" \
    -v "${AGY_HOME}:${NEKO_USER_HOME}/.gemini" \
    -v "${NEKO_PROFILE}:${NEKO_USER_HOME}/.config/chromium" \
    "$IMAGE" >/dev/null

  echo "universe  ${NAME}"
  echo "browser   http://127.0.0.1:${PORT}"
  echo "password  ${PASSWORD}"
  echo "identity  ${AGY_HOME}  ->  ${NEKO_USER_HOME}/.gemini"
  echo
  echo "1. open the browser above and sign in to the Google account you want"
  echo "2. then run: $0 login"
  ;;

open)
  # Hands a URL to the Chromium already running in the universe. Not CDP — just
  # launching the browser with an address, which the running instance picks up.
  [ -n "${2:-}" ] || { echo "usage: $0 open <url>" >&2; exit 2; }
  podman exec -u neko -e DISPLAY=:99 "$NAME" \
    chromium --user-data-dir="${NEKO_USER_HOME}/.config/chromium" "$2" >/dev/null 2>&1 &
  sleep 3
  podman exec -u neko -e DISPLAY=:99 "$NAME" \
    xdotool search --onlyvisible --class chromium getwindowname %@ 2>/dev/null | head -2
  ;;

login)
  # Run this from a real terminal: the authorization code only enters through
  # standard input.
  #
  # Above all, NO `-p` here. Print mode cuts authentication off after 60 s
  # ("Print mode: auth timed out" in cli.log) — impossible to hold when you must
  # pick an account, consent, then copy the code back. Bare `agy` opens the
  # interactive flow without that guillotine.
  echo "A URL will appear. Open it in the Neko browser (already signed in),"
  echo "consent, then paste the code back here. Take your time."
  echo
  podman exec -it "$NAME" env HOME="$NEKO_USER_HOME" agy
  ;;

check)
  podman exec "$NAME" env HOME="$NEKO_USER_HOME" \
    agy --print "Reply with OK only." \
        --effort low --model gemini-3.7-flash-low \
        --output-format json --dangerously-skip-permissions
  ;;

stop)
  podman rm -f "$NAME" >/dev/null 2>&1 || true
  echo "universe ${NAME} torn down — the identity stays in ${AGY_HOME}"
  ;;

*)
  echo "usage: $0 {start|open <url>|login|check|stop}" >&2; exit 2 ;;
esac
