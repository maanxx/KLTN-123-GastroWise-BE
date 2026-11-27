#!/usr/bin/env bash
set -euo pipefail

# Idempotently provision MongoDB SCRAM users on a running Docker mongo-test container
# (useful when enabling --auth on a pre-existing non-empty persistent volume where
# /docker-entrypoint-initdb.d scripts are skipped by MongoDB).
#
# Usage:
#   ./docker/mongo/ensure-auth-users.sh [container_name]
#
# If the database already has --auth enabled, set MONGO_INITDB_ROOT_USERNAME and
# MONGO_INITDB_ROOT_PASSWORD (or MONGODB_ROOT_USERNAME / MONGODB_ROOT_PASSWORD).

CONTAINER_NAME="${1:-gastrowise-mongo-test}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INIT_JS="${SCRIPT_DIR}/01-init-users.js"

ROOT_USER="${MONGO_INITDB_ROOT_USERNAME:-${MONGODB_ROOT_USERNAME:-}}"
ROOT_PASS="${MONGO_INITDB_ROOT_PASSWORD:-${MONGODB_ROOT_PASSWORD:-}}"

AUTH_FLAGS=()
if [[ -n "${ROOT_USER}" && -n "${ROOT_PASS}" ]]; then
  # Only pass auth flags if authentication is already active or admin user already exists;
  # fallback to unauthenticated local socket if database has not enabled --auth yet.
  if docker exec "${CONTAINER_NAME}" mongosh --quiet \
    -u "${ROOT_USER}" -p "${ROOT_PASS}" --authenticationDatabase admin \
    --eval "db.adminCommand('ping')" >/dev/null 2>&1; then
    AUTH_FLAGS=(-u "${ROOT_USER}" -p "${ROOT_PASS}" --authenticationDatabase admin)
  fi
fi

ENV_FLAGS=()
for var_name in \
  MONGO_INITDB_ROOT_USERNAME MONGO_INITDB_ROOT_PASSWORD \
  MONGODB_ROOT_USERNAME MONGODB_ROOT_PASSWORD \
  CORE_DB_NAME PLANNING_DB_NAME \
  CORE_DB_USER CORE_DB_PASSWORD \
  PLANNING_DB_USER PLANNING_DB_PASSWORD \
  AI_DB_USER AI_DB_PASSWORD; do
  if [[ -n "${!var_name:-}" ]]; then
    ENV_FLAGS+=(-e "${var_name}=${!var_name}")
  fi
done

echo "[ensure-auth-users] Running idempotent user sync against container '${CONTAINER_NAME}'..."
docker exec -i "${ENV_FLAGS[@]}" "${CONTAINER_NAME}" mongosh --quiet "${AUTH_FLAGS[@]}" < "${INIT_JS}"
echo "[ensure-auth-users] Done."
