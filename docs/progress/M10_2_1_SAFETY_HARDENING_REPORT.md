# M10.2.1 — Ingestion Safety Hardening & Recovery Report

- **Date:** 2026-11-28
- **Repository:** `maanxx/KLTN-123-GastroWise-BE`
- **Branch:** `fix/m10-2-1-ingestion-safety-hardening` (from `main` @ `ac4ef11`)
- **Related Prior Report:** `docs/progress/M10_2_INGESTION_IMPLEMENTATION_REPORT.md`

---

## 1. Files Changed

| File | Summary of Hardening Changes |
|---|---|
| `libs/shared/src/ingestion/ingestion.types.ts` | Added `APPROVED_INGESTION_DB_NAME`, `'recover'`, `'preflight-indexes'`, and `'ensure-indexes'` modes, 5-state batch lifecycle (`pending`, `applied`, `failed`, `rolled_back`, `recovery_required`), `matched_count` metric, `postIngestionDigest` & protected-field snapshots, `IngestionRollbackConflict`, `IngestionRecoveryResult`, `ExternalSourceDuplicateGroup`, and `IngestionIndexPreflightReport`. |
| `libs/shared/src/ingestion/ingestion.connection.ts` | Replaced basic remote check with strict structural `mongodb://` parser, explicit host allowlist, mandatory `/gastro_core_test` URI path validation, `CORE_DB_NAME` equality check, forbidden DB blocklist, and `authSource` validation. |
| `libs/shared/src/ingestion/ingestion.normalizer.ts` | Restricted `foodyReviewsCount` fallback so native `reviewsCount` is never mapped unless explicit provenance (`_reviewsCountIsFoodySource === true` or `crawlerSource === 'crawl_shopeefood'`) is provided. |
| `libs/shared/src/ingestion/ingestion.pipeline.ts` | Replaced unbounded `find({}).toArray()` with chunked targeted `$or` queries (`fetchTargetedMatchingRestaurants`) using a `limit(chunkLimit + 1)` overflow sentinel (aborting with `IngestionValidationError` before any writes if exceeded); fixed `updated_count` (`modifiedCount`) vs `matched_count`; enforced `batchId` uniqueness; added write-ahead `'pending'` ledger persistence + `'failed'`/`'recovery_required'` handling; added `recoverIngestionBatch()`; upgraded `rollbackIngestionBatch()` to compare-and-set verification with structured conflicts. |
| `libs/shared/src/ingestion/ingestion.index-preflight.ts` | Added non-destructive `preflightExternalSourceUniqueIndex(db)` aggregation audit and fail-closed `rolloutIngestionIndexes(db, { dryRun })` that refuses to create `uniq_external_source_id_partial` when duplicate `(externalSource, externalSourceId)` groups exist. |
| `libs/shared/src/ingestion/ingestion.cli.ts` & `scripts/ingestion/ingest.ts` | Added `--recover=<batchId>`, `--recover-action=auto\|complete\|compensate`, `--preflight-indexes` (read-only), and `--ensure-indexes` (dry-run by default; requires `--apply` after clean preflight). |
| `apps/core-service/src/restaurants/schemas/restaurant.schema.ts` | Declared ingestion provenance/revision/digest/normalized-key fields and aligned dedup/rollback lookup indexes while removing unsafe boot-time `unique: true` on `(externalSource, externalSourceId)` so partial unique index creation happens only via controlled post-preflight rollout. |
| `libs/shared/src/ingestion/ingestion.pipeline.spec.ts` | Added regression & fault-injection suites covering DB guard rejections, `foodyReviewsCount` provenance, indexed dedup filters, `limit + 1` cursor overflow detection (boundary pass + fail-before-writes), `matched_count` vs `updated_count`, `deleteOne` & `updateOne` CAS race checks, missing docs, LIFO overlap ordering, crash recovery, index preflight duplicate reporting, dry-run/apply rollout blocking, CLI index flags, and schema non-auto-unique assertion. |
| `docs/progress/samples/m10_2_sample_validation_report.json` | Updated dry-run output against `gastro_core_test` (`matched_count: 0` included). |
| `docs/progress/M10_2_INGESTION_IMPLEMENTATION_REPORT.md` | Updated pipeline flow, rollback conflict protection, and recovery CLI instructions. |

---

## 2. Safety Issues Found & Fixed

| # | Defect / Risk Found in M10.2 (`ac4ef11`) | Impact Before Fix | Fix Implemented in M10.2.1 |
|---|---|---|---|
| 1 | `ingestion.connection.ts` relied only on `isRemoteOrAtlasMongoUri()` without checking URI DB path or matching `CORE_DB_NAME`. | Could accept `mongodb://localhost:27017/gastro_core`, unapproved non-dotted hostnames (`prod-mongo`), or conflicting `CORE_DB_NAME` vs URI DB path. | Enforced explicit host allowlist (`localhost`, `127.0.0.1`, `::1`, `[::1]`, `mongo-test`, `gastrowise-mongo-test`), mandatory `/gastro_core_test` URI path matching `CORE_DB_NAME`, and explicit rejection of `gastro_core`, `gastrowise`, multi-host clusters, `mongodb+srv://`, and mismatched configs. |
| 2 | `rollbackIngestionBatch()` matched only `{ _id: backup.docId }` without checking post-ingestion state. | Could overwrite changes made after ingestion (manual edits, user interactions, or overlapping batches). | Recorded deterministic `postIngestionDigest` + `expectedPostUpdatedAt` + protected field state; verified pre-rollback digest & atomic CAS filter; returns structured `IngestionRollbackConflict` instead of overwriting/deleting changed docs. |
| 3 | `runRestaurantIngestionPipeline()` wrote to `restaurants` before creating batch ledger and silently upserted `ingestion_batches` (`upsert: true`). | Crashes after `bulkWrite` left un-tracked writes; reusing an existing `batchId` could overwrite prior rollback snapshots. | Rejects existing `batchId` reuse upfront; writes `status: 'pending'` ledger BEFORE mutating `restaurants`; transitions failures cleanly to `'failed'` or `'recovery_required'`; provides `recoverIngestionBatch()`. |
| 4 | Deduplication called `restaurantsCol.find({}).toArray()` (unbounded scan), initial targeted lookup used an unindexed `$regex` on `tenQuan` alone and `externalSourceId: { $in }`, and bounded `.limit(chunkLimit)` risked silent truncation on crowded legacy datasets. | Full-collection scan, broad city-wide `tenQuan` hits, or silently truncated dedup result sets causing missed matches and duplicate inserts. | Replaced with index-aligned predicates (`(externalSource, externalSourceId)` compound pairs, `{ slug: { $in } }`, `{ urlGoc: { $in } }`, `{ normalizedNameAddressKey: { $in } }`, and compound `{ tenQuan, diaChi }` pairs) plus `.limit(chunkLimit + 1)` overflow detection that aborts with `IngestionValidationError` before any staging, ledger, or restaurant writes occur. |
| 5 | `metrics.updated_count` read `bulkResult.matchedCount`. | Reported unchanged matched documents as modified updates. | Added `metrics.matched_count = bulkResult.matchedCount` and set `metrics.updated_count = bulkResult.modifiedCount`. |
| 6 | `ingestion.normalizer.ts` unconditionally fell back from `TotalReview` to `payload.reviewsCount`. | Could misclassify native GastroWise `reviewsCount` as `foodyReviewsCount`. | Restricted `payload.reviewsCount` fallback strictly to explicit Foody provenance markers (`_reviewsCountIsFoodySource === true` or `crawlerSource === 'crawl_shopeefood'`). |
| 7 | `RestaurantSchema` declared `unique: true` directly on `{ externalSource: 1, externalSourceId: 1 }`. | Mongoose runtime `autoIndex` on startup would fail (E11000) if legacy duplicate `(externalSource, externalSourceId)` pairs existed. | Removed boot-time `unique: true` from `RestaurantSchema` while keeping non-unique lookup index metadata; introduced non-destructive `preflightExternalSourceUniqueIndex()` and fail-closed `rolloutIngestionIndexes()` to inspect collisions and remediate manually before creating `uniq_external_source_id_partial`. |

---

## 3. Database Guard Behavior

- **Allowed Targets:** Only `mongodb://` single-host URIs targeting one of `{ localhost, 127.0.0.1, ::1, [::1], mongo-test, gastrowise-mongo-test }` with explicit URI path `/gastro_core_test`, matching `CORE_DB_NAME` (defaulting to `'gastro_core_test'` only when `CORE_DB_NAME` is unset; rejecting empty `CORE_DB_NAME=""`), and `authSource` either omitted, `'gastro_core_test'`, or `'admin'`.
- **Rejected Targets (Fail-Closed):** Empty/missing URIs, `mongodb+srv://` URIs, multi-host cluster URIs, unapproved hostnames (`prod-mongo`, `*.mongodb.net`, IPs), missing `/db` URI segments, forbidden DB names (`gastro_core`, `gastrowise`, `gastro_planning`, `gastro_planning_test`, `admin`, `local`, `config`, `test`), URI-vs-`CORE_DB_NAME` mismatches, unapproved `authSource`, and CLI inline flags (`--uri`, `--connection`, `--password`, `--allow-atlas`). Credentials in error strings are redacted via `redactSensitiveString()`.

---

## 4. Rollback Conflict Behavior & Overlapping Batch Ordering

- Every inserted and updated record stores a canonical SHA-256 `postIngestionDigest` over tracked catalog/batch/protected fields alongside `expectedPostUpdatedAt`.
- Before deleting an inserted record or restoring an updated record, rollback reads current DB state and checks:
  1. **Missing Document:** Returned safely in `conflicts` with `reasonCode: 'DOCUMENT_MISSING'` and `missingDocumentsCount += 1` (no exception thrown).
  2. **User/System Protection:** If `ownerId`, `reviewsCount`, `isVerified`, or `isFeatured` changed (or an inserted doc acquired any of them), returns `USER_OWNED_MODIFIED` conflict and refuses modification.
  3. **Overlapping Batches (LIFO Required):** If `currentDoc.ingestionBatchId !== ledger.batchId`, returns `OVERLAPPING_BATCH_CONFLICT` cleanly without altering newer batch state. Overlapping batches **must** be rolled back in reverse (LIFO) chronological order (`Batch N`, then `Batch N-1`, ...).
  4. **Post-Batch Content Drift, Revision & Atomic Field CAS:** Every ingestion insert initializes `ingestionRevision: 1` and updates increment `ingestionRevision` alongside `ingestionPostDigest` (`SHA-256` of tracked catalog/batch/protected fields). Before executing `deleteOne` or `updateOne`, rollback builds `buildAtomicCasFilter()` enforcing `ingestionBatchId`, `ingestionRevision`, `ingestionPostDigest`, `updatedAt`, explicit protected-field conditions (`ownerId: { $exists: false }` or exact ID, `$or` on `reviewsCount: 0` / `isVerified: false` / `isFeatured: false` when originally unset/false), **plus** exact field-level equality across all tracked catalog fields so any concurrent write (even legacy untracked `$set` between pre-check and final write) fails cleanly with `CAS_WRITE_MISMATCH`.
- **Idempotence:** Docs already handled in `rolledBackDocIds` are skipped cleanly if a partial-conflict batch is retried; once all records succeed without blocking conflicts, ledger becomes `'rolled_back'` and repeat calls return `status: 'already_rolled_back'` with 0 mutations.

---

## 5. Batch Recovery Lifecycle & Standalone MongoDB Limitation

```text
  [No Ledger] --(apply start)--> [pending] --(bulkWrite OK + ledger OK)--> [applied] --(CAS rollback)--> [rolled_back]
                                    │                                           ▲
                    ┌───────────────┴───────────────┐                           │
            (0 writes landed)              (>=1 writes or finalize fail)        │
                    ▼                               ▼                           │
                 [failed]                 [recovery_required] ──(--recover)─────┘ (complete if all landed)
                    │                               │
                    └───────(--recover compensate)──┴──────────────────────────► [rolled_back]
```

- **Standalone MongoDB Limitation:** Local/Docker test MongoDB (`mongo:7.0` standalone daemon) does not run as a replica set, so multi-document ACID transactions are unavailable. Crash safety is instead provided by persisting the `'pending'` ledger with full rollback snapshots before mutating `restaurants`, detecting landed writes deterministically during `recoverIngestionBatch()`, and either promoting an already-completed batch (`'completed_pending_apply'`) or compensating partial writes (`'compensated_partial_writes'`) via CAS.

---

## 6. Deduplication Completeness & Safe Index Rollout

- **Dedup Overflow Sentinel (`limit + 1`):** `fetchTargetedMatchingRestaurants()` computes `chunkLimit = chunk.length * resultsPerChunkFactor` (default factor `4`, customizable via `options.maxDedupResultsPerChunkFactor`), queries `.limit(chunkLimit + 1)`, and throws `IngestionValidationError` whenever `docs.length > chunkLimit`. Because dedup executes prior to raw-staging and `'pending'` ledger persistence, an overflow aborts cleanly with zero writes to `restaurants`, `restaurants_raw_staging`, or `ingestion_batches`.
- **Safe Partial Unique Index Rollout (`uniq_external_source_id_partial`):**
  1. **No unsafe boot-time `unique: true`:** `RestaurantSchema` keeps `{ externalSource: 1, externalSourceId: 1 }` as a non-unique lookup index so Core Service startup cannot crash if legacy collections still contain duplicate source IDs.
  2. **Non-destructive Preflight (`--preflight-indexes`):** `preflightExternalSourceUniqueIndex(db)` aggregates `{ externalSource: { $type: 'string' }, externalSourceId: { $type: 'string' } }` groups with `count > 1`, reporting affected `docIds`, `names`, and step-by-step remediation instructions without deleting or merging any documents.
  3. **Controlled Index Creation (`--ensure-indexes` / `--ensure-indexes --apply`):** `rolloutIngestionIndexes(db, { dryRun })` refuses index creation with `IngestionValidationError` citing offending `(externalSource, externalSourceId)` pairs and `docIds` if `duplicateGroupCount > 0`. Only when `duplicateGroupCount === 0` and `--apply` is passed does it create `uniq_external_source_id_partial` (`unique: true`, `partialFilterExpression: { externalSource: { $type: 'string' }, externalSourceId: { $type: 'string' } }`) alongside supporting dedup/rollback indexes.

---

## 7. Verification & Test Execution Results

All local checks below ran cleanly after final code edits:

| Command | Exit Code | Observed Output Summary |
|---|---:|---|
| `npm run build:all` | `0` | Built `core-service` and `planning-service` cleanly. |
| `npx tsc -p tsconfig.build.json --noEmit` | `0` | Strict TypeScript typecheck passed (`0` errors). |
| `npx eslint "libs/shared/src/ingestion/*.ts" scripts/ingestion/ingest.ts apps/core-service/src/restaurants/schemas/restaurant.schema.ts` | `0` | `0` errors, `0` warnings across all hardened/added files. |
| `npm run test:microservices` | `0` | **33 passed / 33 suites, 224 passed / 224 tests, 0 failures, 0 skipped.** |
| `git diff --check` | `0` | Zero whitespace errors or conflict markers. |
| Prior isolated Docker CLI `--dry-run` (`m10_2_1_sample_dryrun` on `gastro_core_test`) | `0` | Earlier M10.2.1 run on `gastro_core_test`: `rawStagedCount=0`, `plannedInserts=4`, `matched_count=0`, `updated_count=0`; zero DB writes (`[m10_2_sample_validation_report.json](../samples/m10_2_sample_validation_report.json)`). |

*(Remote GitHub Actions workflow execution for PR #15 happens upon pushing to `origin/fix/m10-2-1-ingestion-safety-hardening` and was not directly observed locally.)*

---

## 8. Remaining Limitations

- Replica-set MongoDB transactions remain unused on standalone Docker `mongo-test`; atomicity across `restaurants` + `ingestion_batches` relies on write-ahead `'pending'` ledgers + recovery (`--recover`).
- Live Atlas ingestion remains intentionally blocked until staging audit `BLK-11`, `V005` backfill, and replica-set environment review complete.
- Repo-wide `npm run lint` remains red due to pre-existing legacy `@typescript-eslint/no-unsafe-*` and Prettier errors outside the ingestion/hardening module scope.
