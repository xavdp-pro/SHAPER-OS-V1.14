#!/usr/bin/env bash
set -euo pipefail

SLUG="univ-demo"
echo "[podman-down] Stopping ${SLUG} stack..."
podman stop -t 2 \
  "${SLUG}-vault" "${SLUG}-logger" "${SLUG}-bridge-opencode" \
  "${SLUG}-queue" "${SLUG}-maestro" "${SLUG}-helm" "${SLUG}-tunnel" \
  2>/dev/null || true
podman rm -f \
  "${SLUG}-vault" "${SLUG}-logger" "${SLUG}-bridge-opencode" \
  "${SLUG}-queue" "${SLUG}-maestro" "${SLUG}-helm" "${SLUG}-tunnel" \
  2>/dev/null || true
echo "[podman-down] OK"
