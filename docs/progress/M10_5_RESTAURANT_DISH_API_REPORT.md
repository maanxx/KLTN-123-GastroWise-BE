# M10.5 — Restaurant & Dish API Implementation Report

- **Date:** 2026-11-28
- **Repository:** `maanxx/KLTN-123-GastroWise-BE`
- **Branch:** `feat/m10-5-restaurant-dish-api` (branched from `main` @ `4529579`)
- **OpenAPI Spec:** `docs/api/M10_5_RESTAURANT_DISH_OPENAPI.yaml`

---

## 1. Phase 1 Architecture Audit Findings

- **Schemas Owned by Core Service (`gastro_core`):**
  - `Restaurant` (`restaurants`): `tenQuan`, `cityId`, `diemTrungBinh`, `diaChi`, `gioMoCua`, `giaCa`, `tags`, `lat`, `lon`, `location` (GeoJSON Point or `null`), Foody subscores, `avatarUrl`, `urlGoc`, `slug`, `description`, `contactPhone`, `reviewsCount`, `status` (`open | closed | pending`), `isVerified`, `isFeatured`, plus internal ingestion fields (`ingestionBatchId`, `ingestionRevision`, `ingestionPostDigest`, `normalizedNameAddressKey`, `ownerId`) excluded from public DTOs.
  - `MenuItem` (`menu_items`): `restaurantId`, `name`, `description`, `price`, `image`, `isVegetarian`, `calories`, `tags: string[]`, `isAvailable`, `isFeatured`. *(Note: `MenuItem` has no separate `category` field; `category`/`tag` query filters map directly onto `tags` without inventing unsupported schema fields.)*
- **Swagger / OpenAPI:** `@nestjs/swagger` is not installed in `package.json`; an OpenAPI 3.0.3 contract specification has been added at `docs/api/M10_5_RESTAURANT_DISH_OPENAPI.yaml`.
- **Gaps Closed in Existing `RestaurantsModule` (zero duplicate modules):**
  1. Added validated `QueryRestaurantsDto` (`page` `1..1000`, `limit` `1..100`, `district`/`area`, `cuisine`, `minPrice`/`maxPrice`, `minRating`, `status`, `sortBy=rating|price`), fixed `$or` filter collision between `rating` and `search`, escaped regex metacharacters, bounded manual scan (`MAX_MANUAL_SCAN_LIMIT = 500`), exposed `lon` alongside `lat`/`lng`/`location`, and enforced `400` on malformed restaurant IDs.
  2. Added `DishesController` (`GET /api/v1/dishes`, `GET /api/v1/dishes/:id`) and `GET /api/v1/restaurants/:id/dishes` using validated `QueryDishesDto`, bounded pagination, `400`/`404` handling, and `.limit(200)` bounds on legacy `getMenu`/`getAllMenuItems`.

---

## 2. Endpoint Contract & Sample `curl` Commands

| Method & Route | Auth | Purpose |
|---|---|---|
| `GET /api/v1/restaurants` | Public | Paginated list, keyword search, city/district/cuisine/price/rating/status filters, rating/price/distance sort, returns coordinates |
| `GET /api/v1/restaurants/:id` | Public | Restaurant detail by 24-hex ObjectId or slug (`400` invalid format, `404` missing) |
| `GET /api/v1/restaurants/:id/dishes` | Public | Paginated dishes belonging to a restaurant with search, price range, and tag/category filters |
| `GET /api/v1/dishes` | Public | Paginated dish search/list across restaurants with price range, tag/category, availability, and vegetarian filters |
| `GET /api/v1/dishes/:id` | Public | Single dish detail by 24-hex ObjectId (`400` invalid ObjectId, `404` missing) |

### Sample `curl` Requests

```bash
# 1. List restaurants (paginated, filtered by city, district, cuisine, price, minRating, sorted by price)
curl -s "http://localhost:8080/api/v1/restaurants?page=1&limit=10&city=hcmc&district=Qu%E1%BA%ADn%203&cuisine=Ph%E1%BB%9F&minPrice=40000&maxPrice=120000&minRating=4&status=open&sortBy=price&order=asc"

# 2. Get restaurant detail by ID or slug
curl -s "http://localhost:8080/api/v1/restaurants/674000000000000000000001"

# 3. List dishes for a restaurant
curl -s "http://localhost:8080/api/v1/restaurants/674000000000000000000001/dishes?page=1&limit=20&minPrice=50000&maxPrice=100000&isAvailable=true"

# 4. Search dishes across restaurants
curl -s "http://localhost:8080/api/v1/dishes?search=Ph%E1%BB%9F&category=Ph%E1%BB%9F&minPrice=40000&maxPrice=90000&sortBy=price&order=asc"

# 5. Get dish detail by ID
curl -s "http://localhost:8080/api/v1/dishes/674000000000000000000010"
```

---

## 3. Files Changed

- `apps/core-service/src/restaurants/dto/query-restaurants.dto.ts` *(new)*
- `apps/core-service/src/restaurants/dto/query-dishes.dto.ts` *(new)*
- `apps/core-service/src/restaurants/dishes.controller.ts` *(new)*
- `apps/core-service/src/restaurants/restaurants.module.ts`
- `apps/core-service/src/restaurants/restaurants.controller.ts`
- `apps/core-service/src/restaurants/restaurants.service.ts`
- `apps/core-service/src/restaurants/restaurants-dish-api.spec.ts` *(new)*
- `docs/api/M10_5_RESTAURANT_DISH_OPENAPI.yaml` *(new)*
- `docs/progress/M10_5_RESTAURANT_DISH_API_REPORT.md` *(new)*

---

## 4. Actual Verification Results (Local vs. GitHub Actions CI)

| Check | Exit Code | Observed Result (Local — M10.5.1) |
|---|---:|---|
| `npx eslint apps/core-service/src/restaurants/dto/query-restaurants.dto.ts apps/core-service/src/restaurants/dto/query-dishes.dto.ts apps/core-service/src/restaurants/dishes.controller.ts apps/core-service/src/restaurants/restaurants.module.ts apps/core-service/src/restaurants/restaurants-dish-api.spec.ts` | `0` | `0` errors, `0` warnings. |
| `npx tsc -p tsconfig.build.json --noEmit` | `0` | `0` TypeScript errors. |
| `npm run build:all` | `0` | Built `core-service` and `planning-service` cleanly. |
| `npm run test:microservices` | `0` | **35 passed / 35 suites, 258 passed / 258 tests, 0 failed, 0 skipped.** |
| `git diff --check` | `0` | Zero whitespace errors or conflict markers. |

- **GitHub Actions CI:** Pending remote workflow execution after pushing the M10.5.1 commit to PR #18 (`feat/m10-5-restaurant-dish-api`); not observed locally.

---

## 5. M10.5.1 Hardening Summary

### 5.1 Root Cause Analysis & Before/After Behavior

1. **Restaurant Pagination Correctness (`RestaurantsService.findAll()`):**
   - **Root Cause:** When manual in-memory processing was triggered (`openNow=true`, `sortBy=distance`, `isAiSearch=true`, `minPrice`/`maxPrice`, or `sortBy=price`), `findAll()` fetched at most `MAX_MANUAL_SCAN_LIMIT = 500` records without comparing against `countDocuments(filterQuery)`, silently reporting `total` and `totalPages` as if the 500-document window were the complete dataset.
   - **Before:** Datasets with `> 500` matching restaurants returned `total <= 500` with no truncation signal.
   - **After:**
     - Standard DB-side queries (`page`, `limit`, `city`, `district`/`area`, `cuisine`, `search`, `minRating`, `status`, `sortBy=rating`) run full DB-side `countDocuments` + `.sort().skip().limit()` and return exact `total`, `totalPages`, and `isBoundedResult: false`.
     - Manual-processing queries run `countDocuments(filterQuery)` alongside `.sort(sortOptions).limit(MAX_MANUAL_SCAN_LIMIT + 1).lean().exec()` to detect truncation (`fetchedCandidates.length > 500 || rawMatchingTotal > 500`).
     - When truncated, the response explicitly exposes `isBoundedResult: true`, `evaluatedWindowLimit: 500`, and `totalMatchingBeforePostFilter: <exact DB count>` (and preserves exact DB `total` when no in-memory post-filter such as `openNow`/`minPrice`/`maxPrice`/`isAiSearch` is active).

2. **Combined Dish Filters (`RestaurantsService.findDishes()`):**
   - **Root Cause:** Both `category` and `tag` wrote directly to `filterQuery.tags`, causing `tag` to overwrite `category` when both query parameters were supplied together.
   - **Before:** `GET /api/v1/dishes?category=Món chính&tag=Phở` silently dropped `category=Món chính`.
   - **After:** All dish filters (`restaurantId`, `price`, `category`, `tag`, `isAvailable`, `isVegetarian`, `search`) are composed inside an explicit `$and` array with escaped case-insensitive regexes, ensuring `category` AND `tag` apply simultaneously alongside `search`, price bounds, availability, and vegetarian flags.

3. **Validation, Response Compatibility & Schema Index Audit:**
   - Verified `apps/core-service/src/main.ts` registers global `ValidationPipe({ whitelist: true, transform: true })`.
   - Verified `400` on invalid ObjectIds / `minPrice > maxPrice` / invalid query params, `404` on missing resources, `lat`/`lon`/`lng`/GeoJSON `location` compatibility, and exclusion of internal ingestion fields (`ingestionBatchId`, `ingestionRevision`, `ingestionPostDigest`, `normalizedNameAddressKey`, `ownerId`).
   - **Index Audit (no unreviewed schema/index mutations performed):**
     - `RestaurantSchema` already defines `location: '2dsphere'`, `{ status: 1, diemTrungBinh: -1 }`, `{ tenQuan: 'text', tags: 'text' }`, `cityId: 1`, plus sparse ingestion indexes (`slug`, `urlGoc`, `tenQuan+diaChi`, `normalizedNameAddressKey`, `ingestionBatchId`).
     - `MenuItemSchema` (`apps/core-service/src/restaurants/schemas/menu-item.schema.ts`) currently has **no explicit secondary indexes** (`restaurantId`, `price`, `tags`, `isAvailable`). Follow-up reviewed migration recommended: `{ restaurantId: 1, isAvailable: 1, price: 1 }` and `{ tags: 1 }`.

### 5.2 Local-Only MongoDB Runtime Validation Instructions

To validate the hardened endpoints end-to-end against a **local** MongoDB instance (`gastro_core_test`, never Atlas/production):

```bash
# 1. Start local MongoDB + Core Service (local Docker Compose only)
docker compose -f docker-compose.yml up -d mongo-test core-service

# 2. Seed local test database using controlled M10.4 ingestion (gastro_core_test only)
GASTROWISE_ALLOW_LOCAL_INGESTION=true \
MONGO_URI="mongodb://127.0.0.1:27017/gastro_core_test" \
npm run ingestion:local -- --file=fixtures/ingestion/shopeefood.sample.json --apply

# 3. Verify combined dish filters & restaurant pagination via HTTP
curl -s "http://localhost:3001/api/v1/restaurants?page=1&limit=10&sortBy=rating&order=desc"
curl -s "http://localhost:3001/api/v1/restaurants?page=1&limit=10&minPrice=40000&maxPrice=120000"
curl -s "http://localhost:3001/api/v1/dishes?category=M%C3%B3n%20ch%C3%ADnh&tag=Ph%E1%BB%9F&minPrice=40000&maxPrice=90000&isAvailable=true"
```

---

## 6. Known Limitations

- Price filtering/sorting on `Restaurant` parses formatted Vietnamese string `giaCa` in memory (`parseRestaurantPriceVnd`, bounded to `MAX_MANUAL_SCAN_LIMIT = 500` with explicit `isBoundedResult` metadata) because `Restaurant` stores `giaCa` as a string rather than indexed numeric `priceMin`/`priceMax` fields.
- `MenuItemSchema` does not yet have explicit secondary indexes on `restaurantId`, `price`, `tags`, or `isAvailable`; adding them requires a reviewed index migration.
- Jest verification uses mocked Mongoose models rather than a live local MongoDB runtime HTTP test.
- `@nestjs/swagger` interactive `/docs` runtime UI is not enabled because `@nestjs/swagger` is not in `package.json`; OpenAPI 3.0.3 documentation is maintained in `docs/api/M10_5_RESTAURANT_DISH_OPENAPI.yaml`.
- Pre-existing `@typescript-eslint/no-unsafe-*` lint errors remain in untouched legacy sections of `restaurants.controller.ts` and `restaurants.service.ts`.
