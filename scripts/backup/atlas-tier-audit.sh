#!/usr/bin/env bash
set -euo pipefail

# GastroWise MongoDB Atlas Cluster Tier & Cloud Backup Readiness Audit (`BLK-10`)
# Queries the MongoDB Atlas Admin API using digest authentication (never stores keys in git).
# Verifies whether the production cluster meets >= M10 tier & continuous Cloud PITR backup requirements.
#
# Required env:
#   ATLAS_PUBLIC_KEY
#   ATLAS_PRIVATE_KEY
#   ATLAS_GROUP_ID        (Atlas Project ID)
#   ATLAS_CLUSTER_NAME

for v in ATLAS_PUBLIC_KEY ATLAS_PRIVATE_KEY ATLAS_GROUP_ID ATLAS_CLUSTER_NAME; do
  if [[ -z "${!v:-}" ]]; then
    echo "[atlas-tier-audit] ERROR: Missing ${v}" >&2
    exit 1
  fi
done

API_BASE="https://cloud.mongodb.com/api/atlas/v2/groups/${ATLAS_GROUP_ID}/clusters/${ATLAS_CLUSTER_NAME}"
RESP="$(curl -sS --digest -u "${ATLAS_PUBLIC_KEY}:${ATLAS_PRIVATE_KEY}" \
  -H "Accept: application/vnd.atlas.2023-02-01+json" "${API_BASE}")"

node -e "
const cluster = JSON.parse(process.argv[1]);
const instanceSize = cluster?.replicationSpecs?.[0]?.regionConfigs?.[0]?.electableSpecs?.instanceSize
  || cluster?.providerSettings?.instanceSizeName || 'UNKNOWN';
const pitEnabled = Boolean(cluster?.pitEnabled);
const backupEnabled = Boolean(cluster?.backupEnabled);
// Explicitly known non-compliant shared tiers — but UNKNOWN also fails closed:
// any instance size that is not a recognized dedicated tier is treated as non-compliant.
const DEDICATED_TIERS = /^M(10|20|30|40|50|60|80|140|200|300|400|700)$/;
const isDedicated = DEDICATED_TIERS.test(instanceSize);
const summary = {
  clusterName: cluster.name,
  mongoDBVersion: cluster.mongoDBVersion,
  instanceSize,
  cloudBackupEnabled: backupEnabled,
  continuousPitEnabled: pitEnabled,
  m10PlusCompliant: isDedicated && backupEnabled && pitEnabled
};
console.log(JSON.stringify(summary, null, 2));
if (!summary.m10PlusCompliant) {
  console.error('[atlas-tier-audit] FAIL-CLOSED: instanceSize=' + instanceSize +
    ' — cluster does not satisfy M10+ dedicated tier with continuous PITR Cloud Backup compliance.');
  process.exit(2);
}
" "${RESP}"
