# M8.4 — GastroWise MongoDB Backup Strategy, RPO/RTO & Security

- **Repository:** `maanxx/KLTN-123-GastroWise-BE`
- **Branch:** `feature/m8-4-backup-restore-strategy` (branched from M8.3 `feature/m8-3-migration-strategy` `ea55f13e330e4eca582230ec09719c1c2e403854`)
- **Related Docs:** [`M8_3_MIGRATION_STRATEGY.md`](./M8_3_MIGRATION_STRATEGY.md), [`M8_4_RESTORE_RUNBOOK.md`](./M8_4_RESTORE_RUNBOOK.md), [`M8_4_RECOVERY_VALIDATION.md`](./M8_4_RECOVERY_VALIDATION.md)
- **Scope:** Planning & documentation only. No production backups, restores, or schema mutations were executed in this milestone.

---

## 1. Backup Inventory (M8.4.1)

### 1.1 Database Instances & Current State

| Environment / Instance | Logical Databases | Access Pattern | Current Backup State (Observed in Repo) |
|---|---|---|---|
| **Production / Shared MongoDB Atlas (`MONGODB_URI*`)** | `gastro_core` (`CORE_DB_NAME`), `gastro_planning` (`PLANNING_DB_NAME`), legacy `gastrowise` (`MONGODB_DB_NAME`) | Core RW (`gastro_core`), Planning RW (`gastro_planning`), AI Read-Only (`restaurants`) | **No automated backup scripts, cron jobs, or restore drills exist in repository.** Relies entirely on external MongoDB Atlas tier defaults (unverified in-repo). |
| **Isolated Local/CI Docker (`docker-compose.yml`)** | `gastro_core_test`, `gastro_planning_test`, `gastro_ai_test` (`mongo:7.0`) | Ephemeral CI/dev containers | Ephemeral (`mongo-test`, recreated per run — no persistence needed). |

### 1.2 Collection Criticality, Dependencies & Priority Matrix

| Priority Tier | Database | Collection | Data Category & Business Dependencies |
|---|---|---|---|
| **Tier 1 (Critical Business & Identity)** | `gastro_core` | `users` | Authentication identities (`username`, `email`, bcrypt `password`, 2FA secrets, roles, `savedRestaurants[]`). Referenced by `reviews`, `taste_dna_profiles`, `user_interactions`, `restaurants.ownerId`, `itineraries.user_id`. |
| **Tier 1 (Critical Catalog)** | `gastro_core` | `restaurants` | Core restaurant catalog, GeoJSON `location`, rating scores (`diemTrungBinh`). Referenced by `menu_items`, `reviews`, `users.savedRestaurants[]`, Planning snapshots, and loaded into memory by AI Service. |
| **Tier 1 (Core Planning Data)** | `gastro_planning` | `itineraries` | User-generated food tour itineraries with embedded `stops[]` snapshots (`user_id`, audit trail `confirmedAt`/`completedAt`). |
| **Tier 2 (High-Value User Data)** | `gastro_core` | `reviews` | User ratings, review text, AI sentiment labels/scores, `restaurantId` / `userId` links. Drives `restaurants.diemTrungBinh` & `reviewsCount`. |
| **Tier 2 (Personalization & Menu)** | `gastro_core` | `taste_dna_profiles`, `menu_items` | 6-D Taste DNA vectors (`userId` unique) & venue menus (`restaurantId`). |
| **Tier 3 (Operational / Telemetry)** | `gastro_core` | `user_interactions`, `contacts` | Telemetry event stream (feeds AI `/cf/train` up to `5000` recent rows) and user/merchant contact inquiries. Re-generatable or lower transactional criticality. |
| **Metadata / Audit (Proposed M8.3+)** | Both | `schema_migrations`, `_archive_*` | Migration ledger & pre-dedup archives created during M8.3+ rollout. |

---

## 2. Backup Architecture & Strategy (M8.4.2)

### 2.1 Currently Available vs. Proposed Future Infrastructure

- **Currently Available in Repo:** None for automated backup/restore (only manual `scripts/db-split-dryrun.ts` boundary inspection and `docker-compose.yml` `mongo:7.0` ephemeral isolation).
- **Proposed Dual-Layer Architecture (Future Implementation):**
  1. **Layer 1 — Managed Physical Snapshots & Continuous Oplog (MongoDB Atlas M10+ Recommended for Production):** Disk-level cloud snapshots + continuous oplog tailing enabling Point-in-Time Recovery (PITR) across replica sets with minimal application I/O impact. *(Fallback if running on Atlas M0/M2/M5 Shared Tier where Cloud PITR is unavailable: increase Layer 2 `mongodump` frequency.)*
  2. **Layer 2 — Portable Logical Archive Backups (`mongodump` / `mongorestore`):** Compressed BSON + index-metadata archives (`mongodump --uri=... --db=... --archive=<file>.archive.gz --gzip`) stored outside the MongoDB cluster (object storage e.g. S3/GCS/R2 with separate account credentials). Supports single-collection restores, cross-environment cloning into `mongo:7.0`, and pre-migration gates.

### 2.2 Backup Modes, Schedule & Retention Policy

| Backup Type | Tooling | Frequency | Retention Policy (GFS) | Target Scope |
|---|---|---|---|---|
| **Full Logical Snapshot** | `mongodump --archive --gzip` (+ `--oplog` if replica set permits) | **Daily** (`02:00 ICT` low-traffic window) | `7` daily, `4` weekly (Sunday), `3` monthly | `gastro_core` & `gastro_planning` separately |
| **Incremental / Continuous Oplog** | MongoDB Atlas Continuous Cloud Backup (when M10+ enabled) | Continuous oplog stream (every ~1–5 min checkpoint) | `24h–72h` PITR window (tier dependent) | Production replica set |
| **High-Frequency Tier-1 Logical (If Shared Tier / Pre-PITR)** | `mongodump` scoped to Tier-1 + Tier-2 collections | **Every 6 hours** | `48 hours` rolling | `users`, `restaurants`, `itineraries`, `reviews`, `taste_dna_profiles` |
| **Pre-Migration / Pre-Release Gate** | Scripted `mongodump --archive --gzip` | **On-demand before every schema/data migration** | Minimum `30 days` (pinned) | Target migration DB(s) |

### 2.3 Integrity Verification & Storage Isolation

- **Integrity Check:** Generate `sha256sum <archive>.archive.gz` immediately after dump completion and verify `gzip -t` + `mongorestore --dryRun` (plus weekly automated restore test into ephemeral `mongo:7.0`).
- **Storage Isolation:** Backups **must never** reside on the database host or inside the application repository/Git LFS. Store in dedicated cloud object storage in an isolated region/bucket separated from application compute.

---

## 3. Recovery Objectives — Proposed RPO & RTO Targets (M8.4.3)

*Note: GastroWise currently has **no existing production SLAs** in repository docs. The targets below are **proposed engineering objectives** sized for a graduation-project production deployment.*

| Data Tier | Collections | Proposed RPO (Max Data Loss) | Proposed RTO (Max Recovery Time) | Engineering Rationale |
|---|---|---|---|---|
| **Tier 1** (Identity, Catalog, Itineraries) | `users`, `restaurants`, `itineraries` | **Atlas M10+ PITR:** `<= 5 minutes`<br/>**Logical-only Tier:** `<= 6 hours` | **`<= 30 minutes`** (PITR/full DB) / `<= 45 minutes` (logical restore) | User logins, auth state, and active itineraries cannot tolerate multi-day loss; catalog restores unblocks Core, Planning, and AI immediately. |
| **Tier 2** (Reviews, Taste DNA, Menus) | `reviews`, `taste_dna_profiles`, `menu_items` | **`<= 6 hours`** (or PITR) | **`<= 60 minutes`** | Directly affects user trust, restaurant ratings, and personalized recommendations. |
| **Tier 3** (Telemetry & Inquiries) | `user_interactions`, `contacts` | **`<= 24 hours`** | **`<= 4 hours`** | High-volume clickstream logs (`user_interactions`) can lose up to 1 day without breaking Core/Planning availability (`cf_engine` falls back safely to cold-start Content/Weather weights). |

---

## 4. Security & Access Control Requirements (M8.4.5)

- **Encryption in Transit:** Enforce TLS/SSL (`mongodb+srv://` with `tls=true`) on all `mongodump`/`mongorestore` and S3/GCS upload connections (`HTTPS/TLS 1.2+`).
- **Encryption at Rest:** Rely on MongoDB Atlas AES-256 volume encryption + Server-Side Encryption (SSE-S3 / SSE-KMS) on backup archives; optionally wrap off-site archives with `age`/`gpg` asymmetric encryption before upload.
- **Least-Privilege Backup Identity:** Provision a dedicated MongoDB backup role granting **`backup`** built-in Atlas role (or strictly `find` on `gastro_core` & `gastro_planning` collections + `read` on `local.oplog.rs`), separate from `readWrite` app users and **strictly disallowed** from `drop`/`write` in production. Separate restore credentials are kept offline/break-glass only.
- **Credential & Secret Management:** Store backup URIs and object-storage keys in CI/Secret Manager (GitHub Secrets / Vault), never committed to Git, `.env` examples, or stdout logs (mask `mongodb(+srv)://user:pass@` via regex before logging).
- **Ransomware & Accidental Deletion Protection:**
  - Enable **Bucket Versioning + WORM Object Lock (Compliance/Governance retention)** on backup storage so compromised app/CI credentials cannot delete or overwrite existing daily backups.
  - Require dual-approval / `--confirm-production-restore` safeguard before any `mongorestore --drop` targetting production hostnames.
