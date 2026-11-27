# M8.7 — MongoDB Migration Testing, Idempotency & Rollback Report

- **Repository:** `maanxx/KLTN-123-GastroWise-BE`
- **Branch:** `feature/m8-7-migration-testing` (branched from M8.6 `feature/m8-6-data-integrity-audit` `d598a84b27f64742a01310feccbe8f0409ea0ccf`)
- **Execution Date (UTC):** `2026-11-25T09:08:02Z` – `2026-11-25T09:13:40Z`
- **Target Environment:** Isolated Docker Compose container `gastrowise-mongo-test` (`mongo:7.0`, MongoDB `7.0.48`) on private bridge network `kltn-123-gastrowise-be_gastrowise_network` (`172.18.0.0/16`). **Zero production/Atlas connections used.**
- **Companion Docs:** [`M8_7_RUNTIME_VALIDATION.md`](./M8_7_RUNTIME_VALIDATION.md), [`M8_7_DATA_INTEGRITY_RESULTS.md`](./M8_7_DATA_INTEGRITY_RESULTS.md)

---

## 1. Migration Inventory & Framework State (M8.7.1)

| Artifact / Mechanism | Current State in Repo | Target Collections / DB | Idempotency Mechanism | Rollback Support |
|---|---|---|---|---|
| `scripts/migrate-geojson.ts` | Implemented TypeScript script | `restaurants` (legacy `MONGODB_URI`) | Predicate filters docs missing `location.coordinates` with non-zero `lat`/`lon` + comma-decimal handling | Snapshot/pre-image or unset `location` |
| `scripts/db-split-dryrun.ts` | Read-only validation script | `gastrowise` $\rightarrow$ Core/Planning boundary check | Read-only (`countDocuments`) | N/A (read-only) |
| `RestaurantsService.ensureGeoJsonLocations()` | Implicit runtime hook (`onApplicationBootstrap`) | `restaurants` (`gastro_core`) | Filters missing/empty `location.coordinates` | None (boot-time backfill) |
| **Migration Framework (`migrate-mongo` / `umzug`)** | **NOT IMPLEMENTED in repo** | `schema_migrations` | *Designed in M8.3 (`V001`–`V006`); not yet coded in `scripts/`* | Tested via synthetic `mongosh` scripts in M8.7 |

**Limitation Recorded:** No automated TypeScript migration runner exists in `KLTN-123-GastroWise-BE` yet. In accordance with M8.7 rules (do not invent a production framework), M8.7 runtime validation tested:
1. Exact baseline snapshot & restore (`mongodump` / `mongorestore`).
2. `scripts/migrate-geojson.ts` transformation logic via `mongosh` against synthetic fixtures.
3. M8.3 `V001`, `V002`, `V004`, and `V005` migration waves, idempotency guards, index builds, `E11000` failure handling, down-rollbacks, archive recovery, and catastrophic drop recovery inside isolated `gastro_core_test` and `gastro_planning_test`.

---

## 2. Synthetic Baseline & Pre-Test Safety Backup (M8.7.3 Step 1)

Before any test writes, baseline databases in `gastrowise-mongo-test` were backed up:
- **Baseline Counts Prior to Seeding:** `gastro_core_test.taste_dna_profiles` = `1`, all other Core collections = `0`; `gastro_planning_test.itineraries` = `2`.
- **Backup Command:**
  `mongodump --db=gastro_core_test --archive=/tmp/pre_m87_core.archive.gz --gzip`
  `mongodump --db=gastro_planning_test --archive=/tmp/pre_m87_planning.archive.gz --gzip`
- **SHA-256 Checksums Recorded:**
  - `/tmp/pre_m87_core.archive.gz`: `ad06c7db35486748e51ac86e560ae8f50f297144cd01edf670f5f7e37b1b73ec`
  - `/tmp/pre_m87_planning.archive.gz`: `6680ded2737a85eb75701fec5e9823eee44d1b459611fddb1fcc4af25e517ef1`

### Synthetic Test Dataset Seeded
- `users`: `50` docs (`48` standard + `2` deliberate case-variant duplicate emails `CaseVariant@example.com` / `casevariant@example.com`; `1` user carrying a dangling `savedRestaurants` ID).
- `restaurants`: `200` docs (`100` Foody-like `10`-point scores with `reviewsCount: 0`, `50` 5-point scores with `reviewsCount: 4`, `30` legacy rows missing `location` including comma-decimal `'10,7751'` strings, `20` broken Q1-default `[106.7009, 10.7769]` rows with `lat: 0, lon: 0`).
- `menu_items`: `200` docs (`198` valid + `2` orphan `restaurantId` refs).
- `reviews`: `250` docs (`244` valid + `2` duplicate `(userId, restaurantId)` pairs + `2` out-of-scale `diemReview` `9`/`10` + `2` orphan `restaurantId` refs).
- `contacts`: `100` docs; `user_interactions`: `250` docs; `taste_dna_profiles`: `40` docs; `itineraries`: `40` docs (`2` existing + `38` synthetic including `5` with `created_at` only).

---

## 3. Migration Execution & Idempotency Results (M8.7.3 & M8.7.4)

Executed against `gastro_core_test` and `gastro_planning_test` (`timestamp: 2026-11-25T09:10:40.177Z`):

| Wave / Operation | Run #1 Result (First Execution) | Run #2 Result (Idempotency Check) | Status |
|---|---|---|---|
| **V001** — Additive `{ background: true }` indexes across 8 collections | `11` new indexes created in `47 ms`; recorded in `schema_migrations` (`V001_background_indexes`) | Completed in `3 ms`, `menuItemIndexes: 2`, `ok: true` (no errors/duplicates) | **PASS** |
| **GeoJSON Migration** (`scripts/migrate-geojson.ts` predicate + `2dsphere`) | `matched: 30`, `updatedCount: 30` (comma-decimals `'10,7751'` parsed cleanly; `20` Q1 `0/0` untouched as expected) | `matched: 0`, `updatedCount: 0` | **PASS** |
| **V002** — `User` security field backfill (`hashedRefreshToken: null`, `resetOtpExpiresAt: null`) | `matched: 50`, `modified: 50`; recorded in `schema_migrations` (`V002_user_security_fields`) | `matched: 0`, `modified: 0` | **PASS** |
| **V004 (Pre-Dedup Failure Test)** — Partial unique index `{ userId: 1, restaurantId: 1 }` *before* dedup | **Expected failure caught:** `E11000 duplicate key error collection: gastro_core_test.reviews index: userId_1_restaurantId_1` | N/A | **PASS (Verified Fail-Safe)** |
| **V004 (Archive + Dedup + Retry)** — Archive dup pairs into `_archive_reviews_duplicates`, delete dups, build `uniq_user_restaurant_review` | `dupGroupsFound: 2`, `archivedAndRemoved: 2`, index `uniq_user_restaurant_review` built cleanly (`reviews`: `250` $\rightarrow$ `248`) | `dupGroupsFound: 0`, `archivedAndRemoved: 0`, index returned `uniq_user_restaurant_review` | **PASS** |
| **V005** — Rating scale expansion (`ratingScale` + `rawRating` guarded by `{ ratingScale: { $exists: false } }`) | `fivePointModified: 70`, `tenPointModified: 130` (`200/200` expanded without altering `diemTrungBinh`) | `fivePointModified: 0`, `tenPointModified: 0` (proves zero double-transformation) | **PASS** |

---

## 4. Rollback & Backup/Restore Recovery Results (M8.7.5)

Tested three distinct recovery mechanisms against `gastro_core_test` (`2026-11-25T09:11:56Z`):

| Recovery Mechanism | Procedure Executed | Measured Result | Classification |
|---|---|---|---|
| **Pre-Rollback Compressed Archive Integrity** | `mongodump --db=gastro_core_test --archive=/tmp/post_m87_core.archive.gz --gzip` + `gzip -t` + `mongorestore --dryRun` | SHA-256 `18b79fc110253f886b04b9a6dc780162e2b9f263015f666862401929ab21f716`; `gzip -t` exit `0`; `--dryRun`: `0 document(s) failed to restore` | **PASS** |
| **Code-Level Down Rollback (`V005`, `V002`, `V001`)** | `$unset` `ratingScale`/`rawRating`/`schemaVersion` on `restaurants`; `$unset` `hashedRefreshToken`/`resetOtpExpiresAt`/`schemaVersion` on `users`; `dropIndex` on `contacts.createdAt_-1` & `menu_items.restaurantId_1_isFeatured_-1_createdAt_-1` | `v005UnsetModified: 200`, `v002UnsetModified: 50`, `remainingRatingScaleDocs: 0`; `contacts` & `menu_items` reverted to `["_id_"]` | **Fully Reversible (PASS)** |
| **Archive-Based Recovery (`V004` Dedup Undo)** | Dropped `uniq_user_restaurant_review`, restored `2` archived documents from `_archive_reviews_duplicates` back into `reviews` | `archivedCountRead: 2`, `reviewsCountRestored: 251` (`249` active + `2` restored, incl. 1 probe doc added during HTTP testing) | **Reversible via Archive (PASS)** |
| **Catastrophic Failure Recovery (`mongorestore --drop`)** | Simulated destructive failure via `db.reviews.drop()` (`reviewsCountAfterDrop: 0`), then executed `mongorestore --archive=/tmp/post_m87_core.archive.gz --gzip --drop` | `1097 document(s) restored successfully. 0 document(s) failed to restore.`; exact parity verified (`users: 51`, `restaurants: 200`, `menu_items: 200`, `reviews: 249`, `contacts: 100`, `user_interactions: 251`, `taste_dna_profiles: 40`, `_archive_reviews_duplicates: 2`), UTF-8 (`Quán Synthetic Số 0`, `10 Nguyễn Huệ, TP.HCM`), and all `7` `reviews` indexes including `uniq_user_restaurant_review` restored | **Backup-Based Recovery (PASS)** |

Finally, `/tmp/pre_m87_core.archive.gz` and `/tmp/pre_m87_planning.archive.gz` were restored with `--drop` and temporary collections (`schema_migrations`, `_archive_reviews_duplicates`) removed so `gastrowise-mongo-test` returned cleanly to its exact initial pre-M8.7 baseline (`0` failures).
