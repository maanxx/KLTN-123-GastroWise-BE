# M8.3 — GastroWise MongoDB Migration Strategy, Rollback & Risk Assessment

- **Repository:** `maanxx/KLTN-123-GastroWise-BE`
- **Branch:** `feature/m8-3-migration-strategy` (branched from M8.2 `feature/m8-2-schema-index-audit` `905ac66d88d936a48cc973cde4a0c569f216707d`)
- **Predecessor Audits:** [`M8_DATABASE_ARCHITECTURE_AUDIT.md`](./M8_DATABASE_ARCHITECTURE_AUDIT.md) (M8.1) & [`M8_2_SCHEMA_INDEX_AUDIT.md`](./M8_2_SCHEMA_INDEX_AUDIT.md) (M8.2)
- **Scope:** Planning & strategy documentation only. Zero code edits, zero schema edits, and zero live MongoDB mutations executed.

---

## 1. Migration Inventory (M8.3.1)

### 1.1 Collections, Ownership & Dependencies

| Collection | Owning Service / DB | Schema Dependencies & Cross-References | Existing Index Count | Required Target Indexes (from M8.2) |
|---|---|---|---|---|
| `restaurants` | Core Service (`gastro_core`) / Read by AI (`PyMongo`) | Optional `ownerId -> users._id`; referenced by `reviews.restaurantId`, `menu_items.restaurantId`, `users.savedRestaurants[]`, `itineraries.stops[].restaurant_id` (opaque string) | 6 (`_id` + 5 custom) | Keep `{location:'2dsphere'}`, `{status:1, diemTrungBinh:-1}`, `{slug:1}`; add `{diemTrungBinh:-1, reviewsCount:-1}`, `{urlGoc:1}`; review unused `{cityId:1}` |
| `menu_items` | Core Service (`gastro_core`) | Required `restaurantId -> restaurants._id` | 1 (`_id` only) | Add `{restaurantId:1, isFeatured:-1, createdAt:-1}` |
| `reviews` | Core Service (`gastro_core`) | Required `restaurantId -> restaurants._id`; optional `userId -> users._id`; legacy `urlGoc` string join | 4 (`_id` + 3 custom) | Add `{restaurantId:1, isFeatured:-1, createdAt:-1}`, `{urlGoc:1, isFeatured:-1, createdAt:-1}`, partial unique `{userId:1, restaurantId:1}` (after dedup) |
| `users` | Core Service (`gastro_core`) | Referenced by `reviews.userId`, `restaurants.ownerId`, `user_interactions.userId`, `taste_dna_profiles.userId`; embeds `savedRestaurants[] -> restaurants._id` | 3 (`_id` + 2 unique) | Keep unique `username` & `email`; add `{status:1, createdAt:-1}`, `{savedRestaurants:1}` (multikey) |
| `contacts` | Core Service (`gastro_core`) | Standalone | 1 (`_id` only) | Add `{createdAt:-1}` |
| `user_interactions` | Core Service (`gastro_core`) | Optional `userId -> users._id`; opaque `targetId` synced to AI `/cf/train` | 8 (`_id` + 7 custom) | Add `{targetType:1, targetId:1}`; drop redundant single `{userId:1}` & `{targetId:1}`; evaluate TTL on transient `view`/`search` |
| `taste_dna_profiles` | Core Service (`gastro_core`) | Unique `userId -> users._id` | 2 (`_id` + 1 unique) | Keep unique `{userId:1}` (remove duplicate `index:true` option) |
| `itineraries` | Planning Service (`gastro_planning`) | ADR-09 scalar `user_id` & `stops[].restaurant_id` (zero cross-DB `ObjectId` joins) | 4 (`_id` + 3 custom) | Keep `{user_id:1, createdAt:-1}`; add sparse unique `{shareToken:1}`, `{createdAt:-1}`; drop redundant single `{user_id:1}` & duplicate `created_at` index after backfill |

### 1.2 Existing Migration Mechanisms & Breaking-Change Surface

- **Current Tooling State (Verified):** No migration framework (`migrate-mongo` / `umzug`), no `schema_migrations` tracking collection, and no rollback tooling exist in the repository. Only two unversioned mechanisms exist:
  1. `scripts/migrate-geojson.ts` (ad-hoc manual GeoJSON `location` backfill + `location_2dsphere` index on legacy `MONGODB_URI` / `gastrowise`).
  2. `RestaurantsService.onApplicationBootstrap()` → `ensureGeoJsonLocations()` (`apps/core-service/src/restaurants/restaurants.service.ts:51-118`), which executes an unindexed `$or` scan on every service boot.
- **Potential Breaking Changes Identified:**
  - Enforcing unique `{ userId: 1, restaurantId: 1 }` on `reviews` fails if duplicate user reviews already exist in production.
  - Enforcing `resetOtpExpiresAt > new Date()` invalidates any pre-migration unexpiring OTP tokens.
  - Changing `Restaurant.location.coordinates` default from `[106.7009, 10.7769]` affects queries expecting omitted-location docs to match District 1 `$geoNear`.
  - Removing `itineraries.created_at` breaks queries sorting on `created_at` (`itineraries.service.ts:434, 439`) unless dual-written or migrated synchronously with code deployment.
  - Renaming/normalizing `restaurants.diemTrungBinh` breaks legacy filters (`restaurants.service.ts:822-855`) unless backend DTOs & filters switch simultaneously with backward-compatible read fallbacks.

---

## 2. Migration Strategy (M8.3.2)

All schema changes **must** follow a **Zero-Downtime Expand–Contract** model orchestrated through a dedicated, versioned migration runner writing execution records to a `schema_migrations` collection in each service database (`gastro_core.schema_migrations` and `gastro_planning.schema_migrations`).

### 2.1 Execution Order & Phase Separation

1. **Migration Runner Foundation (Pre-requisite, No Data Mutation):**
   - Introduce a deterministic TypeScript migration runner supporting `--dry-run`, `--target=Vxxx`, `up()`, `down()`, distributed lock/idempotency check via `schema_migrations { _id: version, checksum, appliedAt, durationMs, status }`, and batch cursor processing (`BATCH_SIZE = 500`, ordered: false `bulkWrite`).
2. **Wave 1 (`V001`–`V002`) — Non-Breaking Indexes & Security Field Expansion:**
   - **V001 (Background Performance Indexes — Safe / Additive):** Create missing indexes with `{ background: true }` on `menu_items`, `reviews` (adding `isFeatured: -1`), `restaurants` (`{ diemTrungBinh: -1, reviewsCount: -1 }`, `{ urlGoc: 1 }`), `contacts` (`{ createdAt: -1 }`), `users` (`{ status: 1, createdAt: -1 }`, `{ savedRestaurants: 1 }`), `user_interactions` (`{ targetType: 1, targetId: 1 }`), and `itineraries` (`{ createdAt: -1 }`, `{ shareToken: 1 }` sparse unique).
   - **V002 (`User` Security Field Backfill):** Deploy updated `UserSchema` (`@Prop() hashedRefreshToken`, `@Prop() resetOtpExpiresAt`) + `AuthService` bcrypt hashing of refresh tokens and OTP expiry check. Backfill `hashedRefreshToken: null, resetOtpExpiresAt: null, schemaVersion: 1` where missing.
3. **Wave 2 (`V003`–`V004`) — GeoJSON Decoupling & Data Hygiene:**
   - **V003 (GeoJSON Cleanup & Boot-Scan Removal):** Backfill valid `[lon, lat]` into `restaurants.location` in batches; clear invalid/Q1-defaulted `[106.7009, 10.7769]` points on records whose `lat`/`lon` are `0`/missing (`$set: { location: null }` when un-geocoded); remove `RestaurantsService.ensureGeoJsonLocations()` runtime boot scan; update schema default to `undefined`.
   - **V004 (Dangling References & Duplicate Review Audit):** Identify/log orphan `users.savedRestaurants[]` and `reviews` pointing to deleted `restaurants._id`; deduplicate `(userId, restaurantId)` in `reviews` (retaining newest/highest-engagement record) before applying partial unique index (`partialFilterExpression: { userId: { $type: 'objectId' } }`).
4. **Wave 3 (`V005`–`V006`) — Rating Scale Expansion & Contract Cleanup:**
   - **V005 (Rating Scale Expand):** Add additive fields `ratingScale` (`'10_point' | '5_point'`), `rawRating`, and `schemaVersion: 1` onto `restaurants` using M7.1 scale detection (`reviewsCount > 0` → `'5_point'`; Foody subscores with `reviewsCount == 0` → `'10_point'`). Keep existing `diemTrungBinh` readable during transition; update `ReviewsService` & `RestaurantsService` to populate/normalize using `ratingScale`.
   - **V006 (Contract — Timestamp & Redundant Index Cleanup):** After deploying code reading `createdAt` on `itineraries` (and verifying 0 reads on legacy `created_at`), copy any doc missing `createdAt` from `created_at`, then drop redundant indexes (`itineraries.user_id_1`, `itineraries.user_id_1_created_at_-1`, `user_interactions.userId_1`, `user_interactions.targetId_1`, `restaurants.cityId_1` if still unused) and retire unregistered `users/schemas/user-interaction.schema.ts` + root `src/` legacy schemas.

### 2.2 Backward Compatibility, Idempotency & Data Rules

- **Idempotency:** Every migration checks `schema_migrations` before running and uses idempotent filter predicates (`{ schemaVersion: { $lt: target } }` or `{ field: { $exists: false } }`) so interrupted re-runs never double-transform values (e.g., never dividing a `ratingScale: '5_point'` score by `2` twice).
- **Duplicate & Missing Data Handling:** Numeric parsers clean comma-decimals (`replace(',', '.')`), coerce `NaN`/`Infinity` to `null` instead of writing corrupted coordinates, and validate bounds (`Review.diemReview` in `[1, 5]`, `MenuItem.price >= 0`).
- **Index Lifecycle Rule:** Never run `Model.syncIndexes()` automatically on startup; create new indexes first with `{ background: true }`, verify `IXSCAN` via `explain()`, deploy application queries, and only drop redundant indexes in a subsequent Contract step.

---

## 3. Rollback & Recovery Strategy (M8.3.3)

### 3.1 Preconditions Before Any Execution

1. Isolated staging dry-run passed with zero errors and verified `explain("executionStats")`.
2. Production/staging pre-migration snapshot taken (`mongodump --archive=<ts>.gz --gzip` + MongoDB Atlas Cloud Snapshot) and restore-tested on ephemeral `mongo:7.0`.
3. Maintenance banner or zero-downtime compatible application release deployed first (for Expand phases).

### 3.2 Reversibility Classification

| Operation | Class | Rollback Procedure |
|---|---|---|
| Adding `{ background: true }` indexes (`V001`) | **Fully Reversible** | `collection.dropIndex(indexName)` — zero data mutation |
| Adding optional fields (`hashedRefreshToken: null`, `resetOtpExpiresAt: null`, `ratingScale`, `rawRating`) (`V002`, `V005`) | **Fully Reversible** | Deploy previous app image + optional `$unset` of newly added fields; mark `schema_migrations` entry `rolled_back` |
| Backfilling `restaurants.location` from `lat`/`lon` (`V003`) | **Reversible with Snapshot / Logs** | Pre-image logged in `_migration_audit_v003` or restored from snapshot |
| Deduplicating duplicate `(userId, restaurantId)` reviews / pruning orphan `savedRestaurants` (`V004`) | **Irreversible In-Place** | **Must** archive deleted/merged records into `_archive_reviews_duplicates` / `_archive_orphan_refs` before deletion, or restore collection from pre-migration `mongorestore` |
| Dropping legacy `src/` files or unused fields (`created_at`) (`V006`) | **Hard to Reverse** | Git revert + restore `created_at` from `createdAt` (`$set: { created_at: '$createdAt' }`) |

### 3.3 Partial Failure Recovery & Abort Criteria

- **Partial Failure Recovery:** Because migrations execute in bounded batches (`500` docs) via idempotent filters and archive modified originals before destructive operations, recovery resumes cleanly from remaining unmatched docs OR restores the single affected collection via `mongorestore --nsInclude=... --drop`.
- **Mandatory Abort Triggers (Stop & Rollback Immediately):**
  1. Document count mismatch (`post_count !== pre_count` on non-deduplication waves).
  2. Validation failure rate `> 0.5%` in dry-run (e.g., unexpected non-numeric coordinates or rating anomalies).
  3. Index build fails or triggers lock contention / latency spike `> 3x` p95 baseline.
  4. Application error rate spike (`401`/`500`) on smoke tests immediately post-wave.

---

## 4. Risk Assessment Matrix (M8.3.5)

| Severity | Collection / Model | Technical Reason | Potential Impact | Mitigation Strategy | Verification Criteria |
|---|---|---|---|---|---|
| **CRITICAL** | `users` (`User`) | Adding `@Prop()` to `hashedRefreshToken` + hashing vs plaintext (`auth.service.ts:43,108`) & adding `resetOtpExpiresAt` | Existing plaintext refresh tokens fail `bcrypt.compare`; unexpiring OTPs invalidated | Backfill `hashedRefreshToken: null, resetOtpExpiresAt: null` simultaneously with hashing deploy; expect clean 1-time re-login | Auth integration tests pass `login` → `refresh` → `logout` against test DB |
| **CRITICAL** | `restaurants` (`Restaurant`) | Dual scale (`0–10` vs `0–5`) in `diemTrungBinh` without scale marker | Double-normalization or broken range filters (`restaurants.service.ts:822-855`) | Store raw `rawRating` + `ratingScale` additively first; guard idempotency with `ratingScale` | `0` docs with `ratingScale: null`; AI `M7.1` & Core `findAll` parity check passes |
| **HIGH** | `reviews` (`Review`) | Applying unique `{ userId: 1, restaurantId: 1 }` when historical duplicates exist | Index creation throws `E11000 duplicate key error`, blocking migration | Run pre-check aggregation grouping `(userId, restaurantId)` > 1; archive & dedup first (`V004`) | Duplicate-group count `== 0`; `createIndex` succeeds with `partialFilterExpression` |
| **HIGH** | `restaurants` (`Restaurant`) | Removing Q1 coordinate default `[106.7009, 10.7769]` & boot `ensureGeoJsonLocations` | Null `location` docs omitted from `$geoNear` if not geocoded | Pre-audit count of null vs `[106.7009, 10.7769]` non-Q1 docs; ensure `$geoNear` fallback path handles nulls | Spatial `$geoNear` query returns valid Q1 results without throwing |
| **HIGH** | All Collections | Ad-hoc writes against Atlas without automated snapshot/runner lock | Partial corruption, unrecoverable overwrite if script aborts mid-run | Mandatory `mongodump` snapshot + dry-run + `schema_migrations` lock before `V002`+ | Backup archive restores cleanly into `mongo:7.0` container |
| **MEDIUM** | `itineraries` (`Itinerary`) | Consolidating `created_at` → `createdAt` and dropping `user_id_1` / `created_at` index | Existing `.sort({ created_at: -1 })` (`itineraries.service.ts:434`) loses index coverage if dropped early | Contract index drop only **after** NestJS query switches to `createdAt` (`timestamps: true`) | `explain('executionStats')` shows `IXSCAN` on `{ user_id: 1, createdAt: -1 }` |
| **MEDIUM** | `user_interactions` | Collection collision with unused `user-interaction.schema.ts` & unbounded growth | Future developer import breaks validation; disk bloat | Delete colliding file; build `{ targetType: 1, targetId: 1 }`; isolate TTL to `view`/`search` after retention sign-off | `getMatrixExport` & `getPopularTargets` pass contract & `IXSCAN` checks |
| **LOW** | `contacts` / Orphaned files | Missing `{ createdAt: -1 }` on `contacts`; unused schema files in `apps/` & `src/` | Slow admin sort on large contact volume; developer confusion | Background index on `contacts.createdAt` + pagination; archive unused files cleanly | Jest + `nest build` clean after removal |
