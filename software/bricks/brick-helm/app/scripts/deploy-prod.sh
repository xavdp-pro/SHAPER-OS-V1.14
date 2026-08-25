#!/usr/bin/env bash
# Deploie helm-v2 en prod (vite preview, sans HMR) et VERIFIE que le navigateur
# recevra bien le nouveau bundle.
#
#   npm run deploy:prod
#
# Le piege recurrent : `vite preview` sert dist/ en memoire. Si le build echoue
# ou si dist/ appartient a root (build lance en sudo) alors que pm2 tourne en
# helm-v2, le serveur continue de servir l'ancien bundle sans erreur visible.
# Ce script casse ce silence : il compare le hash servi HTTP avant / apres.
set -euo pipefail

APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_ROOT"

PORT="${HELM_WEB_PORT:-7923}"
API_PORT="${HELM_API_PORT:-7926}"
APP_USER="${HELM_APP_USER:-helm-v2}"
URL="http://127.0.0.1:${PORT}/"

say() { echo "[deploy-prod] $*"; }
die() { echo "[deploy-prod] ERREUR: $*" >&2; exit 1; }

# Hash du bundle JS reference dans l'index servi (ex: index-BzcEtTB2.js).
served_bundle() {
  curl -s --max-time 10 "$URL" 2>/dev/null \
    | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1 || true
}

BEFORE="$(served_bundle)"
say "bundle servi avant : ${BEFORE:-<serveur muet>}"

# 1) Proprietaire : un dist/ root-owned fait echouer le build suivant lance en
#    tant qu'APP_USER, silencieusement pour l'utilisateur.
if [[ "$(id -u)" -eq 0 ]]; then
  say "normalisation des droits (${APP_USER}:www-data) sur src/ dist/ public/"
  chown -R "${APP_USER}:www-data" src dist public 2>/dev/null || true
fi

# Tout ce qui touche dist/ ou pm2 tourne sous APP_USER : c'est lui qui detient
# le daemon pm2, et dist/ doit lui appartenir pour que le build suivant passe.
as_app_user() {
  if [[ "$(id -u)" -eq 0 ]] && command -v runuser >/dev/null 2>&1; then
    runuser -u "$APP_USER" -- "$@"
  else
    "$@"
  fi
}

# 2) Build. Lance en tant qu'APP_USER si on est root, pour que dist/ lui appartienne.
say "build vite…"
as_app_user npm run build || die "build echoue"

[[ -f dist/index.html ]] || die "dist/index.html absent apres le build"

NEW_BUNDLE="$(grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' dist/index.html | head -1)"
[[ -n "$NEW_BUNDLE" ]] || die "aucun bundle index-*.js dans dist/index.html"
say "bundle construit : $NEW_BUNDLE"

# 3) Redemarrage pm2 en mode prod (ecosystem.prod = vite preview, pas de HMR).
#    Tout passe par APP_USER : c'est lui qui detient le daemon pm2. Lance en
#    root, ensure-api-port ne verrait pas le pid pm2 et tuerait l'API en cours.
say "redemarrage pm2 (ecosystem.prod.config.cjs)…"
as_app_user pm2 startOrReload ecosystem.prod.config.cjs --update-env

# Filet de securite : si le port API est reste squatte par un process orphelin,
# on le libere puis on relance uniquement l'API. On laisse d'abord a l'API le
# temps de se lier au port (sinon on la relance pour rien juste apres pm2).
api_up() {
  for _ in $(seq 1 15); do
    curl -s --max-time 3 -o /dev/null "http://127.0.0.1:${API_PORT}/api/health" && return 0
    sleep 1
  done
  return 1
}

if ! api_up; then
  say "API muette sur :${API_PORT} — liberation du port puis relance"
  as_app_user bash scripts/ensure-api-port.sh "$API_PORT" || true
  as_app_user pm2 restart helm-v2-api --update-env || true
fi

# 4) Verification : le serveur doit servir le bundle qu'on vient de construire.
say "verification HTTP sur $URL…"
for i in $(seq 1 20); do
  sleep 1
  AFTER="$(served_bundle)"
  [[ -n "$AFTER" ]] || continue
  if [[ "assets/${NEW_BUNDLE##*/}" == "$AFTER" || "$NEW_BUNDLE" == "$AFTER" ]]; then
    say "OK — le navigateur recevra $AFTER"
    if curl -s --max-time 10 "$URL" | grep -q '@vite/client'; then
      say "ATTENTION: @vite/client present — le serveur est en mode DEV (HMR), pas preview." >&2
      exit 1
    fi
    say "mode prod confirme (pas de HMR)"
    say "TERMINE. Recharge le navigateur (hard refresh si PWA en cache)."
    exit 0
  fi
  [[ $i -eq 1 ]] && say "attente du serveur (sert encore ${AFTER})…"
done

die "le serveur sert encore '${AFTER:-rien}' au lieu de '$NEW_BUNDLE' — build non pris en compte"
