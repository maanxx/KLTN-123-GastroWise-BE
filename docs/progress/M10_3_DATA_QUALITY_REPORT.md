# M10.3 — Restaurant Data Quality & Ingestion Readiness Report

- **Date:** 2026-11-28
- **Repository:** `maanxx/KLTN-123-GastroWise-BE`
- **Branch:** `feat/m10-3-restaurant-data-quality` (branched from `main` @ `de7b398` after PR #15 merge)
- **Scope:** Canonical restaurant data contract, deterministic normalization, 3-tier validation (`error` / `warning` / `info`), structured `DataQualityReport`, dry-run Core Service API extension, and automated tests. No Atlas connections, production backfills, or live scraping were executed.

---

## 1. Architecture Audit Findings

- **Existing Ingestion Layer (`libs/shared/src/ingestion/`):**
  - `ingestion.staging.ts` (`parseRawIngestionInput`, `buildRawStagingDocuments`) and `ingestion.pipeline.ts` (`runRestaurantIngestionPipeline`) already enforce dry-run-by-default, `restaurants_raw_staging` raw payload preservation, write-ahead `'pending'` ledgers, CAS rollback, and `limit + 1` dedup overflow protection.
  - `ingestion.normalizer.ts` reused `@shared/utils/geo.utils` (`toGeoJsonPoint`) and `@shared/utils/restaurant-normalizer.util` (`normalizeRestaurantRating`, `normalizeRestaurantTags`) without duplicating core geo/rating/tag helpers.
  - **Gaps Identified:**
    1. `ValidationSeverity` lacked `'info'` level and `originalValue` diagnostics.
    2. Out-of-range/non-numeric ratings, negative/non-numeric review counts, malformed HTTP/HTTPS URLs, and unsupported `externalSource` values were either dropped silently or not rejected cleanly.
    3. Phone numbers, whitespace/Unicode text, incomplete addresses, and `images[]` lacked deterministic normalization and `rawPreserved` provenance snapshots.
    4. No standalone `DataQualityReport` or Admin API endpoint existed to preview validation status, rejected samples, missing/invalid field counts, and duplicate candidates prior to ingestion.
- **Core Service APIs (`apps/core-service/src/restaurants/`):**
  - `RestaurantsController` exposed CRUD, geo nearby search, recommendations, and AI search, with no existing data-quality validation route. Added `POST /restaurants/data-quality/validate` (`@Roles('admin')`, dry-run only) without altering any existing Web, Admin, or Mobile API contracts.

---

## 2. Files Changed

| File | Summary |
|---|---|
| `libs/shared/src/ingestion/ingestion.types.ts` | Added `'info'` severity, `originalValue`, `SUPPORTED_INGESTION_SOURCES`, `PreservedRawRestaurantFields`, `images`, `DataQualityStatus`, `DuplicateCandidateEntry`, `RejectedRecordSample`, `ErrorCodeGroupSummary`, `DataQualityReport`, and optional `dataQualityReport` on `IngestionBatchSummary`. |
| `libs/shared/src/ingestion/ingestion.normalizer.ts` | Added `normalizeDisplayText()`, `normalizePhoneNumber()`, `extractImages()`, explicit validation for `UNSUPPORTED_SOURCE_FORMAT`, `INVALID_RATING`, `INVALID_REVIEW_COUNT`, `MALFORMED_URL`, `MALFORMED_IMAGE_URL`, `INCOMPLETE_ADDRESS`, `INVALID_PHONE_NUMBER`, `'info'` diagnostics (`RATING_NORMALIZED_10_TO_5`, `SOURCE_URL_DERIVED_FROM_SLUG`), and `rawPreserved` snapshot. |
| `libs/shared/src/ingestion/ingestion.data-quality.ts` | Added `evaluateRestaurantDataQuality()` (in-memory, zero DB writes) and `buildDataQualityReport()` shared with `runRestaurantIngestionPipeline()`. |
| `libs/shared/src/ingestion/ingestion.pipeline.ts` | Populated `dataQualityReport` on both `dry-run` and `apply` `IngestionBatchSummary` outputs, tracking `intra_batch` and `existing_db_candidate` entries separately from `confirmedDuplicatesCount: 0`. |
| `libs/shared/src/ingestion/index.ts` | Exported `./ingestion.data-quality`. |
| `apps/core-service/src/restaurants/dto/validate-restaurant-data-quality.dto.ts` | Added DTO for `POST /restaurants/data-quality/validate`. |
| `apps/core-service/src/restaurants/restaurants.service.ts` & `restaurants.controller.ts` | Added Admin-only dry-run `POST /restaurants/data-quality/validate` endpoint returning `validationStatus`, `validatedRestaurants`, `rejectedRecords`, `fieldErrors`, `warnings`, `infos`, and `dataQualitySummary`. |
| `libs/shared/src/ingestion/ingestion.data-quality.spec.ts` & `apps/core-service/src/restaurants/restaurants.controller.spec.ts` | Added unit & pipeline integration tests covering valid normalization, rejections, warnings, duplicate candidates, mixed datasets, dry-run safety, rejection before `restaurants` writes, and controller delegation. |

---

## 3. Canonical Data Contract

- **Required Fields (Error if missing/invalid):**
  - `externalSourceId` (`RestaurantID` / `restaurantId` / `externalSourceId`)
  - `tenQuan` (`Name` / `tenQuan` / `name`)
  - `externalSource` (defaults to `'foody_shopeefood'`; must belong to `SUPPORTED_INGESTION_SOURCES = ['foody_shopeefood', 'shopeefood', 'foody', 'partner_csv', 'gastrowise']`)
  - `IsDelete !== true`
- **Optional Normalized Fields (Never fabricated when absent):**
  - `diaChi`, `cityId`, `lat`, `lon`, `location` (GeoJSON `Point` or `null`), `coordsValid`
  - `diemTrungBinh`, `rawRating`, `ratingScale` (`'10_point' | '5_point' | 'ambiguous' | 'default'`), `_ratingNormalized`, Foody subscores (`diemKhongGian`, `diemViTri`, `diemChatLuong`, `diemPhucVu`, `diemGiaCa`)
  - `foodyReviewsCount` (strictly isolated from native `reviewsCount` unless explicit Foody provenance is present)
  - `giaCa`, `gioMoCua`, `tags`, `avatarUrl`, `images`, `urlGoc`, `slug`, `contactPhone`, `status`
- **Preserved Raw Provenance:** `candidate.rawPreserved` stores original `name`, `address`, `phone`, `url`, `avatarUrl`, `rating`, `reviewCount`, and `sourceMetadata` (`CityID`, `City`, `District`, `crawlerSource`, `RestaurantStatus`, `IsActive`).

---

## 4. Normalization Rules

- **Names & Addresses:** NFC Unicode normalization, control-character removal, repeated whitespace collapse, and trimming; original strings retained in `rawPreserved`.
- **Phone Numbers:** Strips whitespace, dots, hyphens, and parentheses; converts `+84` Vietnamese 9–10 digit numbers to `0...` local format; validates `^\+?\d{7,15}$` (invalid values emit `INVALID_PHONE_NUMBER` warning and omit `contactPhone`).
- **URLs & Images:** Accepts `http://` / `https://` URLs and Foody relative paths (`/ho-chi-minh/...`); rejects unsafe schemes (`javascript:`, `ftp:`, etc.) or whitespace in source URLs with `MALFORMED_URL`; deduplicates `images[]` from `PictureModel`, `MobileImageUrl`, `avatarUrl`, and `images`.
- **Coordinates:** Reuses `toGeoJsonPoint()` (accepting Foody's `Longtitude` typo alongside `lon`/`lng`, rejecting `[0, 0]` and out-of-bounds coordinates -> `location: null`).
- **Ratings & Review Counts:** Reuses `normalizeRestaurantRating()` (10-point Foody -> `[0, 5]`; flags `[0, 5]` without explicit metadata as `ratingScale: 'ambiguous'`). Rejects non-numeric or out-of-range ratings (`INVALID_RATING`) and negative/non-numeric review counts (`INVALID_REVIEW_COUNT`).
- **Tags & Empty/Null Values:** Reuses `normalizeRestaurantTags()` with case-insensitive deduplication; treats `null`, `undefined`, and `''` as unset without inventing defaults.

---

## 5. Validation Rules & Error Codes

| Severity | Error Code | Trigger Condition |
|---|---|---|
| `error` | `MALFORMED_RECORD` | Non-object payload or unparseable JSONL line |
| `error` | `UNSUPPORTED_SOURCE_FORMAT` | `externalSource` outside `SUPPORTED_INGESTION_SOURCES` |
| `error` | `MISSING_EXTERNAL_ID` | Missing `RestaurantID` / `externalSourceId` |
| `error` | `MISSING_NAME` | Missing `Name` / `tenQuan` |
| `error` | `DELETED_UPSTREAM_RECORD` | `IsDelete === true` |
| `error` | `INVALID_RATING` | Non-numeric rating, `< 0`, `> 10`, or `> 5` on explicit `5_point` scale |
| `error` | `INVALID_REVIEW_COUNT` | Non-numeric or `< 0` review count |
| `error` | `MALFORMED_URL` | Non-HTTP(S) / unsafe scheme or unparseable `MicrositeUrl`/`urlGoc` |
| `warning` | `MISSING_ADDRESS` / `INCOMPLETE_ADDRESS` | Missing `diaChi` or `< 5` chars / lacks alphanumeric characters |
| `warning` | `INVALID_OR_MISSING_COORDINATES` | Missing, `[0, 0]`, or out-of-bounds WGS84 coordinates |
| `warning` | `MISSING_RATING` / `AMBIGUOUS_RATING_SCALE` | Absent rating or `[0, 5]` rating without scale metadata |
| `warning` | `MISSING_OR_ZERO_PRICE` / `MISSING_TAGS` | Missing/`0` price range or empty tags |
| `warning` | `MALFORMED_IMAGE_URL` / `INVALID_PHONE_NUMBER` | Invalid `avatarUrl` or malformed phone string |
| `warning` | `DUPLICATE_CANDIDATE_IN_BATCH` / `DUPLICATE_IN_BATCH` | Intra-batch Tier 1–4 match (flagged, never auto-deleted) |
| `info` | `RATING_NORMALIZED_10_TO_5` | 10-point rating scaled to 5-point |
| `info` | `SOURCE_URL_DERIVED_FROM_SLUG` | `urlGoc` derived from `ResUrlRewrite`/`slug` |

---

## 6. Example Validation Report (`DataQualityReport`)

```json
{
  "totalInputRecords": 4,
  "validRecords": 2,
  "rejectedRecords": 1,
  "warningRecords": 2,
  "infoRecords": 2,
  "duplicateCandidates": {
    "intraBatchCount": 1,
    "existingDbCandidateCount": 0,
    "confirmedDuplicatesCount": 0,
    "totalCandidateCount": 1,
    "note": "Duplicate candidates are flagged for review or upsert matching only; confirmed duplicates require human review and existing records are never auto-deleted or merged.",
    "samples": [
      {
        "recordIndex": 2,
        "externalSource": "foody_shopeefood",
        "externalSourceId": "1001",
        "tenQuan": "Phở Phú Vương",
        "matchType": "intra_batch"
      }
    ]
  },
  "missingFieldCounts": { "PriceMin/PriceMax": 1 },
  "invalidFieldCounts": { "AvgRating": 1 },
  "issuesByErrorCode": [
    { "errorCode": "RATING_NORMALIZED_10_TO_5", "severity": "info", "count": 2 },
    { "errorCode": "INVALID_RATING", "severity": "error", "count": 1 }
  ],
  "rejectedSample": [
    {
      "recordIndex": 3,
      "sourceId": "bad-1",
      "errors": [
        {
          "recordIndex": 3,
          "field": "AvgRating",
          "errorCode": "INVALID_RATING",
          "reason": "Rating must be a finite number within [0, 10].",
          "severity": "error",
          "sourceId": "bad-1",
          "originalValue": 99
        }
      ],
      "rawPreview": { "RestaurantID": "bad-1", "Name": "Quán Lỗi", "AvgRating": 99 }
    }
  ],
  "overallQualityStatus": "FAILED"
}
```

---

## 7. Local Verification Results vs. GitHub Actions CI

All checks below ran **locally** after the final code edits (in-memory database mocks used in unit/pipeline specs; no Atlas or production connections):

| Command | Exit Code | Observed Result |
|---|---:|---|
| `npx eslint "libs/shared/src/ingestion/*.ts" apps/core-service/src/restaurants/dto/validate-restaurant-data-quality.dto.ts apps/core-service/src/restaurants/restaurants.controller.spec.ts` | `0` | `0` errors, `0` warnings across all ingestion & new API DTO/spec files. |
| `npm run build:all` | `0` | Built `core-service` and `planning-service` cleanly. |
| `npx tsc -p tsconfig.build.json --noEmit` | `0` | `0` TypeScript errors. |
| `npm run test:microservices` | `0` | **34 passed / 34 suites, 237 passed / 237 tests, 0 failed, 0 skipped.** |
| `git diff --check` | `0` | Zero whitespace errors or conflict markers. |

- **GitHub Actions CI:** Pending remote workflow execution upon pushing `feat/m10-3-restaurant-data-quality` and opening the PR; not observed locally.

---

## 8. Known Limitations & Follow-Up Recommendations

- `POST /restaurants/data-quality/validate` performs pure in-memory evaluation (`existingDbCandidateCount` is `0` on the stateless validation endpoint; full DB candidate matching runs inside `runRestaurantIngestionPipeline()`).
- Pre-existing `@typescript-eslint/no-unsafe-*` lint issues remain in untouched legacy sections of `apps/core-service/src/restaurants/restaurants.controller.ts` and `restaurants.service.ts` outside M10.3 scope.
- **Follow-up:** Wire Web/Admin UI preview tables to `POST /restaurants/data-quality/validate`, and complete staging Atlas snapshot audit (`BLK-11`) before any real ingestion approval.
