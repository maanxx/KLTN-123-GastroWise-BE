# M10.8 — Food Data API Integration & Search Readiness

- **Repository:** `maanxx/KLTN-123-GastroWise-BE`
- **Branch:** `feat/m10-8-food-data-api-search` (branched from `origin/main` @ `b0ec51c`, which includes M10.7 PR #20)
- **OpenAPI Contract:** `docs/api/M10_5_RESTAURANT_DISH_OPENAPI.yaml`
- **Service Ownership:** Core Service (`gastro_core` / local `gastro_core_test`) exclusively owns `restaurants` and `menu_items`. Planning Service accesses Core data only via authenticated Core internal HTTP APIs (`/api/v1/internal/*`).

---

## 1. Implemented Endpoints & Authentication

| Method | Canonical Gateway Route | Legacy Rewrite | Auth | Purpose |
|---|---|---|---|---|
| `GET` | `/api/v1/restaurants` | `/restaurants` | Public | Paginated list, keyword search, location (`city`/`district`/`area`), `category`/`cuisine`/`tags`, price range, rating, status, sorting |
| `GET` | `/api/v1/restaurants/:id` | `/restaurants/:id` | Public | Restaurant detail by 24-hex ObjectId or slug (`400` invalid, `404` missing) |
| `GET` | `/api/v1/restaurants/:id/dishes` | `/restaurants/:id/dishes` | Public | Paginated dishes strictly scoped to a single restaurant (`400` invalid, `404` missing) |
| `GET` | `/api/v1/dishes` | `/dishes` | Public | Paginated dish search/list across restaurants with restaurant, price, category/tag, availability, and vegetarian filters |
| `GET` | `/api/v1/dishes/:id` | `/dishes/:id` | Public | Single dish detail by 24-hex ObjectId (`400` invalid, `404` missing) |
| `GET` | `/api/v1/restaurants/:id/menu` | `/restaurants/:id/menu` | Public (Deprecated) | Legacy array response (bounded to 200 items) with truncation & migration headers |
| `GET` | `/api/v1/restaurants/menu/all` | `/restaurants/menu/all` | Public (Deprecated) | Legacy Admin array response (bounded to 200 items) with truncation & migration headers |
| `POST/PATCH/DELETE` | Mutating restaurant/menu routes | — | JWT + `admin`/`owner` | Protected by `JwtAuthGuard` + `RolesGuard` |

---

## 2. Query Parameters & Validation Rules

All query DTOs are validated by NestJS global `ValidationPipe({ whitelist: true, transform: true })`.

### `GET /api/v1/restaurants` (`QueryRestaurantsDto`)
- **Pagination:** `page` (`1..1000`, default `1`), `limit` (`1..100`, default `32`).
- **Search & Location:** `search` (max 128 chars; hybrid AI semantic scores + MongoDB regex across `tenQuan`, `name`, `tags`, `cuisines`, `diaChi`, `address` with `2.5s` AI timeout), `city`, `district`, `area`.
- **Category / Cuisine / Tags:** `category`, `cuisine`, `tags` (max 128 chars each; regex-escaped).
- **Price / Rating / Status:** `minPrice` (`>= 0`), `maxPrice` (`>= 0`, rejects `minPrice > maxPrice` with `400`), `minRating` (`0..5`), `rating`, `status` (`open|closed|pending|all`), `openNow` (`true|false`).
- **Sorting:** `sortBy` (`diemTrungBinh|rating|price|diemKhongGian|diemViTri|diemChatLuong|diemPhucVu|diemGiaCa|distance|default`), `order` (`asc|desc`, default `desc`).

### `GET /api/v1/dishes` & `GET /api/v1/restaurants/:id/dishes` (`QueryDishesDto`)
- **Pagination:** `page` (`1..1000`, default `1`), `limit` (`1..100`, default `20`).
- **Search & Filters:** `search` (max 128 chars; name/description/tags), `restaurantId` (24-hex ObjectId or `all` on `/dishes`), `minPrice` (`>= 0`), `maxPrice` (`>= 0`, rejects `minPrice > maxPrice` with `400`), `category` & `tag` (explicit `AND` semantics on `MenuItem.tags`), `isAvailable` (`true|false`), `isVegetarian` (`true|false`).
- **Sorting:** `sortBy` (`price|isFeatured|createdAt|name`, default `isFeatured`), `order` (`asc|desc`, default `desc`).

---

## 3. Standardized Pagination & Response Format

Both restaurant and dish list endpoints return a standardized `meta` object alongside existing top-level fields for full Web/Admin/Mobile backward compatibility. DB queries apply explicit `.select(...)` projections excluding internal provenance fields (`ingestionBatchId`, `sourceMetadata`, `ownerId`, etc.).

```json
{
  "data": [
    {
      "id": "6b0a8f383a3d2737c73a8632",
      "_id": "6b0a8f383a3d2737c73a8632",
      "restaurantId": "6b0a8f389e583fdd0ef73e29",
      "restaurant": {
        "id": "6b0a8f389e583fdd0ef73e29",
        "tenQuan": "Cơm Tấm Ba Ghiền",
        "diaChi": "84 Đặng Văn Ngữ, Phường 10, Quận Phú Nhuận, TP. HCM",
        "lat": 10.7955,
        "lon": 106.6716,
        "location": { "type": "Point", "coordinates": [106.6716, 10.7955] }
      },
      "name": "Trà Đá Đường",
      "price": 10000,
      "isVegetarian": true,
      "tags": ["Đồ uống"],
      "isAvailable": true,
      "isFeatured": false
    }
  ],
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 6,
    "totalPages": 1
  },
  "total": 6,
  "page": 1,
  "limit": 10,
  "totalPages": 1
}
```

---

## 4. Database Indexes & Performance

- **`MenuItemSchema` (`menu_items`):**
  - Compound `{ restaurantId: 1, isAvailable: 1, price: 1 }` (covers restaurant dish listing, availability filtering, price-range queries, and single-field `restaurantId` lookups without duplicate indexes).
  - `{ tags: 1 }` (supports category/tag dish filtering).
  - `{ isFeatured: -1, createdAt: -1 }` (supports default dish sorting).
  - Partial unique `uniq_dish_external_source_id_partial` on `{ externalSource: 1, externalSourceId: 1 }` (`unique: true`, `$type: 'string'`).
- **Projection & N+1 Avoidance:** `findAll()`, `findDishes()`, and `findDishById()` use `.select(...)` to strip internal fields at the MongoDB query level and batch-populate `restaurantId` via Mongoose `.populate()` (no per-item N+1 queries).

---

## 5. Sample `curl` Commands (Web / Mobile Developers)

```bash
# 1. List restaurants through Nginx Gateway
curl -sS "http://127.0.0.1:8080/api/v1/restaurants?page=1&limit=10"

# 2. Search restaurants by keyword + district + category
curl -sS "http://127.0.0.1:8080/api/v1/restaurants?search=Ph%E1%BB%9F&district=Qu%E1%BA%ADn%203&category=M%C3%AC%20ph%E1%BB%9F"

# 3. Get restaurant detail by ID or slug
curl -sS "http://127.0.0.1:8080/api/v1/restaurants/6b0a8f389e583fdd0ef73e27"

# 4. List dishes sorted by price ascending
curl -sS "http://127.0.0.1:8080/api/v1/dishes?page=1&limit=10&sortBy=price&order=asc"

# 5. Search dishes by keyword and price range
curl -sS "http://127.0.0.1:8080/api/v1/dishes?search=B%C3%A1nh%20M%C3%AC&minPrice=40000&maxPrice=70000"

# 6. List dishes belonging strictly to one restaurant
curl -sS "http://127.0.0.1:8080/api/v1/restaurants/6b0a8f389e583fdd0ef73e27/dishes?page=1&limit=10"

# 7. Get single dish detail
curl -sS "http://127.0.0.1:8080/api/v1/dishes/6b0a8f383a3d2737c73a8632"

# 8. Legacy non-versioned Gateway rewrite (/dishes -> /api/v1/dishes)
curl -sS "http://127.0.0.1:8080/dishes?page=1&limit=2"
```

---

## 6. Local Testing & Observed Runtime Validation (`gastro_core_test`)

Never connect to MongoDB Atlas, never run remote migrations, and never execute `docker compose down -v`.

```bash
# Unit & integration tests + typecheck + build
npx tsc -p tsconfig.build.json --noEmit
npm run build:shared && npm run build:all
npm run test:microservices

# Local Docker validation (with gitignored .env.docker.local)
docker compose --env-file .env.docker.local config -q
docker compose --env-file .env.docker.local build core-service
docker compose --env-file .env.docker.local up -d core-service nginx-gateway
docker compose --env-file .env.docker.local ps
```

### Actual Live Observations (Client → Nginx Gateway `8080` → Core Service `3001` → Local `gastro_core_test`)
- `GET /api/v1/restaurants?page=1&limit=10` → `HTTP 200`, `meta: { page: 1, limit: 10, total: 3, totalPages: 1 }`, returned M10.7 dataset (`Phở Hòa Pasteur`, `Bánh Mì Huynh Hoa`, `Cơm Tấm Ba Ghiền`), `internalLeaked: false`.
- `GET /api/v1/restaurants?search=Phở&district=Quận 3&category=Mì phở` → `HTTP 200`, `total: 1` (`Phở Hòa Pasteur`).
- `GET /api/v1/dishes?page=1&limit=10&sortBy=price&order=asc` → `HTTP 200`, `meta: { page: 1, limit: 10, total: 6, totalPages: 1 }`, sorted `10000 → 95000` VND with populated restaurant info, `metadataLeaked: false`.
- `GET /api/v1/restaurants/6b0a8f389e583fdd0ef73e27/dishes?page=1&limit=10` → `HTTP 200`, `total: 2` (`Phở Tái Nạm`, `Phở Đặc Biệt Tô Lớn`), `allMatchRest: true`.
- `GET /api/v1/dishes?search=Bánh Mì&minPrice=40000&maxPrice=70000` → `HTTP 200`, `total: 2`.
- `GET /dishes?page=1&limit=2` → `HTTP 200`, `meta: { page: 1, limit: 2, total: 6, totalPages: 3 }`.
- `GET /api/v1/restaurants/bad!id` → `HTTP 400`; `GET /api/v1/dishes?limit=999` → `HTTP 400`; `GET /api/v1/itineraries` (unauth) → `HTTP 401`.

---

## 7. Known Limitations

- Restaurant price filtering/sorting parses string `giaCa` in memory (`MAX_MANUAL_SCAN_LIMIT = 500`, explicitly surfaced via `isBoundedResult`) because `Restaurant` stores `giaCa` as a formatted range string rather than numeric `priceMin`/`priceMax`.
- Full-repo ESLint remains advisory in CI due to pre-existing legacy `@typescript-eslint/no-unsafe-*` lint debt in untouched modules; all M10.8 DTO/schema/spec files pass ESLint with `0` errors.
