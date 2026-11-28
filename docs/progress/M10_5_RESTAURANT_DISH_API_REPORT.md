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

| Check | Exit Code | Observed Result (Local) |
|---|---:|---|
| `npx eslint apps/core-service/src/restaurants/dto/query-restaurants.dto.ts apps/core-service/src/restaurants/dto/query-dishes.dto.ts apps/core-service/src/restaurants/dishes.controller.ts apps/core-service/src/restaurants/restaurants.module.ts apps/core-service/src/restaurants/restaurants-dish-api.spec.ts` | `0` | `0` errors, `0` warnings. |
| `npx tsc -p tsconfig.build.json --noEmit` | `0` | `0` TypeScript errors. |
| `npm run build:all` | `0` | Built `core-service` and `planning-service` cleanly. |
| `npm run test:microservices` | `0` | **35 passed / 35 suites, 255 passed / 255 tests, 0 failed, 0 skipped.** |
| `git diff --check` | `0` | Zero whitespace errors or conflict markers. |

- **GitHub Actions CI:** Pending remote workflow execution once `feat/m10-5-restaurant-dish-api` is pushed and PR is opened; not observed locally.

---

## 5. Known Limitations

- Price filtering/sorting on `Restaurant` parses formatted Vietnamese string `giaCa` in memory (`parseRestaurantPriceVnd`, bounded to `MAX_MANUAL_SCAN_LIMIT = 500`) because `Restaurant` stores `giaCa` as a string rather than indexed numeric `priceMin`/`priceMax` fields.
- `@nestjs/swagger` interactive `/docs` runtime UI is not enabled because `@nestjs/swagger` is not in `package.json`; OpenAPI 3.0.3 documentation is maintained in `docs/api/M10_5_RESTAURANT_DISH_OPENAPI.yaml`.
- Pre-existing `@typescript-eslint/no-unsafe-*` lint errors remain in untouched legacy sections of `restaurants.controller.ts` and `restaurants.service.ts`.
