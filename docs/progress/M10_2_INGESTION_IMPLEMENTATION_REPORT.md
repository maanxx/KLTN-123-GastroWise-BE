# M10.2 — Controlled ShopeeFood Restaurant Data Ingestion Implementation Report

- **Date:** 2026-11-28
- **Repository:** `maanxx/KLTN-123-GastroWise-BE`
- **Branch:** `feature/m10-2-controlled-data-ingestion` (from `main` @ `def470d`)
- **Audit Report Prerequisite:** `docs/progress/M10_2_1_INGESTION_SOURCE_AUDIT.md`
- **Environment Scope:** Local workspace + isolated Docker Compose (`gastrowise-mongo-test` / `gastro_core_test`, `gastrowise-core-service`). **Atlas targets unconditionally blocked in M10.2.**

---

## 1. Architecture & Data Flow Implemented

```text
Raw JSON / JSONL Fixture (scripts/ingestion/fixtures/sample_shopeefood_raw.json)
   │
   ▼ [1] Raw Staging Layer (libs/shared/src/ingestion/ingestion.staging.ts)
   ├─ Compute SHA-256 batch checksum + unique batchId (`ingest_<UTC>_<sha8>`)
   ├─ Preserve verbatim original payload, source, sourceId, sourceUrl, scrapedAt
   └─ Upsert idempotently into `restaurants_raw_staging` (only in `--apply` mode)
   │
   ▼ [2] Validation & Normalization (libs/shared/src/ingestion/ingestion.normalizer.ts)
   ├─ Reject missing `RestaurantID`/`externalSourceId`, missing `Name`/`tenQuan`, `IsDelete: true`, malformed records
   ├─ Map Foody/ShopeeFood fields to Core schema (`tenQuan`, `diaChi`, `cityId`, `lat`/`lon`/GeoJSON `location`,
   │  `giaCa`, `gioMoCua`, deduplicated `tags`, validated `avatarUrl`, `urlGoc`, `slug`, `AvgPointList` subscores)
   ├─ Separate `TotalReview` -> `foodyReviewsCount` (keep native `reviewsCount = 0` on inserts)
   ├─ Normalize 10-pt Foody scores cleanly; flag ambiguous `[0, 5]` ratings without provenance (`ratingScale: 'ambiguous'`)
   └─ Never fabricate coordinates (`location: null`), prices (`''`), opening hours (`''`), or missing scores
   │
   ▼ [3] Deterministic Deduplication & Safe Upsert (libs/shared/src/ingestion/ingestion.pipeline.ts)
   ├─ Intra-batch + DB matching order: (1) `(externalSource, externalSourceId)`, (2) canonical `slug`/`urlGoc`, (3) normalized `(tenQuan, diaChi)`
   ├─ Preserve user-owned fields (`ownerId`, native `reviewsCount`, `isVerified`, `isFeatured`, `createdAt`, user-reviewed ratings)
   ├─ Record pre-update backups + inserted IDs in `ingestion_batches` ledger
   └─ Execute single `bulkWrite` (or 0 DB writes in default `--dry-run`)
   │
   ▼ [4] Quality Report & Safe LIFO Rollback
   ├─ Output all 13 required metrics + structured `validationErrors` + `warnings`
   └─ `--rollback=<batchId>` deletes only batch-inserted records without `ownerId`/`reviewsCount > 0` and restores updated docs
```

---

## 2. Implemented Files

| File | Responsibility |
|---|---|
| `libs/shared/src/ingestion/ingestion.types.ts` | Strongly typed staging, normalization, metrics, ledger, rollback, and error definitions. |
| `libs/shared/src/ingestion/ingestion.connection.ts` | Unconditional Atlas/remote URI blocker (`assertLocalIngestionTargetOnly`) using `@shared/migrations` URI parser + credential redaction. |
| `libs/shared/src/ingestion/ingestion.staging.ts` | JSON/JSONL parser, SHA-256 batch checksum generator, staging document builder, and idempotent `restaurants_raw_staging` writer. |
| `libs/shared/src/ingestion/ingestion.normalizer.ts` | Field-level Foody/ShopeeFood validation, subscore extraction, coordinate validation, price/hours/tag normalization, and explicit rating-scale tagging. |
| `libs/shared/src/ingestion/ingestion.pipeline.ts` | 3-tier deduplication, user-field-preserving `bulkWrite`, 13-metric quality reporting, `ingestion_batches` ledger, and LIFO rollback engine. |
| `libs/shared/src/ingestion/ingestion.cli.ts` | Dry-run-by-default CLI parser blocking `--allow-atlas` and inline URI/credential flags. |
| `libs/shared/src/ingestion/index.ts` | Module barrel exported via `libs/shared/src/index.ts`. |
| `libs/shared/src/ingestion/ingestion.pipeline.spec.ts` | Comprehensive unit & stateful DB regression suite (all 13 Phase 6 scenarios). |
| `scripts/ingestion/ingest.ts` & `package.json` | Executable CLI entrypoint (`npm run ingest:restaurants`). |
| `scripts/ingestion/fixtures/sample_shopeefood_raw.json` | 7-record Foody/ShopeeFood fixture exercising valid, null-island GPS, zero-price, 10-pt/5-pt/ambiguous ratings, duplicate ID/name+address, and invalid missing-name cases. |
| `docs/progress/samples/m10_2_sample_validation_report.json` | Real dry-run output generated against isolated `gastro_core_test`. |
| `docs/progress/M10_2_1_INGESTION_SOURCE_AUDIT.md` | Phase 1 repository & scraper audit. |

---

## 3. Operational Commands (Local / Isolated Docker `gastro_core_test` Only)

> Environment variables required locally (never pass `--uri` or `--password` flags):
> `MONGODB_URI_CORE="mongodb://<local-user>:<local-pass>@mongo-test:27017/gastro_core_test?authSource=gastro_core_test"`
> `CORE_DB_NAME="gastro_core_test"`

1. **Dry-Run (Default Mode — Zero Database Writes):**
   ```bash
   npm run ingest:restaurants -- \
     --file=scripts/ingestion/fixtures/sample_shopeefood_raw.json \
     --report-out=docs/progress/samples/m10_2_sample_validation_report.json
   ```
   *(Or explicitly pass `--dry-run`; passing `--allow-atlas` or remote URIs fails immediately.)*

2. **Explicit Local Apply (Writes to `restaurants_raw_staging`, `restaurants`, and `ingestion_batches`):**
   ```bash
   npm run ingest:restaurants -- \
     --file=scripts/ingestion/fixtures/sample_shopeefood_raw.json \
     --batch-id=m10_2_local_batch_01 \
     --apply
   ```

3. **Rollback Instructions (LIFO Order — Preview First, Then Apply):**
   - Always preview rollback first (dry-run by default):
     ```bash
     npm run ingest:restaurants -- --rollback=m10_2_local_batch_01
     ```
   - Apply rollback (roll back newer batches first if multiple batches updated the same documents):
     ```bash
     npm run ingest:restaurants -- --rollback=m10_2_local_batch_01 --apply
     ```
   - Rollback safety rules:
     - Never deletes records that subsequently gained an `ownerId` or native `reviewsCount > 0`.
     - Restores updated catalog fields back to the exact `previousFields` recorded in `ingestion_batches`.

---

## 4. Verification Evidence (Actual Observed Results)

### Static Checks & Full Jest Suite
- `npm run build:all` -> **Exit 0** (`core-service` and `planning-service` built cleanly)
- `npx tsc -p tsconfig.build.json --noEmit` -> **Exit 0**
- `npx eslint "libs/shared/src/ingestion/*.ts" scripts/ingestion/ingest.ts` -> **Exit 0** (**0 errors, 0 warnings**)
- `git diff --check` -> **Exit 0**
- `npm run test:microservices` (`jest libs/ apps/`):
  - **33 passed / 33 total suites, 209 passed / 209 total tests, 0 failures, 0 skipped.**

### Live Isolated Docker MongoDB (`gastrowise-mongo-test`) & Core API Integration
Executed real `scripts/ingestion/ingest.ts` CLI inside isolated Docker network `kltn-123-gastrowise-be_gastrowise_network` against `gastro_core_test` (`mongo-test:27017`):
1. **Dry-Run (`m10_2_sample_dryrun_v1`):**
   - Output metrics (`docs/progress/samples/m10_2_sample_validation_report.json`):
     `raw_scraped_count=7`, `valid_record_count=4`, `inserted_count=0`, `updated_count=0`, `rejected_count=1` (`MISSING_NAME`), `duplicate_count=2`, `invalid_or_missing_coords_count=1`, `rating_10pt_explicit_count=1`, `rating_unrated_zero_count=1`, `rating_ambiguous_count=1`, `missing_tags_count=1`, `missing_price_count=2`, `missing_address_count=1`, `rawStagedCount=0`.
   - Verified `restaurants`, `restaurants_raw_staging`, `ingestion_batches` counts unchanged (`0, 0, 0`).
2. **Apply Batch 1 (`m10_2_docker_apply_1`) + User-Field Preservation:**
   - Pre-seeded user-owned document (`1163155`, `ownerId`, `reviewsCount: 12`, `diemTrungBinh: 4.9`, `isVerified: true`, `isFeatured: true`) and an unrelated document.
   - Apply staged `7` raw documents, inserted `3` new documents, updated `1` (`1163155`), enriched catalog `giaCa` / `foodyReviewsCount`, and **preserved** `ownerId`, `reviewsCount: 12`, `diemTrungBinh: 4.9`, `isVerified`, and `isFeatured`.
3. **Core Public REST API Check (`GET http://127.0.0.1:8080/api/v1/restaurants?limit=20`):**
   - Returned HTTP `200`; ingested ambiguous document exposed `ratingScale: "ambiguous"` and `isAmbiguousRating: true` cleanly.
4. **Idempotent Repeat Apply (`m10_2_docker_apply_2`):**
   - Returned `inserted_count=0`, `updated_count=4`; collection size stayed strictly constant.
5. **LIFO Rollback & Baseline Cleanup:**
   - Rolled back `m10_2_docker_apply_2` then previewed + rolled back `m10_2_docker_apply_1` (`deletedInsertedCount=3`, `restoredUpdatedCount=1`); unrelated document intact; final post-test isolated DB state restored to `restaurants=0`, `raw_staging=0`, `batches=0` (`mongo_test_data` volume preserved; **zero Atlas access**).

---

## 5. Known Limitations & Remaining Blockers

- **Atlas Blocked by Design in M10.2:** `assertLocalIngestionTargetOnly()` blocks any remote or `mongodb+srv://` URI unconditionally; Atlas ingestion stays disabled until staging snapshot profiling (`BLK-11`) and historical `V005` backfill are completed.
- **LIFO Rollback Ordering Across Overlapping Batches:** If two consecutive batches update the same newly inserted records, rolling back the older batch directly skips records whose `ingestionBatchId` now points to the newer batch until the newer batch is rolled back first.
- **Unresolved External Blockers:** `BLK-11` (Atlas staging audit), `ISSUE-12` (legacy `thienthien` DB user revocation), AI startup-only catalog loading lifecycle (AI service requires reload/restart after new Core DB ingestion), and live ShopeeFood anti-bot/Cloudflare restrictions.
