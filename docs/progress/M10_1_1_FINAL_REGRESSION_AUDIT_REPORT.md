# M10.1.1 — Final Regression & Integration Audit Report

- **Date:** 2026-11-27
- **Repository:** `maanxx/KLTN-123-GastroWise-BE`
- **Audited Branch:** `fix/m10-1-restaurant-schema-rating-compatibility`
- **Base Branch:** `main` @ `7d3d901` (PR #12 merge commit)
- **Pre-Audit HEAD:** `77ae982`
- **Reference AI Repository (Read-Only):** `thienthiencute/KLTN-123-GastroWise-AI` on `feature/m10-ai-data-readiness` @ `3159c15`
- **Environment Scope:** Local workspace + isolated local Docker stack (`mongo-test`, `core-service`, `planning-service`, `ai-service`, `nginx-gateway`). **Zero production MongoDB Atlas access; persistent volume `kltn-123-gastrowise-be_mongo_test_data` preserved.**

---

## 1. Executive Audit Summary & Hardening Fixes Applied

An independent, code-and-runtime audit of M10.1 (`77ae982`) confirmed the core schema compatibility and normalizer foundations, and identified **4 real edge-case gaps** across Core, Planning, and Shared libraries that were fixed and verified before PR readiness:

| # | Gap Identified During Audit | Risk Before Fix | Fix Implemented in M10.1.1 |
|---|---|---|---|
| 1 | **Silent classification of ambiguous `[0, 5]` ratings (`restaurant-normalizer.util.ts`)** | Documents with `0 <= diemTrungBinh <= 5`, no explicit `ratingScale`, no Foody subscores, and missing/`0` `reviewsCount` returned `ratingScale: '5_point'`, silently marking ambiguous provenance as verified 5-point data. | Added `'ambiguous'` to `RatingScaleKind` and `isAmbiguous: boolean` (`is_ambiguous_rating` on `RestaurantCandidateDto`, `isAmbiguousRating` on Core restaurant DTO). Unannotated `[0, 5]` values pass through bounded for display stability while explicitly flagging `ratingScale: 'ambiguous'` and `isAmbiguous: true`. |
| 2 | **Duplicate & gapped `order_index` on missing/duplicate/mixed inputs (`normalizeStopOrderIndexes`)** | `normalizeStopOrderIndexes()` could emit duplicate positions (`[1, 1, 3]` or `[1, 2, 2]`) or skip positions (`[1, 3]`) when input stops had missing, duplicate, or mixed 0-based/1-based indexes. | Rewrote `normalizeStopOrderIndexes()` to rank stops deterministically by `(validNonNegOrderIndex ?? +Infinity, originalArrayIndex)` and emit contiguous 1-based `[1..N]` with zero duplicates and zero skipped positions. |
| 3 | **Latent array-tags `TypeError` on `.lean()` docs in `ReviewsService` (`reviews.service.ts`)** | `ReviewsService` called `(restDoc.tags || '').toLowerCase()` on a `.lean()` query result (bypassing Mongoose schema getters), throwing `TypeError` whenever MongoDB stored `tags` as a `string[]`, and passed raw `restaurant.tags` into `targetCuisine`. | Switched `ReviewsService` (`lines 221, 291, 296`) and `ItinerariesService` (`calculateTasteAffinityScore`, `inferMealType`, `recalculateTimetableAndMetrics`) to `formatRestaurantTagsString(...)`. |
| 4 | **`FavoritesService` & `AiApiClient` edge normalization (`favorites.service.ts`, `ai-api.client.ts`)** | `FavoritesService.getTopFavoritedRestaurants()` read raw MongoDB docs with `r.diemTrungBinh \|\| 5.0` and unformatted `r.tags`; `AiApiClient.mapToCanonicalAiRequest()` forwarded `r.tags` verbatim without coercing array tags to `string` or forwarding `rawRating`/`ratingScale`. | Normalized `diemTrungBinh` and `tags` in `FavoritesService` via `normalizeRestaurantRating` & `formatRestaurantTagsString`; hardened `AiApiClient.mapToCanonicalAiRequest()` to pass `rawRating`/`ratingScale` and coerce array `tags` via `formatRestaurantTagsString`. |

---

## 2. Rating Normalization Audit (`libs/shared/src/utils/restaurant-normalizer.util.ts`)

### Verification Matrix

| Case | Sample Input | Normalized `rating` | `rawRating` | `ratingScale` | `isAmbiguous` | Verified By |
|---|---|---:|---:|---|---|---|
| Foody 10-point (`> 5`) | `{ diemTrungBinh: 8.6, reviewsCount: 0 }` | `4.3` | `8.6` | `'10_point'` | `false` | Unit + Docker |
| Foody 10-point subscore-inferred (`<= 5`) | `{ diemTrungBinh: 4.0, diemChatLuong: 4.2, reviewsCount: 0 }` | `2.0` | `4.0` | `'10_point'` | `false` | Unit |
| Explicit 10-point metadata | `{ diemTrungBinh: 4.2, ratingScale: '10_point' }` | `2.1` | `4.2` | `'10_point'` | `false` | Unit |
| GastroWise verified 5-point (`reviewsCount > 0`) | `{ diemTrungBinh: 4.4, reviewsCount: 15 }` | `4.4` | `4.4` | `'5_point'` | `false` | Unit + Docker |
| Explicit 5-point metadata | `{ diemTrungBinh: 4.2, ratingScale: '5_point' }` | `4.2` | `4.2` | `'5_point'` | `false` | Unit |
| Ambiguous `[0, 5]` without scale metadata | `{ diemTrungBinh: 4.0 }` / `{ diemTrungBinh: 0 }` | `4.0` / `0` | `4.0` / `0` | `'ambiguous'` | `true` | Unit + Docker |
| Missing / null / non-numeric | `{ diemTrungBinh: null }` / `undefined` | `3.0` | `3.0` | `'default'` | `false` | Unit + Docker |
| Negative out-of-range | `{ diemTrungBinh: -3 }` | `0` | `-3` | `'default'` | `false` | Unit |
| Over-max out-of-range (`> 10`) | `{ diemTrungBinh: 25 }` | `5.0` | `25` | `'10_point'` | `false` | Unit |
| Already normalized (`_ratingNormalized: true` or DTO pass-through) | `{ rating: 4.2, rawRating: 8.4, ratingScale: '10_point', _ratingNormalized: true }` | `4.2` | `8.4` | `'10_point'` | `false` | Unit |
| Re-normalized ambiguous DTO pass-through | `{ rating: 3.8, rawRating: 3.8, ratingScale: 'ambiguous' }` | `3.8` | `3.8` | `'ambiguous'` | `true` | Unit |

### Documented Assumptions & Limitations

1. **Unannotated `[0, 5]` values without scale metadata:** Without `ratingScale` / `raw_rating_scale` / `rating_scale`, without Foody subscore fields (`diemChatLuong`, `diemViTri`, `diemPhucVu`, `diemGiaCa`, `diemKhongGian`), and with `reviewsCount` absent or `0`, it is mathematically impossible to distinguish a low 10-point score (e.g., `4.0 / 10`) from a 5-point score (`4.0 / 5`). To avoid broken UI ratings while refusing to claim verified accuracy, the normalizer passes the `[0, 5]` value through **and explicitly sets `ratingScale: 'ambiguous'` + `isAmbiguous: true`**.
2. **`reviewsCount > 0` heuristic limitation:** Documents with `reviewsCount > 0` and no explicit `ratingScale` are classified as `'5_point'` because `ReviewsService` recomputes `diemTrungBinh` from 5-star user reviews (`reviews.service.ts:455`). If an external import populates `reviewsCount > 0` with unmigrated 10-point scores (`<= 5.0`) and omits subscores and `ratingScale`, backfilling explicit `ratingScale` via migration is required.
3. **Zero scores without reviews:** `{ diemTrungBinh: 0 }` with `reviewsCount` missing/`0` is invariant numerically (`0 / 2 == 0`), and is classified `'ambiguous'` (`isAmbiguous: true`) until rated or explicitly annotated.

---

## 3. Tags Compatibility Audit

| Input Format | `normalizeRestaurantTags()` (`string[]`) | `formatRestaurantTagsString()` (`string`) | Consumer Alignment |
|---|---|---|---|
| Comma string (`"pho, vietnamese, noodle"`) | `['pho', 'vietnamese', 'noodle']` | `'pho, vietnamese, noodle'` | Core DTO (`tags` str, `cuisineTypes` `string[]`), Internal (`tags: string[]`), AI `/routes/optimize` (`str`) |
| Flat array (`['pho', 'vietnamese', 'noodle']`) | `['pho', 'vietnamese', 'noodle']` | `'pho, vietnamese, noodle'` | Safe under both Mongoose hydrated getters and `.lean()` raw docs |
| Mixed comma strings in array (`['pho, beef', '  noodle  ', '']`) | `['pho', 'beef', 'noodle']` | `'pho, beef, noodle'` | Trims whitespace and drops empty segments |
| Empty array `[]` / `null` / `undefined` | `[]` | `''` (`cuisineTypes` falls back to `['Nhà hàng']` in `RestaurantsService`) | Zero crashes |
| Unsupported types (`42`, `true`, `{ foo: 'bar' }`, `[42, {}, 'bún bò']`) | `[]` (or `['bún bò']` filtering non-strings) | `''` (or `'bún bò'`) | Zero `tags.split TypeError` across Core, Reviews, Favorites, Planning, and ACL |

**Contract Representation Consistency:**
- **Core Public API DTO (`RestaurantsService.mapRestaurantToDTO`):** `tags` = comma-joined `string`, `cuisineTypes` = `string[]` (non-empty fallback `['Nhà hàng']`).
- **Core Internal Candidates API (`InternalRestaurantsController.toCandidateDto`):** `tags` = `string[]`.
- **Planning -> AI Route Optimizer (`ItinerariesService` & `AiApiClient`):** `tags` = comma-joined `string` (matching AI Pydantic `CandidateStop.tags: Optional[str]`).

---

## 4. Route `order_index` Normalization Audit (`normalizeStopOrderIndexes`)

`normalizeStopOrderIndexes()` (`libs/shared/src/utils/restaurant-normalizer.util.ts`) now guarantees deterministic ordering and a contiguous `1..N` permutation with **zero duplicates** and **zero skipped positions**:

| Scenario | Input | Output `[id: order_index]` | Verified |
|---|---|---|---|
| Empty array | `[]` | `[]` | Yes (Unit) |
| Fully 0-based | `[a:0, b:1, c:2]` | `[a:1, b:2, c:3]` | Yes (Unit + ACL) |
| Fully 1-based (idempotent) | `[a:1, b:2, c:3]` | `[a:1, b:2, c:3]` | Yes (Unit + ACL + Docker) |
| Missing indexes | `[a:undefined, b:1, c:undefined]` | `[b:1, a:2, c:3]` | Yes (Unit) |
| Duplicate & gapped indexes | `[a:1, b:1, c:3]` | `[a:1, b:2, c:3]` | Yes (Unit + ACL + Itineraries) |
| Mixed 0-based & 1-based duplicates | `[a:0, b:1, c:1, d:2]` | `[a:1, b:2, c:3, d:4]` | Yes (Unit) |

---

## 5. AI Candidate Forwarding & Cross-Service Contract Alignment (vs AI `3159c15`)

Inspected read-only against `KLTN-123-GastroWise-AI` (`app/schemas/routing.py`, `app/schemas/recommendation.py`, `app/schemas/weather.py`, `app/schemas/copilot.py`, `app/core/rating_normalizer.py`):

| Integration Surface | BE Owner | AI Schema (`3159c15`) | Alignment Status | Notes |
|---|---|---|---|---|
| `GET /api/v1/internal/restaurants/candidates` | Core (`InternalRestaurantsController`) | MongoDB `restaurants` loader (`normalize_restaurant_dict`) | Aligned | Both divide 10-pt Foody scores (`> 5` or subscores w/ `reviewsCount === 0`) to `[0, 5]`, preserve raw rating, prevent double-normalization, parse Vietnamese price ranges, and handle mixed `tags`. |
| `POST /routes/optimize` Request (`CandidateStopItem`) | Planning (`ItinerariesService` + `AiApiClient`) | `CandidateStop` (`routing.py`) | Aligned | Forwards `id`, real `name`, `lat`, `lon`, `meal_type`, `open_time`, `close_time`, `dining_duration_mins`, `avg_price`, normalized `rating` (preserving `0`), and string `tags` without silent dummy overrides. |
| `POST /routes/optimize` Response | Planning (`AiApiClient` + `ItinerariesService`) | `RouteOptimizeResponse` (`routing.py`) | Aligned | Supports `stops` / `ordered_stops`, `algorithm_used` / `solver`, `distance_to_next_km` / `distance_km`, `estimated_cost`, and canonicalizes `order_index` once (`1..N`). |
| `/recommend`, `/recommend/weather`, `/recommend/hybrid` | Core (`RestaurantsService`) & `ai.contracts.ts` | `recommendation.py` & `weather.py` | Aligned | Field names and types (`applied_weights: Dict[str, float]`, `items`, `weather`, `scores`) match `ai.contracts.ts`. |
| `/copilot/chat` | Core (`RestaurantsService`) & `ai.contracts.ts` | `CopilotChatRequest`/`Response` (`copilot.py`) | Aligned | Exact match on `message`, `user_gps`, `taste_vector`, `reply`, `intent`, `entities`, `action_card`, `results`. |

---

## 6. Build, Typecheck, Lint, Test & Docker Verification Evidence

All checks below were executed cleanly **after the final code edit**:

1. **Build & Strict Typecheck:**
   - Command: `npm run build:all && npx tsc -p tsconfig.build.json --noEmit` -> **Exit 0** (`core-service` and `planning-service` built cleanly with zero TypeScript errors).
2. **Formatting / Patch Hygiene:**
   - Command: `git diff --check` -> **Exit 0** (zero whitespace/conflict marker issues).
3. **Targeted ESLint Check:**
   - Clean M10.1/M10.1.1 normalizer, contract, schema, and regression spec files (`restaurant-normalizer.util.ts`, `restaurant-normalizer.util.spec.ts`, `core.contracts.ts`, `planning.contracts.ts`, `ai.contracts.ts`, `ai.contracts.spec.ts`, `restaurant.schema.ts`, `restaurants.schema-compatibility.spec.ts`) -> **0 errors, 0 warnings**.
   - Pre-existing legacy `any` usage in `internal-restaurants.controller.ts` (and repo-wide legacy files) still triggers `@typescript-eslint/no-unsafe-*` rules under strict repo ESLint config; left untouched out of scope.
4. **Full Microservices Test Suite:**
   - Command: `npm run test:microservices` (`jest libs/ apps/`)
   - Result: **32 passed / 32 total suites, 203 passed / 203 total tests, 0 failures, 0 skipped.**
5. **Isolated Docker Compose Integration Validation (`docker compose up -d --build core-service planning-service`):**
   - Verified all 5 containers (`mongo-test`, `core-service`, `planning-service`, `ai-service`, `nginx-gateway`) **healthy**.
   - Seeded 4 isolated synthetic test documents in `gastro_core_test.restaurants` covering: (1) Foody 10-pt + array `tags`, (2) GastroWise 5-pt + string `tags` + range price, (3) ambiguous `4.0` w/ mixed comma array `["bún bò, huế", "phở"]`, and (4) `null` tags + missing rating.
   - Verified **Public REST API (`GET http://127.0.0.1:8080/api/v1/restaurants/:id`)** returned HTTP `200` with accurate `rating`, `ratingScale` (`10_point`, `5_point`, `ambiguous`, `default`), `isAmbiguousRating`, and string/array tags.
   - Verified **Internal Candidates API (`GET /api/v1/internal/restaurants/candidates`)** returned HTTP `200` with `tags: string[]`, `rating_scale`, `is_ambiguous_rating`, and `average_cost` (`65000`, `90000`, `55000`, `50000`).
   - Verified **Live Planning -> Core -> AI (`POST http://127.0.0.1:8080/api/v1/itineraries/generate`)** returned HTTP `201`, Planning called Core (`candidates`) and AI (`POST http://ai-service:5000/routes/optimize` HTTP `200 OK`, `solver: "Gastronomic Progression Heuristic"`), returning 2 stops with contiguous 1-based `order_index: [1, 2]`, real candidate names, `estimated_cost: 65000 & 90000` (`total_cost: 155000`), and normalized string tags.
   - Cleaned up all 4 synthetic `restaurants` and the synthetic `itineraries` record (`restaurants=0`, `itineraries=0` restored; `mongo_test_data` volume untouched).

---

## 7. Remaining Risks & Final Verdict

- **Legacy Repo-Wide ESLint Debt:** Repo-wide `npm run lint` remains red on legacy `no-unsafe-*` / Prettier rules in pre-existing files; only isolated targeted `npx eslint` checks on M10.1 normalizer/contract/schema/spec files pass cleanly with zero warnings.
- **Ambiguous Historical Dataset Scores:** Any production/staging Atlas documents lacking `ratingScale`, Foody subscores, and `reviewsCount` while having `diemTrungBinh <= 5` will now surface `ratingScale: 'ambiguous'` and `isAmbiguousRating: true` rather than being mislabeled `'5_point'`; resolving their true provenance requires data backfill or Atlas snapshot audit (`BLK-11`).
- **Docker Local Empty Dataset State:** `gastro_core_test.restaurants` currently holds `0` persisted documents intentionally after test cleanup (`mongo_test_data` volume preserved).

### Verdict: **READY FOR PR (`fix/m10-1-restaurant-schema-rating-compatibility` -> `main`)**
