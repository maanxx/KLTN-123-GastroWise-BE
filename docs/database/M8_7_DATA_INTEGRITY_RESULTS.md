# M8.7 — Data Integrity Runtime Verification Results

- **Repository:** `maanxx/KLTN-123-GastroWise-BE`
- **Branch:** `feature/m8-7-migration-testing`
- **Target Database:** `gastro_core_test` & `gastro_planning_test` on `gastrowise-mongo-test` (`mongo:7.0.48`)
- **Methodology:** Applied M8.6 validation matrix and Tier 3 read-only aggregation queries against the migrated synthetic test dataset (`2026-11-25T09:10:40Z`), plus live API boundary probes.

---

## 1. Aggregation Integrity Audit Results (M8.7.8)

| Integrity Check (M8.6 Tier 3 Query) | Expected Post-Migration Result (Clean Codebase) | Actual Runtime Result (With Seeded Realistic Anomalies) | Root Cause Confirmed at Runtime |
|---|---|---|---|
| **Orphan `menu_items`** (`$lookup` on `restaurants._id`) | `0` orphans | **`2` orphans detected** | `RestaurantsService` lacks cascade delete & `MenuItem` creation does not verify parent existence atomically |
| **Orphan `reviews`** (`$lookup` on `restaurants._id`) | `0` orphans | **`2` orphans detected** | Missing FK constraint in MongoDB + unresolved slug / missing cascade on restaurant removal |
| **Duplicate `(userId, restaurantId)` `reviews` (Pre-V004)** | Unique index blocks duplicates | **`2` duplicate pairs blocked index build (`E11000`)** | Existing schema has no partial unique index (`V004` prerequisite) |
| **Duplicate `(userId, restaurantId)` `reviews` (Post-V004)** | `0` duplicates | **`0` duplicates (`_archive_reviews_duplicates`: `2`, `uniq_user_restaurant_review` active)** | `V004` archive + deduplication resolved collision cleanly |
| **Case-variant duplicate `users.email`** | Unique email normalized lowercase | **`1` collision group (`2` users: `CaseVariant@example.com`, `casevariant@example.com`)** | `users.email_1` is case-sensitive and `UsersService` lacks lowercase normalization |
| **Out-of-scale `reviews.diemReview` (`> 5` or `< 1`)** | `0` records outside `[1, 5]` | **`2` seeded records (`9`, `10`) + `1` accepted via live `POST /api/v1/reviews` (`diemReview: 9`, HTTP `201`)** | `CreateReviewDto` allows `@Max(10)` while domain expects 5-star reviews |
| **Corrupt Q1 fallback `[106.7009, 10.7769]` with `lat: 0, lon: 0`** | `0` venues with `0/0` coords masquerading in Q1 | **`20` venues persisted; reproduced `15,971.73 km` distance in live `POST /api/v1/itineraries/generate`** | Schema default `[106.7009, 10.7769]` masks un-geocoded `0/0` coordinates during `$geoNear` |
| **Dangling `users.savedRestaurants[]` references** | `0` dangling `ObjectId`s | **`1` dangling reference detected** | Deleted restaurants are not `$pull`ed from `users.savedRestaurants` |
| **Unvalidated BSON types (`restaurants.tags`)** | String field rejected if array inserted | **MongoDB accepted array (`0` `$jsonSchema` rules) $\rightarrow$ Core `/restaurants/nearby` crashed `500`** | Zero server-side `$jsonSchema` collection validators |

---

## 2. Final Migrated Test Collection Parity (`gastro_core_test` & `gastro_planning_test`)

Counts recorded immediately after `V001` + `migrateGeoJson` + `V002` + `V004` + `V005`:

| Database | Collection | Seeded Count | Post-Migration Count | Delta & Verification Reason |
|---|---|---|---|---|
| `gastro_core_test` | `users` | `50` | `50` | `0` loss (`50/50` received `hashedRefreshToken: null`, `resetOtpExpiresAt: null`) |
| `gastro_core_test` | `restaurants` | `200` | `200` | `0` loss (`30` GeoJSON backfilled; `70` marked `5_point`, `130` marked `10_point`) |
| `gastro_core_test` | `menu_items` | `200` | `200` | `0` loss (`2` orphan refs flagged cleanly by audit query) |
| `gastro_core_test` | `reviews` | `250` | `248` | `-2` deduplicated; `2` exact records preserved in `_archive_reviews_duplicates` |
| `gastro_core_test` | `_archive_reviews_duplicates` | `0` | `2` | Holds archived V004 duplicate reviews |
| `gastro_core_test` | `contacts` | `100` | `100` | `0` loss |
| `gastro_core_test` | `user_interactions` | `250` | `250` | `0` loss |
| `gastro_core_test` | `taste_dna_profiles` | `40` | `40` | `0` loss |
| `gastro_planning_test` | `itineraries` | `40` | `40` | `0` loss (`2` baseline + `38` synthetic incl. `5` legacy `created_at` docs) |

---

## 3. Summary of Verified Blockers Before Production Sign-Off

1. **Application Defect (`CRITICAL`):** `POST /api/v1/auth/refresh` fails `403 Forbidden` because `User.hashedRefreshToken` lacks `@Prop()` in `user.schema.ts`. Must be fixed before running `V002` in production.
2. **Application & Schema Drift (`CRITICAL` / `HIGH`):** `CreateReviewDto` (`@Max(10)`), `Restaurant.location` default `[106.7009, 10.7769]` vs `lat: 0, lon: 0`, case-sensitive `users.email`, and missing `$jsonSchema` type validation on `restaurants.tags` all manifested as real runtime failures/corruption in M8.7.
3. **Topology Parity (`HIGH`):** AI Service container in `docker-compose.yml` reads `gastro_ai_test` (empty) instead of `gastro_core_test`, preventing live AI recommendation validation without explicit dataset sync; `mongo-test` runs without `--auth`.
4. **Tooling (`HIGH`):** Production TypeScript migration runner (`V001`–`V006`) is not yet implemented in `scripts/`.
