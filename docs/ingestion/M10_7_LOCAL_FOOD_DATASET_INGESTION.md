# M10.7 — Local Food Dataset & Ingestion Pipeline

- **Repository:** `maanxx/KLTN-123-GastroWise-BE`
- **Branch:** `feat/m10-7-local-food-data-ingestion` (branched from `origin/main` @ `18a2020`)
- **Database Ownership:** Core Service (`gastro_core_test` ONLY for local ingestion; Planning Service never accesses Core MongoDB directly)

---

## 1. Existing Data Structure Audit (Task 1)

| Collection | Schema File | Owner | Key Fields | Indexes & Deduplication |
|---|---|---|---|---|
| `restaurants` | `apps/core-service/src/restaurants/schemas/restaurant.schema.ts` | Core Service (`gastro_core_test`) | `tenQuan`, `diaChi`, `cityId`, `diemTrungBinh`, `giaCa`, `tags`, `lat`, `lon`, `location` (GeoJSON Point or `null`), `avatarUrl`, `urlGoc`, `slug`, `status`, `externalSource`, `externalSourceId`, `ingestionBatchId` | `2dsphere` on `location`, `{ status: 1, diemTrungBinh: -1 }`, text index, partial `{ externalSource: 1, externalSourceId: 1 }` |
| `menu_items` | `apps/core-service/src/restaurants/schemas/menu-item.schema.ts` | Core Service (`gastro_core_test`) | `restaurantId` (ObjectId ref `Restaurant`), `name`, `description`, `price` (`>= 0`), `image`, `isVegetarian`, `calories`, `tags: string[]`, `isAvailable`, `isFeatured`, plus optional M10.7 provenance fields (`externalSource`, `externalSourceId`, `ingestionBatchId`, sanitized bounded `sourceMetadata`) | `{ restaurantId: 1 }` and partial `{ externalSource: 1, externalSourceId: 1 }` |

No competing schemas or collections were introduced; all existing API contracts (`GET /api/v1/restaurants`, `GET /api/v1/dishes`, `GET /api/v1/restaurants/:id/dishes`, and legacy menu endpoints) remain 100% compatible.

---

## 2. Pipeline Architecture

1. **Normalization (`libs/shared/src/ingestion/dish-ingestion.normalizer.ts` & `ingestion.normalizer.ts`):**
   - Extracts both standalone `dishes` arrays and nested `dishes` / `menu` / `menuItems` inside ShopeeFood restaurant payloads.
   - Normalizes Unicode NFC text/whitespace, Vietnamese formatted prices (`"75.000đ"`, `"68,000 VND"`, `"45k"`, numeric VND), deduplicated `tags`/`category`, optional booleans/calories, and HTTP(S) image URLs (rejecting `javascript:`, malformed URLs, or credential-bearing URLs).
   - Preserves `externalSource`, `externalSourceId`, and sanitized, bounded `sourceMetadata` (recursively redacted via `sanitizeRawPreview` before persistence in `menu_items`, and never exposed in public Dish DTOs).
2. **Validation & Partial-Failure Isolation:**
   - Validates required fields, non-negative bounded prices (`<= 50,000,000 VND`), coordinates (null-safe GeoJSON via M10.3), image URLs, and **restaurant-dish relationships** (`DISH_ORPHAN_RESTAURANT` rejects dishes referencing nonexistent restaurants without aborting valid records).
3. **Idempotent Core Persistence (`libs/shared/src/ingestion/food-dataset.pipeline.ts`):**
   - Stage 1 delegates restaurants to `runRestaurantIngestionPipeline()` (staging + ledger + idempotent upsert into `restaurants`).
   - Stage 2 resolves dish `restaurantId` ObjectIds against `gastro_core_test.restaurants`, deduplicates intra-batch and unchanged existing dishes via content digest, and persists changes via MongoDB `bulkWrite` (`updateOne` + `upsert: true` keyed by `{ externalSource, externalSourceId }`).
   - Enforces fail-closed local DB guard (`APPROVED_INGESTION_DB_NAME = 'gastro_core_test'`, blocks `mongodb+srv://` / Atlas / remote hosts) and requires `GASTROWISE_ALLOW_LOCAL_INGESTION=true` for `--apply`.

---

## 3. Running Locally (Docker Isolated `gastro_core_test`)

Never use MongoDB Atlas credentials, never run remote migrations, and never execute `docker compose down -v`.

```bash
# Load local Docker test credentials (gitignored .env.docker.local)
set -a && source .env.docker.local && set +a

# 1. Dry-run preview (no DB writes)
docker run --rm --network kltn-123-gastrowise-be_gastrowise_network \
  -v "$PWD":/work -w /work \
  -e CORE_DB_NAME=gastro_core_test \
  -e MONGODB_URI_CORE="mongodb://${CORE_DB_USER}:${CORE_DB_PASSWORD}@mongo-test:27017/gastro_core_test?authSource=gastro_core_test" \
  node:24-alpine \
  npx ts-node -r tsconfig-paths/register scripts/ingestion/ingest-food-dataset.ts \
    --file=scripts/ingestion/fixtures/sample_shopeefood_food_dataset.json \
    --source=shopeefood \
    --dry-run

# 2. Apply import into local gastro_core_test (explicit write guard required)
docker run --rm --network kltn-123-gastrowise-be_gastrowise_network \
  -v "$PWD":/work -w /work \
  -e CORE_DB_NAME=gastro_core_test \
  -e MONGODB_URI_CORE="mongodb://${CORE_DB_USER}:${CORE_DB_PASSWORD}@mongo-test:27017/gastro_core_test?authSource=gastro_core_test" \
  -e GASTROWISE_ALLOW_LOCAL_INGESTION=true \
  node:24-alpine \
  npx ts-node -r tsconfig-paths/register scripts/ingestion/ingest-food-dataset.ts \
    --file=scripts/ingestion/fixtures/sample_shopeefood_food_dataset.json \
    --source=shopeefood \
    --batch-id=m107-live-run-1 \
    --apply
```

---

## 4. Actual Example Import Report (Observed Against Local `gastro_core_test`)

```json
{
  "batchId": "m107-live-run-1",
  "mode": "apply",
  "source": "shopeefood",
  "targetDb": "gastro_core_test",
  "targetUriRedacted": "mongodb://gastro_core_svc:***@mongo-test:27017/gastro_core_test?authSource=gastro_core_test",
  "durationMs": 29,
  "totalRecordsReceived": 15,
  "validRecords": 9,
  "rejectedRecords": 4,
  "insertedRecords": 9,
  "updatedRecords": 0,
  "skippedDuplicates": 2,
  "restaurants": {
    "totalReceived": 5,
    "valid": 3,
    "rejected": 1,
    "inserted": 3,
    "updated": 0,
    "skippedDuplicates": 1
  },
  "dishes": {
    "totalReceived": 10,
    "valid": 6,
    "rejected": 3,
    "inserted": 6,
    "updated": 0,
    "skippedDuplicates": 1
  },
  "validationErrorsByField": {
    "restaurant.Name": 1,
    "dish.price": 1,
    "dish.name": 1,
    "dish.restaurantExternalId": 1
  },
  "warningsCount": 5
}
```

On the immediate idempotent repeat (`m107-live-run-2`, `18ms`): `insertedRecords: 0`, `dishes.inserted: 0`, `dishes.updated: 0`, `dishes.skippedDuplicates: 7` (zero duplicates created). Post-import HTTP checks through Nginx Gateway (`http://127.0.0.1:8080/api/v1/restaurants` and `/api/v1/dishes`) confirmed the 3 sample restaurants and 6 linked dishes are served live.
