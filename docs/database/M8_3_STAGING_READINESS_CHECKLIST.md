# M8.3 — Staging Database Migration Readiness Checklist

- **Repository:** `maanxx/KLTN-123-GastroWise-BE`
- **Target Execution Environment (Future M8.4+):** Isolated local Docker (`mongo:7.0`) and isolated MongoDB Staging Cluster/Database (**NEVER production `gastro_core` / `gastro_planning` directly**).
- **Status in M8.3:** **PRE-EXECUTION CHECKLIST READY (NOT YET EXECUTED)**

---

## 1. Environment & Database Isolation

- [ ] Provision isolated staging databases (`gastro_core_staging`, `gastro_planning_staging`, or Docker `mongo-test` DBs) completely separated from production Atlas URIs and credentials.
- [ ] Verify `.env.staging` uses least-privilege MongoDB users:
  - Core Service (`MONGODB_URI_CORE`, `CORE_DB_NAME=gastro_core_staging`) — `readWrite` on Core DB only.
  - Planning Service (`MONGODB_URI_PLANNING`, `PLANNING_DB_NAME=gastro_planning_staging`) — `readWrite` on Planning DB only.
  - AI Service (`MONGODB_URI`, `MONGODB_DB_NAME=gastro_core_staging`, `MONGODB_COLLECTION_NAME=restaurants`) — **strictly `read` role** on `restaurants` collection (aligning DB name with Core so AI does not boot with an empty dataset).
- [ ] Confirm production Atlas URI is absent from CI/staging migration runner shells (`Cluster` hostname assertion check passes).

---

## 2. Connection & Pre-Migration Baseline Verification

- [ ] Confirm MongoDB ping & server version (`>= 7.0` or Atlas parity) for both `MONGODB_URI_CORE` and `MONGODB_URI_PLANNING`.
- [ ] Snapshot baseline collection document counts and storage/index stats (`db.collection.stats()`, `db.collection.getIndexes()`).
- [ ] Run read-only pre-flight audit queries on staging snapshot:
  - Count `restaurants` missing GeoJSON `location` or holding suspicious Q1 default `[106.7009, 10.7769]` outside District 1.
  - Count `reviews` duplicate pairs grouped by `{ userId, restaurantId }` where `userId != null`.
  - Count `restaurants` `diemTrungBinh` distribution (`<= 5.0` with Foody subscores vs `reviewsCount > 0`).
  - Inspect actual `user_interactions` document shapes against `Interaction` vs `UserInteraction`.

---

## 3. Backup & Restore Verification (Mandatory Gate)

- [ ] Execute compressed pre-migration archive backup of staging DB (`mongodump --uri="..." --archive=pre_m8_backup.gz --gzip`) without printing credentials to stdout/logs.
- [ ] Verify backup integrity by restoring into a fresh ephemeral `mongo:7.0` container (`mongorestore --archive=pre_m8_backup.gz --gzip --drop`) and asserting identical document counts per collection.
- [ ] Confirm pre-migration MongoDB Atlas snapshot ID is recorded before any production window.

---

## 4. Migration Dry-Run & Execution Gates

- [ ] Execute migration runner in `--dry-run` mode (`schema_migrations` untouched) across all `V001`–`V006` scripts and inspect projected change counts.
- [ ] Execute `V001` (additive `{ background: true }` indexes) and verify zero collection-lock stalls or duplicate-key errors.
- [ ] Verify `schema_migrations` records each applied wave (`version`, `checksum`, `appliedAt`, `durationMs`, `status: 'applied'`).
- [ ] Re-run each migration a second time to prove **idempotency** (`0` modified documents on second execution).

---

## 5. Runtime Index & `explain("executionStats")` Verification

Run `explain("executionStats")` on representative staging queries and confirm **index usage (`IXSCAN` / `GEO_NEAR` / `FETCH`)** with zero unintended `COLLSCAN` or unindexed memory `SORT` stages:

- [ ] `menu_items`: `find({ restaurantId }).sort({ isFeatured: -1, createdAt: -1 })` → uses `{ restaurantId: 1, isFeatured: -1, createdAt: -1 }` (`IXSCAN`, `nReturned` proportional to `totalKeysExamined`).
- [ ] `reviews`: `find({ restaurantId, status: 'active' }).sort({ isFeatured: -1, createdAt: -1 })` → uses `{ restaurantId: 1, status: 1, isFeatured: -1, createdAt: -1 }` or `{ restaurantId: 1, isFeatured: -1, createdAt: -1 }`.
- [ ] `reviews`: `find({ urlGoc }).sort({ isFeatured: -1, createdAt: -1 })` → uses `{ urlGoc: 1, isFeatured: -1, createdAt: -1 }`.
- [ ] `restaurants`: `aggregate([{ $geoNear: ... }])` → uses `location_2dsphere` (`GEO_NEAR_2DSPHERE`).
- [ ] `restaurants`: `find({}).sort({ diemTrungBinh: -1, reviewsCount: -1 }).limit(10)` → uses `{ diemTrungBinh: -1, reviewsCount: -1 }` (`IXSCAN`).
- [ ] `contacts`: `find({}).sort({ createdAt: -1 }).limit(20)` → uses `{ createdAt: -1 }`.
- [ ] `itineraries`: `find({ user_id }).sort({ createdAt: -1 })` → uses `{ user_id: 1, createdAt: -1 }`.
- [ ] Record pre- vs post-migration query latency baseline (`executionTimeMillis`, `totalDocsExamined`).

---

## 6. Post-Migration Integrity & Rollback Readiness

- [ ] Assert post-migration document counts match expected invariants (`users`, `restaurants`, `menu_items`, `itineraries`, `taste_dna_profiles` unchanged; `reviews` reduction matches archived duplicate count).
- [ ] Verify `AuthService` end-to-end (`register` → `login` → `refresh` → `logout` → `forgotPassword` → `resetPassword` expired vs valid OTP) confirms `User.hashedRefreshToken` & `resetOtpExpiresAt` persist and enforce TTL.
- [ ] Execute rollback script (`--down`) in staging for `V002` / `V005` / `V001` and confirm clean restoration of pre-migration state without breaking running services.
- [ ] Run full automated backend test suite (`npm run test:microservices`) and AI M7.3 contract suite against migrated staging DB before any Tech Lead sign-off for production.
