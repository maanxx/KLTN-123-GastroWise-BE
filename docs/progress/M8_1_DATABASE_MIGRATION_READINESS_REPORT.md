# M8.1 — Database Migration Readiness Report

- **Repository:** `maanxx/KLTN-123-GastroWise-BE`
- **Branch:** `feature/m8-1-database-architecture-audit` (from `origin/fix/m2.3-backend-integration-security` `9ecda75`)
- **Technical Inventory Companion:** [`docs/database/M8_DATABASE_ARCHITECTURE_AUDIT.md`](../database/M8_DATABASE_ARCHITECTURE_AUDIT.md)
- **Final Verdict:** **`PASS — DATABASE AUDIT COMPLETE`** *(comprehensive static audit completed across Core, Planning, and AI services without modifying production schemas or data; live MongoDB Atlas cluster execution was intentionally avoided in this read-only audit)*

---

## 1. Current Architecture Summary

GastroWise operates three backend data accessors against MongoDB:
- **Core Service (`apps/core-service`):** Owns 7 active Mongoose collections (`restaurants`, `menu_items`, `reviews`, `users`, `contacts`, `user_interactions`, `taste_dna_profiles`) in `CORE_DB_NAME` (`gastro_core`). Four orphaned schemas + one colliding `user-interaction.schema.ts` + duplicate monolith `src/` trees remain in the repo.
- **Planning Service (`apps/planning-service`):** Owns `itineraries` (with embedded `stops[]` snapshot value objects per ADR-09) in `PLANNING_DB_NAME` (`gastro_planning`).
- **AI Service (`KLTN-123-GastroWise-AI`):** Read-only PyMongo consumer loading `restaurants` into an in-memory DataFrame (`MONGODB_DB_NAME`, default `gastrowise`).

---

## 2. Migration Readiness Assessment

| Capability | Current Status | Observed Implementation Details | Gap / Readiness Level |
|---|---|---|---|
| **Schema Version Tracking** | **NOT PRESENT** | No collection includes a `schemaVersion` or `_v` field. | Not Ready |
| **Migration History Log** | **NOT PRESENT** | No `schema_migrations` / `changelog` tracking collection exists. | Not Ready |
| **Migration Runner / CLI** | **AD-HOC ONLY** | Single unversioned script `scripts/migrate-geojson.ts` (uses legacy `MONGODB_URI`, no CLI flags/locking, not wired in `package.json`). Core also runs `onApplicationBootstrap()` -> `ensureGeoJsonLocations()`. | Partial / Unsafe for multi-replica prod |
| **Rollback Procedures** | **NOT PRESENT** | Zero `down()` scripts or automated reversal steps exist. | Not Ready |
| **Post-Migration Validation** | **CONSOLE ONLY** | `migrate-geojson.ts` logs counts & indexes manually; no automated assertion checks or exit-code gates. | Not Ready |
| **Test DB Isolation** | **PRESENT (Docker)** | `docker-compose.yml` provisions ephemeral `mongo:7.0` (`mongo-test`) with `gastro_core_test`, `gastro_planning_test`, `gastro_ai_test`. | Ready (needs AI↔Core catalog alignment) |

---

## 3. Backup & Recovery Assessment

- **Existing State in Repository:** No automated `mongodump` / `mongorestore` backup scripts, point-in-time recovery (PITR) runbooks, or scheduled snapshot CI workflows exist in git. Backups currently depend solely on external MongoDB Atlas managed configuration (unverified in-repo).
- **Identified Data Loss & Recovery Risks:**
  1. **Destructive Updates Without Snapshot Gate:** Running an ad-hoc script directly against `MONGODB_URI` on production Atlas without a pre-migration snapshot risks irreversible partial updates (e.g., overwriting `diemTrungBinh` or `location`).
  2. **AI Service Empty-Boot Risk:** If `MONGODB_DB_NAME` in AI (`gastrowise` / `gastro_ai_test`) differs from `CORE_DB_NAME` (`gastro_core` / `gastro_core_test`), AI silently initializes with 0 restaurants.
  3. **`User.hashedRefreshToken` Persistence Loss:** Unmarked `hashedRefreshToken?: string` in `user.schema.ts` causes Mongoose `strict: true` to silently ignore refresh-token persistence on login.
- **Recommended Backup & Restore Strategy:**
  - Enable MongoDB Atlas Continuous Backup / Cloud Snapshots before any M8.2 write migration, supplemented by scripted `mongodump --uri="$MONGODB_URI_CORE" --archive=... --gzip` (excluding credentials from logs) and restore verification into ephemeral `mongo:7.0` test containers (`mongorestore --archive=... --gzip --drop`).

---

## 4. Data Integrity Risks (Summary)

1. **`User.hashedRefreshToken` missing `@Prop()`** (`user.schema.ts:49`) — silently dropped by Mongoose strict mode during `updateRefreshToken()`.
2. **Mixed Rating Scales (`0–10` vs `0–5`)** stored in `restaurants.diemTrungBinh` without `ratingScale` metadata.
3. **Collection Name Collision** between `interactions/schemas/interaction.schema.ts` and unregistered `users/schemas/user-interaction.schema.ts` (both target `user_interactions`).
4. **Orphan `ObjectId` References:** `User.savedRestaurants[]` and `Review.restaurantId` lack cleanup hooks when restaurants are deleted.
5. **Default GeoJSON Coordinates Trap:** `Restaurant.location.coordinates` defaults to `[106.7009, 10.7769]` when missing.
6. **Dual Creation Timestamps** (`createdAt` vs `created_at`) and 3 overlapping `user_id` indexes on `itineraries`.

---

## 5. Recommended Migration Strategy (Zero-Downtime Expand-Contract)

1. **Tooling & Governance:** Introduce deterministic forward/rollback migration runner (e.g., `migrate-mongo` or typed TypeScript runner tracking applied migrations in `schema_migrations` collection inside each service DB).
2. **Expand-Contract Execution Order:**
   - **Pre-Check:** Run read-only audit/count assertions on staging snapshot -> take `mongodump`/Atlas snapshot.
   - **Expand:** Add new optional fields (`schemaVersion`, `ratingScale`, `rawRating`, `@Prop()` on `hashedRefreshToken`, `resetOtpExpiresAt`) and build new indexes with `background: true` (MongoDB builds non-blocking).
   - **Backfill:** Run idempotent batched migrations (`bulkWrite`, cursor batch size `500`) tagged with `schemaVersion`. Remove `onApplicationBootstrap()` full-collection scan from `RestaurantsService`.
   - **Verify:** Assert document counts, null rates, index presence (`explain("executionStats")` confirming `IXSCAN`/`GEO_NEAR`), and contract tests.
   - **Contract / Cleanup:** Drop redundant single-field indexes and orphaned duplicate schema files in follow-up milestone.

---

## 6. Priority-Ranked Remediation & M8.2 Tasks

| Priority | Task ID | Scope / Action | Impact |
|---|---|---|---|
| **P0** | **M8.2-01** | Add `@Prop({ required: false })` to `User.hashedRefreshToken` + `resetOtpExpiresAt` (with TTL index or expiry check) | Fixes silent refresh-token persistence failure |
| **P0** | **M8.2-02** | Introduce versioned migration runner (`schema_migrations` tracking, `up`/`down` scripts, `dry-run` flag, `npm run migrate:*`) & remove boot-time `COLLSCAN` from `RestaurantsService.onApplicationBootstrap` | Safe repeatable schema evolution & faster cold starts |
| **P0** | **M8.2-03** | Add scripted `mongodump` / `mongorestore` backup & restore verification harness targeting isolated `mongo:7.0` CI container | Prevents production data loss during migrations |
| **P1** | **M8.2-04** | Add missing critical query/sort indexes: `menu_items({restaurantId:1, isFeatured:-1, createdAt:-1})`, `reviews({restaurantId:1, isFeatured:-1, createdAt:-1})` & `({urlGoc:1, isFeatured:-1, createdAt:-1})`, `restaurants({diemTrungBinh:-1, reviewsCount:-1})` & `urlGoc`, `contacts({createdAt:-1})` | Eliminates `COLLSCAN` & in-memory `SORT` bottlenecks |
| **P1** | **M8.2-05** | Backfill `restaurants.ratingScale` (`10_point` vs `5_point`) & `rawRating` metadata + remove misleading Q1 default coordinates (`location: null` when invalid) | Resolves ISSUE-06 permanently at source DB level |
| **P2** | **M8.2-06** | Deduplicate `itineraries` timestamps (`createdAt` vs `created_at`) and drop redundant single-field indexes (`itineraries.user_id`, `user_interactions.userId`/`targetId`, `taste_dna_profiles.userId` `index:true`) | Reduces write amplification & index RAM |
| **P2** | **M8.2-07** | Remove or cleanly archive orphaned schema files (`user-interaction.schema.ts` collision, `audit-log`, `notification`, `chat-session`, `favorite-collection`) and legacy monolith `src/` duplicates | Eliminates developer confusion & schema drift |
| **P2** | **M8.2-08** | Add TTL retention option for high-volume `user_interactions` and ensure `docker-compose.yml` aligns/seeds `ai-service` catalog from `gastro_core_test` | Bounds storage & prevents empty AI catalog in CI |
