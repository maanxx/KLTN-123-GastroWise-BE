# M10.2.1 — ShopeeFood / Foody Ingestion Source & Schema Audit

- **Date:** 2026-11-28
- **Repository:** `maanxx/KLTN-123-GastroWise-BE`
- **Branch:** `feature/m10-2-controlled-data-ingestion` (from `main` @ `def470d`)
- **Scope:** Read-only source audit of existing scraper scripts, sample fixtures, Core schema, shared normalizers, and AI ingestion contracts ahead of implementing the M10.2 pipeline.

---

## 1. Existing Scraper Scripts & Captured Fixture Audit

| Artifact | Behavior Observed | Input / Output Format | Deficiencies / Unsafe Behavior Must Not Reuse |
|---|---|---|---|
| `crawl_shopeefood.py` | Stage 1 collects slugs via Selenium on 10 ShopeeFood category URLs; Stage 2 fetches `foody.vn/ho-chi-minh/{slug}` HTML and parses `var initData = {...};`; Stage 3 calls Foody `/__get/Review/ResLoadMore`; Stage 4 scrapes `.item-restaurant-row` menus via Selenium. | Extracts `restaurantId`, `tenQuan`, `diaChi`, `quan`, `khuVuc`, `thanhPho`, `diemTrungBinh`, `reviewsCount`, `lat`, `lon`, `giaMin`, `giaMax`, `priceRange`, `openingTime`, `cuisines`, `tags`, `slug`, `urlGoc`, `avatarUrl`, `contactPhone`. | **Destructive & non-aligned:** targets legacy `gastrowise` DB, executes `delete_many({})` on `restaurants`, `reviews`, and `menu_items`, omits GeoJSON `location`, uses `priceRange`/`openingTime` instead of `giaCa`/`gioMoCua`, drops Foody `AvgPointList` subscores and `ratingScale`, overwrites native `reviewsCount` with Foody `TotalReview`, and inserts raw 10-point Foody review ratings. |
| `crawl-data.js` | Puppeteer DOM scraper targeting `.item-restaurant` cards on `shopeefood.vn`, writing directly to `mongodb://localhost:27017/gastrowise` with Mongoose `{ strict: false }`. | Produces `tenQuan`, `diaChi`, `avatarUrl`, `diemTrungBinh`, `reviewsCount`, `tags`, `lat`, `lon`. | **Must be retired:** fabricates random ratings (`3.5–5.0`), fake `reviewsCount`, jittered District 1 coordinates, hardcoded `'Food Delivery, ShopeeFood'` tags, and runs `Restaurant.deleteMany({})`. |
| `probe_crawler.py` | Read-only HTTP probe against `foody.vn/__get/Delivery/GetDeliveryMenu` and `ResLoadMore` (`CreatedDate` `/Date(ms)/` format). | Diagnostic console output only. | Diagnostic only; demonstrates `/Date(ms)/` parsing. |
| `init_data_foody.json` | Captured Foody `initData` JSON fixture (363 lines, single restaurant sample `RestaurantID: 1000070216`). | Nested JSON with `RestaurantID`, `Name`, `Address`, `CityID`, `City`, `District`, `PriceMin`, `PriceMax`, `Latitude`, `Longtitude` *(typo in upstream)*, `AvgRating`, `TotalReview`, `AvgPointList` (5 subscore entries), `Cuisines`, `LstCategory`, `MetaKeywords`, `OpeningTime`, `PictureModel.ImageUrl`, `MobileImageUrl`, `MicrositeUrl`, `RestaurantUrl`, `ResUrlRewrite`, `IsActive`, `IsDelete`, `RestaurantStatus`. | Confirms real records may carry `AvgRating: 0.0`, `TotalReview: 0`, `PriceMin/PriceMax: 0.0`, `IsActive: false`, `RestaurantStatus: 2`, and relative paths (`MicrositeUrl: "/ho-chi-minh/..."`). |

---

## 2. Target Core Schema & Reusable Shared Utilities

- **Target Collection:** `gastro_core_test.restaurants` (Docker isolated testing) / `gastro_core.restaurants` (Atlas target strictly blocked in M10.2).
- **Schema (`apps/core-service/src/restaurants/schemas/restaurant.schema.ts`):**
  - Core string/numeric fields: `tenQuan`, `cityId` (indexed), `diemTrungBinh`, `diaChi`, `gioMoCua`, `giaCa`, `tags` (`Mixed`, formatted comma string via `formatRestaurantTagsString`), `lat`, `lon`, `location` (`null` or validated GeoJSON `{ type: 'Point', coordinates: [lon, lat] }` with `2dsphere` index), Foody subscores (`diemKhongGian`, `diemViTri`, `diemChatLuong`, `diemPhucVu`, `diemGiaCa`), `avatarUrl`, `urlGoc`, `slug` (indexed), `description`, `contactPhone`, `reviewsCount` (`default: 0`), `status` (`'open' | 'closed' | 'pending'`), `isVerified`, `isFeatured`.
- **Reusable Existing Utilities:**
  - `@shared/utils/geo.utils`: `parseValidCoordinatePair()`, `toGeoJsonPoint()` (rejects `[0,0]` and out-of-range coordinates without Q1 defaults).
  - `@shared/utils/restaurant-normalizer.util`: `normalizeRestaurantTags()`, `formatRestaurantTagsString()`, `normalizeRestaurantRating()`, `parseRestaurantPriceVnd()`.
  - `@shared/migrations`: `isRemoteOrAtlasMongoUri()`, `redactSensitiveString()` (fail-closed Atlas/remote URI detection and credential redaction).

---

## 3. Contract & Semantic Hazards Identified

1. **Foody `TotalReview` vs Core `reviewsCount` Collision:** Setting Core's `reviewsCount` to Foody's `TotalReview` causes `normalizeRestaurantRating()` and AI `detect_restaurant_rating_scale()` to infer `'5_point'` for Foody `<= 5.0` ratings. M10.2 must keep Core native `reviewsCount = 0` on newly ingested Foody records and store `TotalReview` separately as `foodyReviewsCount`, with explicit `ratingScale: '10_point'`, `rawRating`, `_ratingNormalized: true`, and extracted `AvgPointList` subscores.
2. **Coordinate Safety:** Upstream `Longtitude` typo (`init_data_foody.json:42`) vs `lon` (`crawl_shopeefood.py:183`) must both be accepted, validated strictly via `toGeoJsonPoint`, and coerced to `location: null` (never District 1) when invalid or `[0, 0]`.
3. **Zero Price / Zero Rating / Missing Hours:** Never fabricate `'50.000đ'`, `'08:00 - 22:00'`, or `3.0` rating when missing/zero in raw data; preserve empty values or explicit `rawRating: 0` with quality metrics (`rating_unrated_zero_count`, `missing_price_count`).
4. **Live Scraping Restriction:** Both `crawl-data.js` and live ShopeeFood endpoints are subject to anti-bot/Cloudflare gates; M10.2 operates strictly on captured local JSON/JSONL fixtures in dry-run-by-default mode against local/Docker `gastro_core_test`.
