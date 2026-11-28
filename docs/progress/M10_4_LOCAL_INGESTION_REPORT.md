# M10.4 — Controlled Local Restaurant Ingestion Report

- **Date:** 2026-11-28
- **Repository:** `maanxx/KLTN-123-GastroWise-BE`
- **Branch:** `feat/m10-4-controlled-local-ingestion` (branched from `main` @ `4529579` after PR #16 merge)
- **Scope:** Controlled local-only restaurant ingestion workflow reusing M10.2.1 safety guards and M10.3 data-quality validation against isolated `gastro_core_test`. No Atlas connections, production migrations/backfills, or real ShopeeFood scraping were executed.

---

## 1. Architecture & Execution Flow

```text
ShopeeFood JSON Fixture (scripts/ingestion/fixtures/m10_4_shopeefood_local_fixture.json)
  → CLI / executeControlledLocalIngestion()
  → Local Opt-In Guard (apply requires GASTROWISE_ALLOW_LOCAL_INGESTION=true)
  → Strict Local DB Guard (local host allowlist + database === "gastro_core_test" only)
  → Parse (parseRawIngestionInput)
  → Normalize & Validate (M10.3 validateAndNormalizeRestaurantRecord + recursive sanitizer)
  → Data Quality Report (buildDataQualityReport — intra-batch & DB candidate tracking)
  → [dry-run] Return preview summary (0 DB writes)
  → [apply] Write-Ahead Pending Ledger (ingestion_batches)
            → Raw Staging (restaurants_raw_staging)
            → Targeted Deduplication (limit + 1 overflow sentinel)
            → Safe Idempotent Bulk Upsert (restaurants — valid records only)
            → Applied Ledger → Structured IngestionBatchSummary
```

---

## 2. Files Changed

| File | Summary |
|---|---|
| `libs/shared/src/ingestion/ingestion.connection.ts` | Added `LOCAL_INGESTION_ALLOW_ENV_VAR` (`GASTROWISE_ALLOW_LOCAL_INGESTION`), `assertLocalIngestionApplyAllowed()`, and Docker `MONGO_HOST` local URI assembly (still strictly validated via `assertLocalIngestionTargetOnly()`). |
| `libs/shared/src/ingestion/ingestion.pipeline.ts` | Added `executeControlledLocalIngestion()` enforcing `dry-run` default, `GASTROWISE_ALLOW_LOCAL_INGESTION=true` before `apply`, and `resolveIngestionDatabaseConfig()`, reusing `runRestaurantIngestionPipeline()` without duplicating normalization or validation. |
| `libs/shared/src/ingestion/ingestion.cli.ts` & `scripts/ingestion/ingest.ts` | Added `--source=<source>` CLI option and enforced `assertLocalIngestionApplyAllowed(process.env)` before connecting in `--apply` mode. |
| `docker-compose.local-ingestion.yml` | Added optional loopback-only (`127.0.0.1:27018:27017`) Compose override exposing isolated `mongo-test` for host-side local CLI runs and forwarding `GASTROWISE_ALLOW_LOCAL_INGESTION`. |
| `scripts/ingestion/fixtures/m10_4_shopeefood_local_fixture.json` | Added synthetic/sanitized ShopeeFood fixture covering valid records, missing address/coords, invalid rating, invalid review count, malformed URL, duplicate candidate, and nested secret fields. |
| `libs/shared/src/ingestion/ingestion.local-apply.spec.ts` | Added automated test suite verifying dry-run zero-writes, apply opt-in guard, Atlas/remote/non-test DB rejections, fixture staging/apply, secret redaction, retry idempotency, user-owned preservation, and LIFO CAS rollback. |

---

## 3. Local Environment Setup & Docker Commands

### Start Isolated Local Stack (Docker Compose)

```bash
# Start isolated mongo-test (mongo:7.0, gastro_core_test) + core-service with loopback 127.0.0.1:27018 override
docker compose -f docker-compose.yml -f docker-compose.local-ingestion.yml up -d mongo-test core-service

# Verify container health and Core Service readiness
docker ps --filter "name=gastrowise-"
docker exec gastrowise-core-service wget -qO- http://127.0.0.1:3001/health/ready
```

### Required Environment Variables

| Variable | Required For | Value / Constraint |
|---|---|---|
| `MONGODB_URI_CORE` | Dry-run & Apply | Local single-host `mongodb://` URI targeting `/gastro_core_test` (e.g. `mongodb://gastro_core_svc:<local_test_pass>@127.0.0.1:27018/gastro_core_test?authSource=gastro_core_test`). Rejects `mongodb+srv://`, `mongodb.net`, remote hosts, and non-`gastro_core_test` DBs. |
| `CORE_DB_NAME` | Dry-run & Apply | Must equal `gastro_core_test` (or omitted to default to `gastro_core_test`). |
| `GASTROWISE_ALLOW_LOCAL_INGESTION` | **Apply mode only** | Must be explicitly set to `true` before `--apply` writes to `gastro_core_test`. |

---

## 4. Dry-Run & Local Apply Instructions

### Dry-Run Preview (Default — Zero Database Writes)

```bash
MONGODB_URI_CORE="mongodb://gastro_core_svc:<local_test_pass>@127.0.0.1:27018/gastro_core_test?authSource=gastro_core_test" \
CORE_DB_NAME="gastro_core_test" \
npx ts-node -r tsconfig-paths/register scripts/ingestion/ingest.ts \
  --file=scripts/ingestion/fixtures/m10_4_shopeefood_local_fixture.json \
  --source=shopeefood \
  --batch-id=m104-local-dryrun-1
```

### Controlled Local Apply (Requires Explicit Guard)

```bash
GASTROWISE_ALLOW_LOCAL_INGESTION=true \
MONGODB_URI_CORE="mongodb://gastro_core_svc:<local_test_pass>@127.0.0.1:27018/gastro_core_test?authSource=gastro_core_test" \
CORE_DB_NAME="gastro_core_test" \
npx ts-node -r tsconfig-paths/register scripts/ingestion/ingest.ts \
  --apply \
  --file=scripts/ingestion/fixtures/m10_4_shopeefood_local_fixture.json \
  --source=shopeefood \
  --batch-id=m104-local-apply-1
```

### Rollback a Local Batch (Compare-And-Set)

```bash
npx ts-node -r tsconfig-paths/register scripts/ingestion/ingest.ts \
  --rollback=m104-local-apply-1 --apply
```

---

## 5. Example Output Summary (`m10_4_shopeefood_local_fixture.json`)

```json
{
  "batchId": "m104-apply-batch-1",
  "mode": "apply",
  "source": "shopeefood",
  "targetDb": "gastro_core_test",
  "rawStagedCount": 7,
  "plannedInserts": 3,
  "plannedUpdates": 0,
  "duplicatesSkipped": 1,
  "metrics": {
    "raw_scraped_count": 7,
    "valid_record_count": 3,
    "inserted_count": 3,
    "matched_count": 0,
    "updated_count": 0,
    "rejected_count": 3,
    "duplicate_count": 1
  },
  "dataQualityReport": {
    "totalInputRecords": 7,
    "validRecords": 3,
    "rejectedRecords": 3,
    "duplicateCandidates": {
      "intraBatchCount": 1,
      "existingDbCandidateCount": 0,
      "confirmedDuplicatesCount": 0,
      "totalCandidateCount": 1
    },
    "overallQualityStatus": "FAILED"
  }
}
```

---

## 6. Actual Verification Results (Local vs. GitHub Actions CI)

All commands below were executed **locally** after the final code edits (in-memory mocks used in Jest suites; Docker Compose config and live container health verified against local `gastrowise-mongo-test` / `gastrowise-core-service` with zero Atlas connections):

| Check | Exit Code | Observed Result |
|---|---:|---|
| `npx eslint "libs/shared/src/ingestion/*.ts" scripts/ingestion/ingest.ts` | `0` | `0` errors, `0` warnings across all ingestion modules and CLI script. |
| `npx tsc -p tsconfig.build.json --noEmit` | `0` | `0` TypeScript errors. |
| `npm run build:all` | `0` | Built `core-service` and `planning-service` cleanly. |
| `npm run test:microservices` | `0` | **35 passed / 35 suites, 252 passed / 252 tests, 0 failed, 0 skipped.** |
| `git diff --check` | `0` | Zero whitespace errors or conflict markers. |
| `docker compose -f docker-compose.yml -f docker-compose.local-ingestion.yml config --quiet` | `0` | Valid Compose merge with `127.0.0.1:27018:27017` loopback binding. |
| `docker exec gastrowise-core-service wget -qO- http://127.0.0.1:3001/health/ready` | `0` | `{"status":"READY","service":"core-service","database":{"ready":true,"readyState":1,"readyStateLabel":"connected","dbPingOk":true,"latencyMs":1}}`. |

- **GitHub Actions CI:** Pending remote workflow execution once `feat/m10-4-controlled-local-ingestion` is pushed and PR is opened; not observed locally.

---

## 7. Remaining Limitations

- Live host-side CLI execution against `127.0.0.1:27018` requires restarting `mongo-test` with `-f docker-compose.local-ingestion.yml` (the already-running `gastrowise-mongo-test` container was started from base `docker-compose.yml` without the host port mapping, so full apply/retry/rollback tests ran in Jest via `LocalMockCollection` rather than recreating running containers).
- Standalone Docker `mongo:7.0` does not run as a replica set; cross-collection atomicity relies on write-ahead `'pending'` ledgers + `recoverIngestionBatch()`.
- Live Atlas/production ingestion remains strictly blocked by `assertLocalIngestionTargetOnly()` and `assertLocalIngestionApplyAllowed()`.
