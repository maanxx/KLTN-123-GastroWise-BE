#!/usr/bin/env bash
set -euo pipefail

# GastroWise Ephemeral Restore Verification Script (`BLK-10` / M8.4 Recovery Validation)
#
# Verifies backup integrity end-to-end against an isolated non-production MongoDB 7.0 target:
# 1. Aborts immediately if RESTORE_TARGET_URI looks like MongoDB Atlas / production (`mongodb+srv://`).
# 2. Verifies artifact SHA-256 checksum & `gzip -t` integrity (decrypting `.enc` if needed).
# 3. Restores archive via `mongorestore --archive --gzip --drop --maintainInsertionOrder`.
# 4. Audits restored collections, document counts, and indexes, emitting a JSON summary.

ARCHIVE_INPUT="${1:-${RESTORE_ARCHIVE_PATH:-}}"
if [[ -z "${ARCHIVE_INPUT}" || ! -f "${ARCHIVE_INPUT}" ]]; then
  echo "[verify-restore] ERROR: Archive path is required and must exist." >&2
  exit 1
fi

if [[ -z "${RESTORE_TARGET_URI:-}" ]]; then
  echo "[verify-restore] ERROR: RESTORE_TARGET_URI must point to an isolated test/staging mongo:7.0 server." >&2
  exit 1
fi

# Strict production safety guard: refuse Atlas / SRV / production hostnames
if [[ "${RESTORE_TARGET_URI}" == mongodb+srv://* || "${RESTORE_TARGET_URI}" == *"mongodb.net"* ]]; then
  echo "[verify-restore] ABORT: Refusing to run restore verification against Atlas/production URI!" >&2
  exit 1
fi

TARGET_DB="${RESTORE_TARGET_DB:-gastro_restore_verify}"
START_EPOCH="$(date +%s)"

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

SHA_FILE="${ARCHIVE_INPUT}.sha256"
if [[ -f "${SHA_FILE}" ]]; then
  EXPECTED_SHA="$(awk '{print $1}' "${SHA_FILE}")"
  ACTUAL_SHA="$(sha256_file "${ARCHIVE_INPUT}")"
  if [[ "${EXPECTED_SHA}" != "${ACTUAL_SHA}" ]]; then
    echo "[verify-restore] ERROR: SHA-256 mismatch! expected=${EXPECTED_SHA} actual=${ACTUAL_SHA}" >&2
    exit 1
  fi
  echo "[verify-restore] Checksum verified: ${ACTUAL_SHA}"
else
  # Sidecar is mandatory: a missing .sha256 means the backup pipeline failed to upload it,
  # or the archive was tampered with. Refuse to restore without integrity proof.
  echo "[verify-restore] ERROR: SHA-256 sidecar not found: ${SHA_FILE}" >&2
  echo "[verify-restore] A missing sidecar may indicate a corrupted or tampered backup." >&2
  exit 1
fi

WORK_ARCHIVE="${ARCHIVE_INPUT}"
CLEANUP_TMP="false"
if [[ "${ARCHIVE_INPUT}" == *.enc ]]; then
  if [[ -z "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]]; then
    echo "[verify-restore] ERROR: BACKUP_ENCRYPTION_PASSPHRASE required to decrypt ${ARCHIVE_INPUT}" >&2
    exit 1
  fi
  WORK_ARCHIVE="/tmp/gastrowise_verify_decrypted_$$.archive.gz"
  CLEANUP_TMP="true"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 \
    -in "${ARCHIVE_INPUT}" -out "${WORK_ARCHIVE}" \
    -pass env:BACKUP_ENCRYPTION_PASSPHRASE
fi

cleanup() {
  if [[ "${CLEANUP_TMP}" == "true" && -f "${WORK_ARCHIVE}" ]]; then
    rm -f "${WORK_ARCHIVE}"
  fi
}
trap cleanup EXIT

echo "[verify-restore] Testing gzip integrity..."
gzip -t "${WORK_ARCHIVE}"

SOURCE_DB="${RESTORE_SOURCE_DB:-${TARGET_DB}}"

# Strip any database path from URI when passing --nsInclude / --nsFrom / --nsTo
# so mongorestore 100.x does not implicitly scope to the URI path db only.
CLEAN_RESTORE_URI="$(printf '%s' "${RESTORE_TARGET_URI}" | sed -E 's#(mongodb(\+srv)?://[^/]+)/[^?]*(\?.*)?#\1/\3#')"

RESTORE_ARGS=(
  "--uri=${CLEAN_RESTORE_URI}"
  "--archive=${WORK_ARCHIVE}"
  "--gzip"
  "--drop"
  "--maintainInsertionOrder"
  "--nsInclude=${SOURCE_DB}.*"
)

if [[ "${SOURCE_DB}" != "${TARGET_DB}" ]]; then
  RESTORE_ARGS+=("--nsFrom=${SOURCE_DB}.*" "--nsTo=${TARGET_DB}.*")
fi

echo "[verify-restore] Executing mongorestore (source='${SOURCE_DB}' -> target='${TARGET_DB}')..."
mongorestore "${RESTORE_ARGS[@]}"

END_EPOCH="$(date +%s)"
DURATION_SEC=$((END_EPOCH - START_EPOCH))

echo "[verify-restore] Auditing restored collections and indexes..."
AUDIT_JSON="$(mongosh "${RESTORE_TARGET_URI}" --quiet --eval "
const target = db.getSiblingDB('${TARGET_DB}');
const cols = target.getCollectionNames().sort().map(name => ({
  name,
  documents: target.getCollection(name).countDocuments({}),
  indexes: target.getCollection(name).getIndexes().map(i => i.name)
}));
const totalDocuments = cols.reduce((acc, c) => acc + c.documents, 0);
print(JSON.stringify({ database: '${TARGET_DB}', durationSec: ${DURATION_SEC}, collectionCount: cols.length, totalDocuments, collections: cols }, null, 2));
if (cols.length === 0 || (totalDocuments === 0 && '${ALLOW_EMPTY_RESTORE:-false}' !== 'true')) {
  quit(2);
}
")"

echo "${AUDIT_JSON}"
echo "[verify-restore] PASS (${DURATION_SEC}s)"
