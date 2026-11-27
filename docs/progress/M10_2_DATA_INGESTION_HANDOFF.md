# M10.2 Technical Handoff — Controlled ShopeeFood Restaurant Data Ingestion Pipeline

- **Prepared By:** M10.1 / M10.1.1 Backend Compatibility & Audit Stream
- **Target PR:** `fix/m10-1-restaurant-schema-rating-compatibility` $\rightarrow$ `main`
- **Next Milestone Scope (Design Only — Do Not Implement in M10.1.2):** Controlled pipeline:
  `ShopeeFood scraped data -> Raw staging -> Validation -> Normalization -> Deduplication -> MongoDB (gastro_core) -> Core API -> AI recommendation`

---

## 1. Inspected Source Artifacts & Current Deficiencies

Inspection of the workspace scraper and data artifacts in `KLTN-123-GastroWise-BE` revealed:

| Artifact | Purpose / Current Behavior | Critical Deficiencies Blocking Direct Production Use |
|---|---|---|
| `crawl_shopeefood.py` | 4-stage crawler: Selenium ShopeeFood category URLs $\rightarrow$ `foody.vn` HTML `var initData = {...};` regex JSON parse $\rightarrow$ Foody `ResLoadMore` reviews API $\rightarrow$ ShopeeFood DOM `.item-restaurant-row` menus. | 1. Targets legacy DB `gastrowise` (`MONGODB_URI`, default localhost) and executes destructive `delete_many({})` on `restaurants`, `reviews`, and `menu_items`.<br>2. Emits `priceRange`/`openingTime` instead of schema fields `giaCa`/`gioMoCua`, omits GeoJSON `location`, drops Foody `AvgPointList` subscores, and omits explicit `ratingScale: '10_point'`.<br>3. Stage 3 scrapes 10-point Foody `AvgRating` reviews (`reviewsCount` collision) and uses non-ObjectId Foody user IDs. |
| `crawl-data.js` | Legacy Puppeteer DOM scraper (`mongodb://localhost:27017/gastrowise`, `strict: false`). | Fabricates synthetic ratings (`3.5–5.0`), fake `reviewsCount`, jittered District 1 GPS coords, hardcoded `'Food Delivery, ShopeeFood'` tags, and runs `Restaurant.deleteMany({})`. **Must be retired/never run against shared DBs.** |
| `probe_crawler.py` | API probe script for Foody `/__get/Delivery/GetDeliveryMenu` and `/__get/Review/ResLoadMore` (`/Date(ms)/` parser). | Diagnostic script only; confirms upstream Foody `/Date(ms)/` timestamps and menu/review JSON shapes. |
| `init_data_foody.json` | Captured Foody `initData` JSON sample (363 lines). | Documents real upstream fields including `RestaurantID`, `Name`, `Address`, `District`, `CityID`, `City`, `Latitude`, `Longtitude` *(upstream spelling)*, `PriceMin`, `PriceMax`, `AvgRating`, `TotalReview`, `AvgPointList` (5 subscores), `Cuisines`, `LstCategory`, `MetaKeywords`, `OpeningTime`, `MicrositeUrl`, `ResUrlRewrite`, `PictureModel.ImageUrl`, `IsActive`, `IsDelete`, `RestaurantStatus`. Shows real records can have `AvgRating: 0.0`, `PriceMin/Max: 0.0`, `IsActive: false`. |

---

## 2. Target Schema & Contract Alignment

Ingested restaurant documents land in Core's `restaurants` collection (`gastro_core` / `gastro_core_test`, owner: Core Service) and must satisfy:

- **Core Mongoose Schema (`apps/core-service/src/restaurants/schemas/restaurant.schema.ts`):**
  - Core fields: `tenQuan`, `diaChi`, `cityId`, `diemTrungBinh`, `giaCa`, `gioMoCua`, `tags` (`Mixed` formatted string via `formatRestaurantTagsString`), `lat`, `lon`, `location` (`null` or validated GeoJSON `{ type: 'Point', coordinates: [lon, lat] }`, non-`[0,0]`), `diemKhongGian`, `diemViTri`, `diemChatLuong`, `diemPhucVu`, `diemGiaCa`, `avatarUrl`, `urlGoc`, `slug`, `contactPhone`, `reviewsCount`, `status` (`'open' | 'closed' | 'pending'`), `isVerified`, `isFeatured`.
  - Recommended metadata preservation fields for ingestion provenance: `externalSource` (`'foody_shopeefood'`), `externalSourceId` (`String(RestaurantID)`), `rawRating`, `ratingScale` (`'10_point'` / `'5_point'` / `'ambiguous'`), `_ratingNormalized`, `ingestedAt`, `ingestionBatchId`.
- **AI MongoDB Loader (`KLTN-123-GastroWise-AI/app/db/mongo.py`):**
  - Reads from `gastro_core.restaurants` (`gastro_core_test.restaurants` in Docker), rejects missing `_id`/`id` or empty `tenQuan`/`name`, deduplicates by `id` and `(tenQuan.lower(), diaChi.lower())`, reads GeoJSON `location.coordinates` `[lon, lat]` or flat `lat`/`lon`, normalizes ratings via `detect_restaurant_rating_scale()` (prioritizing `ratingScale`/`raw_rating_scale` + `diemChatLuong`/`diemViTri`/etc.), parses `giaCa`/`price`/`avgPrice` via `clean_price()`, and joins `tags` for TF-IDF vectorization.
- **Core Internal & Planning Contracts (`libs/shared/src/contracts/core.contracts.ts`, `apps/planning-service`):**
  - Core `/api/v1/internal/restaurants/candidates` emits `tags: string[]`, normalized `rating`, `raw_rating`, `rating_scale`, `is_ambiguous_rating`, and `average_cost` parsed by `parseRestaurantPriceVnd(...)`.

---

## 3. Proposed M10.2 Pipeline Rules (Design Specification)

### A. Stage 1 — Raw Staging
- Persist raw crawler snapshots into versioned JSONL/JSON files (external to repo secrets, checksummed SHA-256) or a dedicated staging collection (`restaurants_raw_staging`) tagged with `batchId`, `scrapedAt`, `sourceUrl`, without touching `restaurants`.
- Filter/flag inactive or deleted upstream rows (`IsDelete === true` or `IsActive === false` / closed status metadata) rather than silently publishing dead listings.

### B. Stage 2 — Field Mapping & Normalization Rules

| Upstream Foody / `crawl_shopeefood.py` Field | Target `restaurants` Field | Normalization Rule |
|---|---|---|
| `RestaurantID` | `externalSourceId` (+ `externalSource: 'foody_shopeefood'`) | Cast non-empty string for idempotent upsert & traceability. |
| `Name` (`tenQuan`) | `tenQuan` | Trim whitespace; reject record if empty. |
| `Address` (`diaChi`), `District`, `City` | `diaChi`, `cityId` | Normalize whitespace; derive canonical `cityId` (`hcmc` for `CityID === 217` / TP.HCM). |
| `Latitude`, `Longtitude` (`lat`, `lon`) | `lat`, `lon`, `location` | Validate via `toGeoJsonPoint(lat, lon)`. Reject `[0,0]` / out-of-bounds (`lat` outside `[-90, 90]`, `lon` outside `[-180, 180]`) $\rightarrow$ set `lat: undefined`, `lon: undefined`, `location: null` (never default to Q1). |
| `AvgRating` (`diemTrungBinh`) & `AvgPointList` | `diemTrungBinh`, `rawRating`, `ratingScale`, `_ratingNormalized`, + 5 Foody subscores | Map `AvgPointList` labels (`Vị trí` $\rightarrow$ `diemViTri`, `Giá cả` $\rightarrow$ `diemGiaCa`, `Chất lượng` $\rightarrow$ `diemChatLuong`, `Phục vụ` $\rightarrow$ `diemPhucVu`, `Không gian` $\rightarrow$ `diemKhongGian`). Record `ratingScale: '10_point'`, `rawRating`, and store normalized `[0, 5]` (or explicit `10_point` metadata if keeping raw) consistently so Core & AI never misclassify `0..5` Foody scores (`TotalReview > 0` upstream Foody count must **not** overwrite Core's GastroWise user `reviewsCount` semantics!). |
| `TotalReview` vs Core `reviewsCount` | `foodyReviewsCount` (new) / `reviewsCount: 0` | **Important:** Keep GastroWise native `reviewsCount` = `0` for imported Foody rows so `normalizeRestaurantRating` & `detect_restaurant_rating_scale` do not mistake Foody's `TotalReview > 0` for GastroWise 5-star user reviews! |
| `PriceMin`, `PriceMax` | `giaCa` | If positive, format `"65.000đ"` / `"30.000đ - 150.000đ"`; if `0.0`/missing, store empty/null (`parseRestaurantPriceVnd` handles fallback safely without storing misleading `"0đ"`). |
| `OpeningTime[0]` | `gioMoCua` | Format `"HH:MM - HH:MM"` (`"08:00 - 22:00"` default only when absent at runtime if desired, or empty + tracked in metrics). |
| `Cuisines`, `LstCategory`, `MetaKeywords`, crawl category `tags` | `tags` | Deduplicate and format cleanly via `formatRestaurantTagsString(...)` (avoid storing `'Eating'`, duplicates, or arrays bypassing sanitization). |
| `MicrositeUrl` / `ResUrlRewrite` | `urlGoc`, `slug` | Normalize canonical path/URL and slug (`slug` non-empty URL-safe). |
| `PictureModel.ImageUrl` / `MobileImageUrl` | `avatarUrl` | Validate HTTP(S) URL; drop broken relative paths. |

### C. Invalid / Missing Data Handling & Error Reporting
- Emit a structured JSON validation report per batch (`ingestion_batches` ledger or local artifact report):
  - **Hard Rejections (quarantined, not inserted into `restaurants`):** missing/empty `Name`, missing `RestaurantID` AND `slug`/`urlGoc`, malformed non-object payload.
  - **Soft Quarantine / Flagged Records (inserted only under explicit policy or held for enrichment):** missing/invalid GPS (`coords_valid: false`, stored with `location: null` if allowed cleanly, excluded from `$geoNear` and Planning routes), missing `PriceMin/PriceMax`, missing `tags`, `AvgRating == 0`, or inactive (`IsActive == false` / `IsDelete == true`).

### D. Deduplication Strategy
1. **Intra-batch & DB Upsert Key Hierarchy (deterministic):**
   - **Tier 1 (Exact external identity):** `(externalSource, externalSourceId)` when `RestaurantID` present.
   - **Tier 2 (Canonical source slug / URL):** normalized `slug` or `urlGoc`.
   - **Tier 3 (AI-aligned fuzzy/natural fallback):** normalized `(lowercase trimmed tenQuan, lowercase trimmed diaChi)`.
2. Merge policy on conflict: preserve existing GastroWise user-contributed fields (`ownerId`, native `reviewsCount`, `isVerified`, `isFeatured`, native user-recalculated `diemTrungBinh` when `reviewsCount > 0`) while updating catalog metadata (`gioMoCua`, `giaCa`, `location`, `tags`, `avatarUrl`). **Never execute `deleteMany({})`.**

### E. Safe Import, Fail-Closed Guards & Rollback Strategy
- Reuse existing M9.1–M9.7.2 safety architecture (`scripts/migrations/` + `libs/shared/src/database/mongo-uri.util.ts`):
  - **Fail-closed Atlas guard:** Require `--dry-run` first; block `mongodb+srv://` / `mongodb.net` targets unless explicit authorization flags are provided; enforce credential redaction in all logs.
  - **Batch-tagged idempotent bulkWrite:** Every upserted document carries `ingestionBatchId` (or rollback snapshot metadata capturing prior values for modified docs + inserted `_id` list) enabling targeted batch rollback (`deleteMany({ ingestionBatchId, reviewsCount: 0, ownerId: { $exists: false } })` + restore modified docs) without disturbing user-owned data.
  - **Pre-import & Post-import Checks:** Target Docker `mongo-test` (`gastro_core_test`) first for parity validation (`Core /api/v1/restaurants`, `Core /internal/restaurants/candidates`, `AI GET /` dataset summary) before any staging/Atlas rollout.

### F. Required Dataset Quality Metrics
Every ingestion run must output metrics matching Core + AI `mongo.py` validation expectations:
- `raw_scraped_count`, `valid_upserted_count`, `inserted_count`, `updated_count`
- `rejected_count` (breakdown by missing name / missing identifier / inactive)
- `duplicates_skipped_or_merged`
- `coords_valid_count` / `invalid_or_missing_coords_count`
- `rating_10pt_explicit_count` / `rating_unrated_zero_count` / `rating_ambiguous_count` (target `0` for newly ingested records because `ratingScale` must always be populated!)
- `missing_tags_count`, `missing_price_count`, `missing_address_count`
- Post-ingestion Core & AI parity delta (`Core count == AI loaded_count + AI expected rejects`).

---

## 4. Open Blockers & Dependencies Before Running M10.2 Against Staging/Atlas

1. **Upstream Scraper Anti-Bot & Access Limits:** `crawl-data.js` explicitly notes Cloudflare/CAPTCHA/DOM fragility on `shopeefood.vn`; automated runtime scraping should respect target access controls or ingest pre-collected/sanctioned raw JSON datasets rather than bypassing anti-bot gates.
2. **`BLK-11` (HIGH — Unresolved):** Live Atlas staging snapshot audit (`docs/database/M8_3_STAGING_READINESS_CHECKLIST.md`, `docs/database/M9_5_STAGING_AUDIT_PLAN.md`) has not yet been executed; existing production collection anomaly counts and duplicate keys must be profiled before any production import.
3. **`V005` Rating Scale Backfill Migration:** Existing Atlas `restaurants` documents lacking `ratingScale` and subscores (`ratingScale: 'ambiguous'` on `0..5`) still require a historical backfill/audit migration.
4. **`ISSUE-12` (Atlas DBA):** Legacy `thienthien` database user removal on MongoDB Atlas console remains pending.
5. **AI Catalog Refresh Lifecycle:** Currently `ai-service` (`app/db/mongo.py`) loads `gastro_core.restaurants` into pandas/TF-IDF at startup (`main.py`); ingesting new restaurants into `gastro_core` requires triggering/restarting or adding a controlled AI catalog reload endpoint so AI recommendations reflect newly ingested data without downtime.
