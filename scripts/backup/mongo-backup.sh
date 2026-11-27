#!/usr/bin/env bash
set -euo pipefail

# GastroWise Production / Staging MongoDB Backup Script (`BLK-10` / M8.4)
#
# Performs compressed `mongodump --archive --gzip` with:
# - Credential redaction in all logs (never prints URIs with passwords)
# - Pre-upload gzip integrity (`gzip -t`) + SHA-256 manifest generation
# - Optional client-side AES-256-CBC (PBKDF2) encryption via BACKUP_ENCRYPTION_PASSPHRASE
# - Optional S3 / Cloudflare R2 / S3-compatible upload with SSE & WORM Object Lock flags
#
# Required env:
#   BACKUP_MONGO_URI       Source MongoDB URI (must use dedicated least-privilege `backup` role)
#   BACKUP_DB_NAME         Logical DB scope (e.g. gastro_core or gastro_planning)
# Optional env:
#   BACKUP_OUT_DIR         Local staging directory (default: /tmp/gastrowise-backups)
#   BACKUP_TIER            daily | weekly | monthly | pre-migration (default: daily)
#   BACKUP_USE_OPLOG       true | false (default: false; enable on replica sets / Atlas M10+)
#   BACKUP_REQUIRE_TLS     true | false (default: true when uri is mongodb+srv://)
#   BACKUP_ENCRYPTION_PASSPHRASE  If set, encrypts archive -> <archive>.enc via OpenSSL AES-256
#   BACKUP_S3_BUCKET       Target bucket (e.g. s3://gastrowise-db-backups)
#   BACKUP_S3_ENDPOINT_URL Optional S3-compatible endpoint (e.g. R2)
#   BACKUP_OBJECT_LOCK_MODE       GOVERNANCE | COMPLIANCE (optional WORM retention)
#   BACKUP_RETENTION_DAYS  Retention days for Object Lock & metadata (default: 30)

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "[mongo-backup] ERROR: Missing required environment variable ${name}" >&2
    exit 1
  fi
}

redact_uri() {
  sed -E 's#(mongodb(\+srv)?://)[^/@]+@#\1[REDACTED_AUTH]@#g'
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

require_env BACKUP_MONGO_URI
require_env BACKUP_DB_NAME

BACKUP_OUT_DIR="${BACKUP_OUT_DIR:-/tmp/gastrowise-backups}"
BACKUP_TIER="${BACKUP_TIER:-daily}"
BACKUP_USE_OPLOG="${BACKUP_USE_OPLOG:-false}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

if [[ "${BACKUP_MONGO_URI}" == mongodb+srv://* ]]; then
  BACKUP_REQUIRE_TLS="${BACKUP_REQUIRE_TLS:-true}"
else
  BACKUP_REQUIRE_TLS="${BACKUP_REQUIRE_TLS:-false}"
fi

if [[ "${BACKUP_REQUIRE_TLS}" == "true" ]]; then
  if [[ "${BACKUP_MONGO_URI}" != mongodb+srv://* && "${BACKUP_MONGO_URI}" != *"tls=true"* && "${BACKUP_MONGO_URI}" != *"ssl=true"* ]]; then
    echo "[mongo-backup] ERROR: TLS in transit is required when BACKUP_REQUIRE_TLS=true." >&2
    exit 1
  fi
fi

mkdir -p "${BACKUP_OUT_DIR}"
chmod 700 "${BACKUP_OUT_DIR}" || true

STAMP_UTC="$(date -u +%Y%m%dT%H%M%SZ)"
BASE_NAME="gastrowise_${BACKUP_DB_NAME}_${BACKUP_TIER}_${STAMP_UTC}"
ARCHIVE_PATH="${BACKUP_OUT_DIR}/${BASE_NAME}.archive.gz"
MANIFEST_PATH="${BACKUP_OUT_DIR}/${BASE_NAME}.manifest.json"
SHA_PATH="${ARCHIVE_PATH}.sha256"

SAFE_TARGET="$(printf '%s' "${BACKUP_MONGO_URI}" | redact_uri)"
echo "[mongo-backup] Starting backup db='${BACKUP_DB_NAME}' tier='${BACKUP_TIER}' target='${SAFE_TARGET}'"

DUMP_ARGS=(
  "--uri=${BACKUP_MONGO_URI}"
  "--db=${BACKUP_DB_NAME}"
  "--archive=${ARCHIVE_PATH}"
  "--gzip"
)
if [[ "${BACKUP_USE_OPLOG}" == "true" ]]; then
  DUMP_ARGS+=("--oplog")
fi

mongodump "${DUMP_ARGS[@]}"

if [[ ! -s "${ARCHIVE_PATH}" ]]; then
  echo "[mongo-backup] ERROR: Backup archive is missing or empty: ${ARCHIVE_PATH}" >&2
  exit 1
fi

echo "[mongo-backup] Verifying gzip integrity..."
gzip -t "${ARCHIVE_PATH}"

PLAIN_SHA="$(sha256_file "${ARCHIVE_PATH}")"
PLAIN_BYTES="$(wc -c < "${ARCHIVE_PATH}" | tr -d ' ')"
printf "%s  %s\n" "${PLAIN_SHA}" "$(basename "${ARCHIVE_PATH}")" > "${SHA_PATH}"

ARTIFACT_PATH="${ARCHIVE_PATH}"
ARTIFACT_SHA="${PLAIN_SHA}"
ENCRYPTED="false"

if [[ -n "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]]; then
  command -v openssl >/dev/null 2>&1 || { echo "[mongo-backup] ERROR: openssl required for encryption" >&2; exit 1; }
  ENC_PATH="${ARCHIVE_PATH}.enc"
  openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt \
    -in "${ARCHIVE_PATH}" -out "${ENC_PATH}" \
    -pass env:BACKUP_ENCRYPTION_PASSPHRASE
  ARTIFACT_PATH="${ENC_PATH}"
  ARTIFACT_SHA="$(sha256_file "${ENC_PATH}")"
  printf "%s  %s\n" "${ARTIFACT_SHA}" "$(basename "${ENC_PATH}")" > "${ENC_PATH}.sha256"
  ENCRYPTED="true"
  rm -f "${ARCHIVE_PATH}"
fi

cat > "${MANIFEST_PATH}" <<EOF
{
  "database": "${BACKUP_DB_NAME}",
  "tier": "${BACKUP_TIER}",
  "createdAtUtc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "artifactFile": "$(basename "${ARTIFACT_PATH}")",
  "archiveBytes": ${PLAIN_BYTES},
  "plaintextSha256": "${PLAIN_SHA}",
  "artifactSha256": "${ARTIFACT_SHA}",
  "encrypted": ${ENCRYPTED},
  "oplogIncluded": ${BACKUP_USE_OPLOG},
  "retentionDays": ${BACKUP_RETENTION_DAYS}
}
EOF

echo "[mongo-backup] Archive ready: ${ARTIFACT_PATH} (sha256=${ARTIFACT_SHA}, bytes=${PLAIN_BYTES}, encrypted=${ENCRYPTED})"

if [[ -n "${BACKUP_S3_BUCKET:-}" ]]; then
  command -v aws >/dev/null 2>&1 || { echo "[mongo-backup] ERROR: aws CLI required for BACKUP_S3_BUCKET upload" >&2; exit 1; }
  DEST_PREFIX="${BACKUP_S3_BUCKET%/}/${BACKUP_DB_NAME}/${BACKUP_TIER}"
  AWS_ARGS=(s3 cp)
  if [[ -n "${BACKUP_S3_ENDPOINT_URL:-}" ]]; then
    AWS_ARGS+=(--endpoint-url "${BACKUP_S3_ENDPOINT_URL}")
  fi
  EXTRA_LOCK_ARGS=()
  if [[ -n "${BACKUP_OBJECT_LOCK_MODE:-}" ]]; then
    RETAIN_UNTIL="$(date -u -d "+${BACKUP_RETENTION_DAYS} days" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v+"${BACKUP_RETENTION_DAYS}"d +%Y-%m-%dT%H:%M:%SZ)"
    EXTRA_LOCK_ARGS+=(--object-lock-mode "${BACKUP_OBJECT_LOCK_MODE}" --object-lock-retain-until-date "${RETAIN_UNTIL}")
  fi

  # Upload artifact (encrypted .enc or plain .archive.gz)
  aws "${AWS_ARGS[@]}" "${ARTIFACT_PATH}" "${DEST_PREFIX}/$(basename "${ARTIFACT_PATH}")" --sse AES256 "${EXTRA_LOCK_ARGS[@]}"
  # Upload SHA-256 sidecar (.sha256) so verify-restore.sh can enforce mandatory checksum verification
  ARTIFACT_SHA_PATH="${ARTIFACT_PATH}.sha256"
  if [[ -f "${ARTIFACT_SHA_PATH}" ]]; then
    aws "${AWS_ARGS[@]}" "${ARTIFACT_SHA_PATH}" "${DEST_PREFIX}/$(basename "${ARTIFACT_SHA_PATH}")" --sse AES256 "${EXTRA_LOCK_ARGS[@]}"
  else
    echo "[mongo-backup] WARNING: SHA-256 sidecar not found at ${ARTIFACT_SHA_PATH} — skipping sidecar upload" >&2
  fi
  # Upload JSON manifest
  aws "${AWS_ARGS[@]}" "${MANIFEST_PATH}" "${DEST_PREFIX}/$(basename "${MANIFEST_PATH}")" --sse AES256 "${EXTRA_LOCK_ARGS[@]}"
  echo "[mongo-backup] Uploaded archive, sha256 sidecar and manifest to ${DEST_PREFIX}"
fi
