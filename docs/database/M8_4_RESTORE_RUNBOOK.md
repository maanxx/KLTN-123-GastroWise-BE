# M8.4 — GastroWise MongoDB Restore Runbook

- **Repository:** `maanxx/KLTN-123-GastroWise-BE`
- **Prerequisite Strategy:** [`M8_4_BACKUP_STRATEGY.md`](./M8_4_BACKUP_STRATEGY.md)
- **Post-Restore Verification:** [`M8_4_RECOVERY_VALIDATION.md`](./M8_4_RECOVERY_VALIDATION.md)

> [!CAUTION]
> Never run `mongorestore --drop` directly against a production URI without: (1) Tech Lead approval, (2) verifying the backup checksum against a disposable `mongo:7.0` container first, and (3) exporting a safety snapshot of current production state prior to overwriting.

---

## General Prerequisites (All Scenarios)

1. Identify incident scope: affected database (`gastro_core` vs `gastro_planning`), affected collections, and incident timestamp (`T_incident`).
2. Pause write traffic to impacted service(s) (put Nginx gateway / NestJS pods in maintenance or scale down replicas temporarily) to prevent split-brain writes during restore.
3. Verify backup integrity (`sha256sum -c` + `gzip -t`) before staging restore.
4. Confirm MongoDB Tools (`mongodump` / `mongorestore` `>= 100.x`) match target MongoDB server compatibility (`7.0` / Atlas).

---

## Scenario 1 — Full Database Restoration

**Use Case:** Total logical corruption or catastrophic loss of `gastro_core` or `gastro_planning`.

1. **Pre-Restore Snapshot:** Capture current damaged DB (for forensics) if still readable: `mongodump --uri="$TARGET_URI" --archive=forensic_pre_restore.archive.gz --gzip`.
2. **Dry-Run Staging Check:** Restore candidate archive into an ephemeral `mongo:7.0` container first and execute [`M8_4_RECOVERY_VALIDATION.md`](./M8_4_RECOVERY_VALIDATION.md).
3. **Execute Restore:**
   ```bash
   mongorestore \
     --uri="$TARGET_URI" \
     --nsInclude="${TARGET_DB}.*" \
     --archive="${BACKUP_ARCHIVE}.archive.gz" \
     --gzip \
     --drop \
     --maintainInsertionOrder
   ```
4. **Re-sync Dependent Caches:** Restart **AI Service** (`POST` startup reload or container restart) so its in-memory `restaurants` DataFrame & `TfidfVectorizer` reload clean catalog data from `gastro_core`.
5. **Rollback Consideration:** If restored DB fails smoke checks, swap back using `forensic_pre_restore.archive.gz` or an earlier verified archive.

---

## Scenario 2 — Individual Collection Restoration

**Use Case:** Accidental drop/truncation or localized corruption of one collection (e.g., `restaurants`, `menu_items`, `reviews`, `itineraries`) without reverting unrelated collections (such as recent user signups in `users`).

1. **Check Cross-Collection Dependencies First:**
   - Restoring `restaurants`: ensure `menu_items`, `reviews`, and `users.savedRestaurants` ObjectIds remain consistent.
   - Restoring `reviews`: recompute `restaurants.diemTrungBinh` & `reviewsCount` after restore if reviews changed after backup.
   - Restoring `itineraries`: self-contained via ADR-09 scalar snapshots (`user_id`, `stops[].restaurant_id`).
2. **Restore Single Namespace:**
   ```bash
   mongorestore \
     --uri="$TARGET_URI" \
     --nsInclude="${TARGET_DB}.${COLLECTION_NAME}" \
     --archive="${BACKUP_ARCHIVE}.archive.gz" \
     --gzip \
     --drop
   ```
3. **Verify Indexes:** Confirm `mongorestore` rebuilt collection indexes (including `location_2dsphere` and compound sorts on `restaurants`/`reviews`).
4. **Post-Restore Hook:** Refresh AI catalog if `restaurants` was restored; retrain AI CF (`/cf/train`) if `user_interactions` was restored.

---

## Scenario 3 — Accidental Document Deletion Recovery

**Use Case:** Admin/bug accidentally deletes specific document(s) (e.g., a restaurant owner account, popular venue, or curated itinerary) while production remains live with newer valid writes.

1. **Do NOT use `--drop` on the live collection.**
2. **Restore Backup into Isolated Staging DB (`restore_staging`):**
   ```bash
   mongorestore \
     --uri="$STAGING_URI" \
     --nsFrom="${TARGET_DB}.${COLLECTION_NAME}" \
     --nsTo="restore_staging.${COLLECTION_NAME}" \
     --archive="${BACKUP_ARCHIVE}.archive.gz" \
     --gzip
   ```
3. **Extract & Inspect Target Document(s):** Export only the deleted `_id` filter (`mongoexport --query='{"_id":{"$oid":"..."}}'`) or inspect dependent child docs (`reviews`, `menu_items` matching `restaurantId`).
4. **Selective Re-Insert (Upsert Guard):** Insert missing documents into target DB only if `_id` still does not exist (`ordered: false`), preserving any surrounding live data.
5. **Rollback Consideration:** Re-inserted `_id`s are cleanly tracked and can be removed by `_id` if the wrong record was recovered.

---

## Scenario 4 — Failed Migration Recovery (Aligned with M8.3)

**Use Case:** Partial failure, schema validation rejection, `E11000` duplicate-key halt, or `> 3x` latency regression during an M8.3+ migration wave (`V001`–`V006`).

1. **Halt Migration Runner & Check `schema_migrations` Status.**
2. **Branch by Operation Type (per M8.3 Section 3.2):**
   - **Failed `V001` (Indexes Only):** Drop newly created index (`collection.dropIndex(...)`) — zero data restore needed.
   - **Failed `V002` / `V005` (Additive Expand Fields):** Deploy previous backward-compatible NestJS image; optionally `$unset` partial new fields or resume idempotent batch once fixed.
   - **Failed `V003` / `V004` / `V006` (Partial Backfill / Dedup):** Restore affected namespace(s) from the mandatory **pre-migration pinned snapshot** (`--nsInclude="${TARGET_DB}.${COL}" --drop`) or rehydrate from `_archive_*` collections created in `V004`.
3. **Verify:** Run `schema_migrations` state audit, document counts, and contract smoke tests before reopening traffic.

---

## Scenario 5 — Corrupted Database Recovery

**Use Case:** Mixed/inconsistent document types, broken GeoJSON `[lon, lat]` tuples across batches, or widespread invalid field mutations across multiple collections.

1. **Stop All Application Writers Immediately** (Core Service, Planning Service, any background cron/migration jobs).
2. **Identify Last Known Clean Checkpoint:** Compare recent dumps (`--dryRun` + sampling `updatedAt` timestamps) to isolate the exact clean backup timestamp `T_clean` prior to corruption.
3. **Full Namespace Restore into Clean Target Database (`_recovery_verify` first, then production/staging swap or `--drop` restore)** following **Scenario 1**.
4. **Restart Core $\rightarrow$ Planning $\rightarrow$ AI Service in Dependency Order** and execute full [`M8_4_RECOVERY_VALIDATION.md`](./M8_4_RECOVERY_VALIDATION.md).

---

## Scenario 6 — Point-in-Time Recovery (PITR)

**Applicability:** Available **only** when production runs on **MongoDB Atlas M10+ Dedicated Cluster with Continuous Cloud Backup** (or self-hosted replica set with continuous oplog backups `--oplog` / `--oplogReplay`). **Not available on Atlas M0/M2/M5 shared tiers.**

1. **Determine Exact Second Before Incident (`T_target = T_incident - 5 seconds`):** Inspect audit logs (`itineraries.*At`, `contacts.*At`, Core app logs) to pinpoint the exact timestamp before accidental `deleteMany` / bad migration.
2. **Atlas Cloud Backup Flow:**
   - Open Atlas UI / Atlas CLI → Cluster → Backup → **Continuous Backup / Restore** → **Point in Time Restore** (`T_target`).
   - Target a **separate staging restore cluster/database first** (never overwrite live prod blind).
   - Validate schema, counts, and missing rows on the PITR snapshot using Scenario 3 (for targeted doc recovery) or Scenario 1 (for full cluster cutover).
3. **Self-Hosted Oplog Replay Flow (if using `mongodump --oplog`):**
   ```bash
   mongorestore --uri="$STAGING_URI" --archive="${BASE_DUMP}.archive.gz" --gzip --oplogReplay --oplogLimit="${EPOCH_SECONDS}:1"
   ```
4. **Rollback Consideration:** Keep original pre-recovery cluster snapshot/volume intact for at least `72 hours` post-cutover.
