# M9.6 — Production MongoDB Backup Pipeline & Restore Automation (`BLK-10`)

**Milestone:** M9.6 (`P1.3` from [`M8_8_REMEDIATION_ROADMAP.md`](./M8_8_REMEDIATION_ROADMAP.md))  
**Repository:** `maanxx/KLTN-123-GastroWise-BE`  
**Related Strategy:** [`M8_4_BACKUP_STRATEGY.md`](./M8_4_BACKUP_STRATEGY.md), [`M8_4_RESTORE_RUNBOOK.md`](./M8_4_RESTORE_RUNBOOK.md), [`M8_4_RECOVERY_VALIDATION.md`](./M8_4_RECOVERY_VALIDATION.md)

---

## 1. Implementation Summary

M9.6 translates M8.4's backup strategy into executable scripts and scheduled CI pipelines without connecting to production Atlas:

| Component | Purpose | Location |
| :--- | :--- | :--- |
| **Encrypted Dump & Upload Script** | Runs compressed `mongodump --archive --gzip` (`--oplog` optional), verifies `gzip -t`, computes SHA-256, optionally encrypts with AES-256-CBC PBKDF2 (`openssl`), generates `.manifest.json`, and uploads to S3/GCS-compat/R2 with SSE & WORM Object Lock flags. | [`scripts/backup/mongo-backup.sh`](../../scripts/backup/mongo-backup.sh) |
| **Isolated Restore Verification** | Guards against Atlas/production URIs (`mongodb+srv://` / `mongodb.net` refused), verifies SHA-256 & `gzip -t`, decrypts `.enc`, executes `mongorestore --drop --maintainInsertionOrder`, audits non-empty collection counts & indexes, and fails closed on empty/corrupted restores. | [`scripts/backup/verify-restore.sh`](../../scripts/backup/verify-restore.sh) |
| **Atlas Tier & PITR Audit Script** | Queries MongoDB Atlas Admin API to confirm `>= M10` cluster size, Cloud Backup enablement, and `pitEnabled: true`. | [`scripts/backup/atlas-tier-audit.sh`](../../scripts/backup/atlas-tier-audit.sh) |
| **Daily Backup CI Workflow** | Runs daily (`0 19 * * *` UTC / `02:00 ICT`) or `workflow_dispatch` for `gastro_core` and `gastro_planning` with TLS required, oplog capture, AES-256 encryption, S3 SSE + `GOVERNANCE` Object Lock retention, and manifest artifact retention. | [`mongodb-scheduled-backup.yml`](../../.github/workflows/mongodb-scheduled-backup.yml) |
| **Weekly Restore Drill Workflow** | Runs weekly (`0 20 * * 0` UTC / `03:00 ICT` Sunday) or `workflow_dispatch`, spinning up an ephemeral `mongo:7.0` service container, downloading latest daily archives, and running `verify-restore.sh`. | [`mongodb-weekly-restore-drill.yml`](../../.github/workflows/mongodb-weekly-restore-drill.yml) |

---

## 2. Security & Reliability Guardrails

1. **In-Transit & At-Rest Encryption:**
   - `mongo-backup.sh` enforces `tls=true` / `mongodb+srv://` whenever `BACKUP_REQUIRE_TLS=true` (automatic default for SRV URIs).
   - Archives support client-side AES-256 encryption (`ARCHIVE.archive.gz.enc`) via `BACKUP_ENCRYPTION_PASSPHRASE` plus cloud SSE (`--sse AES256`).
2. **Credential Safety:**
   - URIs are redacted (`mongodb://[REDACTED_AUTH]@...`) before logging.
   - `.gitignore` excludes `backups/`, `*.archive.gz`, `*.archive.gz.enc`, and `*.archive.gz.sha256`.
3. **Ransomware / WORM Retention:**
   - Supports S3/R2 `--object-lock-mode GOVERNANCE|COMPLIANCE` with `--object-lock-retain-until-date` computed from `BACKUP_RETENTION_DAYS`.
4. **Restore Target Guardrail:**
   - `verify-restore.sh` immediately aborts if `RESTORE_TARGET_URI` contains `mongodb+srv://` or `mongodb.net`.
   - Explicitly validates both `collectionCount > 0` and `totalDocuments > 0` (fixing silent `0 document(s) restored` false positives).

---

## 3. Blocked External Production Gates (`BLK-10` / `BLK-11` / `BLK-13`)

| External Prerequisite | Current Status | Owner Action Required |
| :--- | :---: | :--- |
| **`BLK-11` Staging-Clone Data Audit** | **UNRESOLVED** | Provision isolated Atlas snapshot clone & run [`M9_5_STAGING_AUDIT_PLAN.md`](./M9_5_STAGING_AUDIT_PLAN.md) |
| **Atlas `M10+` Cluster Tier & Cloud PITR Verification** | **PENDING INFRA** | Configure `ATLAS_*` keys in CI / run `atlas-tier-audit.sh` |
| **Object Storage Bucket + WORM Object Lock + Secrets** | **PENDING INFRA** | Provision versioned S3/GCS/R2 bucket with Object Lock & set GitHub Environment Secrets (`BACKUP_MONGO_URI_*`, `BACKUP_ENCRYPTION_PASSPHRASE`, `BACKUP_S3_*`) |
| **First Live Cloud Pre-Migration Snapshot (`M8_4_RECOVERY_VALIDATION.md`)** | **PENDING EXEC** | Run `mongodb-scheduled-backup.yml` (`pre-migration` tier) & `mongodb-weekly-restore-drill.yml` once secrets exist |
