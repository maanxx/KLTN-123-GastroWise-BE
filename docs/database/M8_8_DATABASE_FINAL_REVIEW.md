# M8.8 — GastroWise Database Final Review & Production Readiness Assessment

- **Repository:** `maanxx/KLTN-123-GastroWise-BE`
- **Branch:** `feature/m8-8-database-final-review` (branched from M8.7 `feature/m8-7-migration-testing` `e57c0c9164660dc29538654275738a3862656167`)
- **Companion Deliverables:**
  - [`M8_8_PRODUCTION_READINESS_SCORECARD.md`](./M8_8_PRODUCTION_READINESS_SCORECARD.md)
  - [`M8_8_BLOCKER_REGISTER.md`](./M8_8_BLOCKER_REGISTER.md)
  - [`M8_8_REMEDIATION_ROADMAP.md`](./M8_8_REMEDIATION_ROADMAP.md)
- **Prior Milestones Independently Audited:** M8.1 (`057eb64`), M8.2 (`905ac66`), M8.3 (`ea55f13`), M8.4 (`ed8ea67`), M8.5 (`04995fc`), M8.6 (`d598a84`), M8.7 (`e57c0c9`).
- **Scope & Safety Verification:** Strictly read-only repository/evidence audit. Zero application files, schemas, indexes, secrets, or database records were modified. Zero live/production MongoDB operations were executed.

---

## 1. Executive Summary & Dual Verdicts

| Assessment Dimension | Verdict | Rationale Summary |
|---|---|---|
| **M8.8 Audit Execution Verdict** | **FULL PASS** | Complete repository preflight, line-level verification of M8.1–M8.7 findings against actual source code (`BE` + `AI`), and cross-examination of M8.7 Docker `mongo:7.0.48` runtime outputs completed cleanly. |
| **Production Database Readiness Verdict** | **NOT READY FOR PRODUCTION** | Critical confirmed security/data defects remain unfixed in live code (`User.hashedRefreshToken`, `User.resetOtp` no expiry, `CreateReviewDto` `@Max(10)`, GeoJSON Q1 fallback corruption), no production TypeScript migration runner exists, AI DB parity is misconfigured in Compose (`gastro_ai_test` empty), staging lacks DB `--auth`, and production Atlas backup/PITR/explain remain unverified. |

---

## 2. Architecture Review (M8.8.1)

Verified against [`apps/core-service/src/app.module.ts`](../../apps/core-service/src/app.module.ts), [`apps/planning-service/src/app.module.ts`](../../apps/planning-service/src/app.module.ts), [`KLTN-123-GastroWise-AI/app/config.py`](../../../KLTN-123-GastroWise-AI/app/config.py), and [`docker-compose.yml`](../../docker-compose.yml):
- **Ownership Boundaries:** Database-per-Service is implemented structurally (`core-service` $\rightarrow$ `CORE_DB_NAME` default `gastro_core`, `7` active collections; `planning-service` $\rightarrow$ `PLANNING_DB_NAME` default `gastro_planning`, `1` active collection `itineraries` following ADR-09 scalar IDs and embedded `stops[]` snapshots).
- **Shared Collection & Parity Anomaly (`HIGH`):** `ai-service` reads `restaurants` directly via PyMongo (`MONGODB_DB_NAME`, default `gastrowise`) instead of Core's `gastro_core`. In `docker-compose.yml:138-139`, `ai-service` targets `gastro_ai_test` (empty), confirmed in M8.7 runtime (`GET /` $\rightarrow$ `restaurants_loaded: 0`). Furthermore, `ai-service` loads `df` once at startup with zero automated cache invalidation when Core updates `restaurants`.
- **Legacy Architectural Coupling (`MEDIUM`):** `.env.example` configures `MONGODB_URI`, `MONGODB_URI_CORE`, `MONGODB_URI_PLANNING` separately, whereas root `.env` sets both `CORE_DB_NAME` and `PLANNING_DB_NAME` to `gastrowise` when shared locally. Root `src/` still retains `14` legacy pre-microservices `@Schema()` files alongside `5` unregistered schemas in `apps/core-service/`, including `user-interaction.schema.ts` colliding on collection `user_interactions`.

---

## 3. Schema & Index Review (M8.8.2)

Independently verified against current source files in `apps/`:
- **Confirmed Schema Defects Still Unfixed:**
  1. [`user.schema.ts:49`](../../apps/core-service/src/users/schemas/user.schema.ts#L49): `hashedRefreshToken?: string;` lacks `@Prop()`. Combined with `UsersService.updateRefreshToken()` writing unhashed input (`users.service.ts:113-114`) while `AuthService.refresh()` executes `bcrypt.compare(refreshToken, user.hashedRefreshToken)` (`auth.service.ts:108`), refresh-token persistence and rotation are broken.
  2. [`user.schema.ts:90-91`](../../apps/core-service/src/users/schemas/user.schema.ts#L90-L91) & [`auth.service.ts:278,365`](../../apps/core-service/src/auth/auth.service.ts#L278): `resetOtp` has no `resetOtpExpiresAt` field or TTL/expiry check despite 15-minute copy in email HTML (`auth.service.ts:311`), and OTP codes are printed to stdout logs (`auth.service.ts:316`).
  3. **GeoJSON Q1-Default Fallback (`restaurant.schema.ts:28-31` & `restaurants.service.ts:96`):** `Restaurant.location.coordinates` defaults to `[106.7009, 10.7769]` (District 1, HCMC). Venues seeded with `lat: 0, lon: 0` or missing coordinates match District 1 `$geoNear` queries while retaining `0,0` flat coordinates — proven live in M8.7 when `POST /api/v1/itineraries/generate` yielded `distance_to_next_km: 15971.73` (`39,929` mins transit).
  4. **Mixed Rating Scale:** `restaurants` stores Foody `0–10` ratings alongside `0–5` user review averages in `diemTrungBinh` without `ratingScale` / `rawRating`.
- **Index Verification:** M8.2's `29` declared indexes (`0` TTL) and `5` redundant indexes (`user_interactions.userId_1`, `user_interactions.targetId_1`, `itineraries.user_id_1`, duplicate `created_at` index, duplicate `taste_dna_profiles.userId` index flag) remain unchanged in production schemas. M8.7 runtime `explain("executionStats")` proved that adding M8.3 `V001` indexes eliminated all observed `COLLSCAN` + blocking `SORT` plans on `menu_items`, `reviews`, `restaurants`, and `contacts`.

---

## 4. Migration Readiness Review (M8.8.3)

- **Actual Tooling State Verified:** [`scripts/`](../../scripts) contains only [`migrate-geojson.ts`](../../scripts/migrate-geojson.ts) (manual GeoJSON backfill targeting legacy `MONGODB_URI`) and [`db-split-dryrun.ts`](../../scripts/db-split-dryrun.ts) (read-only boundary scan). [`package.json`](../../package.json) defines zero migration dependencies (`migrate-mongo`, `umzug`) and zero migration npm scripts. `RestaurantsService.onApplicationBootstrap()` (`restaurants.service.ts:51-118`) still runs an unindexed startup scan on every Core boot.
- **Assessment:** **Production migration execution is NOT safe today.** Although M8.3 designed Expand–Contract waves (`V001`–`V006`) and M8.7 validated those operations via synthetic `mongosh` scripts (including `E11000` dedup handling, idempotent `0`-delta re-runs, down-rollbacks, and archive recovery), no versioned TypeScript migration runner, checksum tracking (`schema_migrations`), dry-run CLI, or concurrency lock exists in the codebase.

---

## 5. Backup & Disaster Recovery Review (M8.8.4)

| Capability | Documented Design (M8.4 / M8.5) | Tested Evidence (M8.7) | Remaining Gap (Untested) |
|---|---|---|---|
| **Logical Backup & Restore** | Daily `mongodump --archive --gzip` + pre-migration archive + `sha256sum` + `mongorestore --drop` | **Verified in Docker `mongo:7.0.48`:** `1097` docs restored with `0` failures after simulated `reviews.drop()`, `gzip -t` + `sha256` verified | No automated backup cron/CI pipeline or off-site WORM object storage exists |
| **Managed PITR / Replica Set** | Atlas M10+ continuous oplog PITR (`RPO <= 5m`, `RTO <= 30m`) | **Not tested** (Atlas cluster & tier unverified) | Exact Atlas tier, snapshot schedule, and PITR drill unverified |
| **DR Failover Exercises** | Exercises 1–4 in [`M8_5_DR_EXERCISE_PLAN.md`](./M8_5_DR_EXERCISE_PLAN.md) (`mongo` outage, `ai` outage, migration abort, backup restore) | Exercises 3 & 4 validated via M8.7 migration `E11000` + `mongorestore`; Exercises 1 & 2 (live process resilience during DB outage) **not executed** | `/health` probes remain static liveness checks without checking MongoDB `readyState === 1` |

---

## 6. Data Integrity Review (M8.8.5)

Verified directly in repository code & M8.7 runtime traces:
- **`CreateReviewDto` (`create-review.dto.ts:22-24`):** `@Max(10)` permits `diemReview` values `6–10`; confirmed live in M8.7 via `POST /api/v1/reviews` returning `201 Created` for `diemReview: 9`.
- **Missing Server & Pipe Enforcement:** Both [`core-service/src/main.ts:20`](../../apps/core-service/src/main.ts#L20) and [`planning-service/src/main.ts:29`](../../apps/planning-service/src/main.ts#L29) use `ValidationPipe({ whitelist: false, transform: true })`. `CreateRestaurantDto` (`create-restaurant.dto.ts:1`) is empty `{}`. `CreateUserDto` (`create-user.dto.ts:28-31`) misapplies `@IsUrl()` to `firstName`. Repository grep confirms **`0` `$jsonSchema` / `collMod` rules** and **`0` `runValidators: true` flags** across `apps/`, `libs/`, and `scripts/`. Storing a BSON array in `Restaurant.tags` (declared `string`) crashed `GET /api/v1/restaurants/nearby` with `500` live in M8.7.
- **Referential Integrity & Uniqueness:** No cascade delete in `RestaurantsService.remove` (`restaurants.service.ts:1079-1084`) or `UsersService.remove` (`users.service.ts:91-100`); no lowercase email normalization (`users.service.ts:102-104`); no partial unique `{ userId: 1, restaurantId: 1 }` index on `reviews`.

---

## 7. Security Review (M8.8.6)

- **Staging DB Authentication Gap (`HIGH`):** `docker-compose.yml` configures `mongo:7.0` with no `--auth` / `MONGO_INITDB_ROOT_USERNAME` / least-privilege SCRAM users (`gastrowise-mongo-test` accepts unauthenticated internal connections). Least-privilege per-DB credentials (`core` RW vs `ai` `read`-only on `gastro_core.restaurants`) were never exercised at runtime.
- **Application DB Security Defects (`CRITICAL`):** `User.hashedRefreshToken` missing `@Prop()` + unhashed persistence + `403` failure on `/auth/refresh`; `User.resetOtp` lacks `resetOtpExpiresAt` and logs OTPs in plaintext (`auth.service.ts:316`).
- **Positives Preserved:** Root `.env` is excluded by `.gitignore` and was not leaked; `docker-compose.yml` is network-isolated from Atlas; Core↔Planning↔AI internal endpoints enforce `INTERNAL_SERVICE_KEY` / `INTERNAL_AI_KEY` fail-closed.

---

## 8. Runtime Evidence Review (M8.8.7)

Cross-verified [`M8_7_MIGRATION_TEST_REPORT.md`](./M8_7_MIGRATION_TEST_REPORT.md), [`M8_7_RUNTIME_VALIDATION.md`](./M8_7_RUNTIME_VALIDATION.md), and [`M8_7_DATA_INTEGRITY_RESULTS.md`](./M8_7_DATA_INTEGRITY_RESULTS.md):
- **Verified Observed Runtime Evidence:** MongoDB `7.0.48` container (`172.18.0.6`), pre/post `mongodump` SHA-256 hashes, `V001`–`V005` + GeoJSON Run #1/#2 counts, `E11000` trace prior to `V004` dedup, rollback & `mongorestore` (`1097` docs, `0` failures), `explain("executionStats")` before/after tables, `npm run test:microservices` (`23` suites / `132` tests), and live Gateway probes cleanly distinguish observed runtime results from unexecuted production checks.
- **Note:** All M8.7 runtime migrations (`V001`–`V005`) were synthetic `mongosh` executions validating M8.3 strategy semantics rather than executing an existing TypeScript migration framework (since none exists yet).
