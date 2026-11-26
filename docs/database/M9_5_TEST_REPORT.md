# M9.5 — Automated Test & Integration Validation Report

**Branch:** `feature/m9-5-geojson-referential-integrity`  
**Scope:** GeoJSON Integrity (`BLK-04`), Referential Integrity & Uniqueness (`BLK-07`), and `V003`/`V004` Migration Validation (synthetic isolated fixtures only — zero production Atlas access)

---

## 1. Code Build, Typecheck & Linting

| Check | Command | Result |
| :--- | :--- | :--- |
| Shared build | `npm run build:shared` | **PASS** (`exit 0`) |
| Core Service build | `npm run build:core` | **PASS** (`exit 0`) |
| Planning Service build | `npm run build:planning` | **PASS** (`exit 0`) |
| Strict TypeScript check | `npx tsc -p tsconfig.build.json --noEmit` | **PASS** (`exit 0`) |
| Docker Compose validation | `docker compose config -q` | **PASS** (`exit 0`) |
| Targeted ESLint (`libs/shared/src/utils`, `scripts/migrations`) | `npx eslint "libs/shared/src/utils/*.ts" "scripts/migrations/**/*.ts"` | **PASS** (`0 errors, 0 warnings`) |

---

## 2. Unit & Regression Test Suite (`npm run test:microservices`)

Executed `jest libs/ apps/`:
- **Test Suites:** `29 passed, 29 total`
- **Tests:** `178 passed, 178 total`
- **New / Updated Coverage Added in M9.5:**
  - [`libs/shared/src/utils/geo.utils.spec.ts`](../../libs/shared/src/utils/geo.utils.spec.ts): valid coords, comma-decimal strings, `undefined`/`null`, `[0, 0]`, out-of-range `lat`/`lon`, `[lon, lat]` ordering.
  - [`apps/core-service/src/restaurants/restaurants.geo-integrity.spec.ts`](../../apps/core-service/src/restaurants/restaurants.geo-integrity.spec.ts): removal of `onApplicationBootstrap` / `ensureGeoJsonLocations`, null default on omitted coords, District 1 default regression, `$geoNear` + Haversine un-geocoded filtering, orphan `menu_item` rejection, `RestaurantsService.remove` cascades.
  - [`apps/core-service/src/users/users.uniqueness-favorites.spec.ts`](../../apps/core-service/src/users/users.uniqueness-favorites.spec.ts): lowercase + trimmed email normalization, `E11000` -> `ConflictException`, concurrent Google email race recovery & cross-domain username suffixing, atomic `$pull` / `$addToSet` favorite toggles, partial unique review index & duplicate rejection, `UsersService.remove` cascade vs review/restaurant unlink, removal of colliding `user-interaction.schema.ts`.
  - [`apps/planning-service/src/itineraries/itineraries.service.spec.ts`](../../apps/planning-service/src/itineraries/itineraries.service.spec.ts): invalid/missing/`[0,0]` itinerary start rejection, filtering un-geocoded candidate venues, `addStop` rejection for un-geocoded venues, multi-stop `prevLng` recalculation fix.
  - [`libs/shared/src/contracts/data-integrity.spec.ts`](../../libs/shared/src/contracts/data-integrity.spec.ts): updated schema contract test asserting `location` defaults to `null` (no `[106.7009, 10.7769]` fallback).

---

## 3. Ephemeral Docker MongoDB 7.0 Runtime Migration & Query Check

Executed against isolated database `gastro_m95_ephemeral` inside authenticated `gastrowise-mongo-test` (and dropped after completion):

1. **Seeded Synthetic Anomalies:**
   - Un-geocoded restaurant with fabricated Q1 `[106.7009, 10.7769]`
   - Valid Q1 restaurant (`lat: 10.7769, lon: 106.7009`)
   - Un-synced flat-coordinate venue (`lat: 10.7867, lon: 106.6881, location: null`)
   - Null Island venue (`lat: 0, lon: 0, location: [0, 0]`)
   - Mixed-case untrimmed user email (`"  Alice.M95@Example.COM "`), dangling `savedRestaurants` ID, duplicate `(userId, restaurantId)` reviews, orphan `menu_item`.
2. **CLI Lifecycle (`scripts/migrations/cli.ts`):**
   - `migrate:status --scope=core`: identified 3 pending migrations (`v002`, `v003`, `v004`).
   - `migrate:up --scope=core --dry-run`: zero mutations; projected all 3 migrations cleanly.
   - `migrate:up --scope=core` (Run #1): `v002` (`refreshModified: 1, otpModified: 1`), `v003` (`modifiedCount: 3`), `v004` (`dedupedReviews: 1, cleanedMenuItems: 1, uniqueIndex: "uniq_user_restaurant_review"`).
   - `migrate:up --scope=core` (Run #2 — idempotency): `executed: []`, `skippedAlreadyApplied: [v002, v003, v004]`.
3. **Post-Migration Runtime Assertions Observed:**
   - `Ungeocoded Fake Q1` -> `location: null`; `ZeroZero Venue` -> `location: null`; `Flat Coords Venue` -> `Point [106.6881, 10.7867]`; `Real District 1 Spot` preserved.
   - Live `$geoNear` returned strictly `["Real District 1 Spot", "Flat Coords Venue"]` (excluded un-geocoded & Null Island documents).
   - User email normalized to `alice.m95@example.com`; dangling favorite pruned (`savedRestaurantsCount: 1`); duplicate review archived & deduped (`reviewCountAfterDedup: 1`, `archivedDupReviews: 1`, newer review kept); orphan menu item archived & deleted (`menuCountAfterOrphanCleanup: 1`, `archivedOrphans: 1`).
   - Direct duplicate review insert blocked by MongoDB (`e11000Blocked: true`).
4. **Rollback (`migrate:down --scope=core --steps=2`):**
   - Rolled back `v004` (`restoredDuplicateReviews: 1`, `ROLLBACK_REVIEW_COUNT=2`) and `v003` (`restoredCount: 3`), then dropped `gastro_m95_ephemeral`.

---

## 4. `BLK-11` Scope Boundary Note

Real production Atlas snapshot profiling (`BLK-11`) remains **UNRESOLVED** by policy until an explicitly isolated staging snapshot is provisioned and authorized.
