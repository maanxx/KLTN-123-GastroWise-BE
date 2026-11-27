# M9.8.0 — Live MongoDB & Docker Runtime Validation Report

**Repository:** `KLTN-123-GastroWise-BE`  
**Branch:** `feature/m9-6-backup-pipeline-readiness-probes`  
**HEAD Reference:** `7466115`  
**Execution Date:** `2026-11-27`  
**Environment:** Local Docker Desktop `4.85.0` (Engine `29.6.2`, Compose `v5.3.1`, `linux/arm64`) — **100% isolated from MongoDB Atlas**

---

## 1. Stage-by-Stage Summary

| Stage | Scope | Status | Summary |
|:---|:---|:---|:---|
| **Stage A** | `mongo-test` isolated startup & volume check | **PASS** | `ATLAS_DETECTED_IN_COMPOSE_CONFIG: False`; `mongo-test` `Up (healthy)`; `kltn-123-gastrowise-be_mongo_test_data` preserved (`CreatedAt: 2026-11-26T05:19:26Z`) |
| **Stage B** | `core-service` rebuild, DNS, DB auth & probes | **PASS** | Built & `Up (healthy)`; `mongo-test -> 172.18.0.2`; `/health` = `UP`; `/health/ready` = `READY` (`readyState: 1`, `dbPingOk: true`) |
| **Stage C** | `planning-service`, `ai-service`, `nginx-gateway` | **PASS** | All 5 containers `Up (healthy)`; Planning→Core internal auth API returned `200`; Nginx routed `/health` (`200`), `/api/v1/restaurants` (`200`), `/api/v1/itineraries` (`401`) |
| **Stage D** | Isolated MongoDB CRUD (`_m9_8_0_runtime_crud_probe`) | **PASS** | Insert, read, update, delete verified (`inserted: true`, `updatedCount: 1`, `deletedCount: 1`, `afterDeleteCount: 0`) |
| **Stage E** | MongoDB restart & volume persistence | **PASS** | `docker compose restart mongo-test`; volume preserved; `_m9_8_0_persistence_probe` survived (`survived: true`); probe collection dropped; Core & Planning auto-reconnected to `200 READY` (~15s; transient `503` observed at +2s) |
| **Atlas / Migrations / Restore** | Remote Atlas, schema migrations, backup restore | **NOT TESTED** | Explicitly excluded per M9.8.0 scope |
| **AI Catalog Data Load** | AI `restaurants_loaded > 0` | **NOT TESTED / EMPTY CATALOG** | AI service authenticated cleanly to `gastro_core_test.restaurants`, which currently holds `0` test documents (`data_status: Empty Data`); AI repo itself not modified |

---

## 2. Stage A — MongoDB Startup & Volume Verification (**PASS**)

- **Resolved Compose safety check:** `ATLAS_DETECTED_IN_COMPOSE_CONFIG: False` (`mongodb+srv` and `mongodb.net` absent from `docker compose config`).
- **Volume preservation:**
  - `kltn-123-gastrowise-be_mongo_test_data` mounted to `/data/db` (`rw`)
  - Timestamp unchanged before start, after start, and after Stage E restart: `2026-11-26T05:19:26Z`
- **Container status (`docker compose ps mongo-test`):**
  - `gastrowise-mongo-test` | `mongo:7.0` | `Up 6 seconds (healthy)` | `27017/tcp`
- **Sanitized log evidence:**
  - SCRAM-SHA-256 authentication verified (`"msg":"Successfully authenticated","attr":{..."mechanism":"SCRAM-SHA-256","user":"gastro_root_staging","db":"admin","result":0}`).

---

## 3. Stage B — Core Service Runtime Verification (**PASS**)

- **Build & Status:** `gastrowise-core-service` (`gastrowise-core-service:test`) rebuilt and reached `Up 6 seconds (healthy)`.
- **Environment verification (safe booleans only):**
  - `MONGO_HOST: 'mongo-test'`, `MONGO_PORT: '27017'`, `CORE_DB_NAME: 'gastro_core_test'`, `CORE_URI_SET: false`, `ATLAS_IN_ENV: false`
- **DNS resolution inside container:** `mongo-test -> 172.18.0.2`
- **Health endpoints:**
  - `GET http://127.0.0.1:3001/health` → `{"status":"UP","service":"core-service"}`
  - `GET http://127.0.0.1:3001/health/ready` → `{"status":"READY","service":"core-service","database":{"ready":true,"readyState":1,"readyStateLabel":"connected","dbPingOk":true,"latencyMs":0}}`
- **Sanitized startup log excerpt:**
  - Routes mapped cleanly including `/health`, `/health/ready`, `/api/v1/restaurants`, `/api/v1/internal/restaurants/candidates`
  - `🚀 GastroWise Core Service is listening on 0.0.0.0:3001`

---

## 4. Stage C — Planning, AI & Nginx Gateway Verification (**PASS**)

- **Container statuses (`docker compose ps`):**
  - `gastrowise-mongo-test`: `Up (healthy)` (`27017/tcp`)
  - `gastrowise-core-service`: `Up (healthy)` (`3001/tcp`)
  - `gastrowise-planning-service`: `Up (healthy)` (`3003/tcp`)
  - `gastrowise-ai-service`: `Up (healthy)` (`5000/tcp`)
  - `gastrowise-nginx-gateway`: `Up (healthy)` (`0.0.0.0:8080->8080/tcp`)
- **Planning Service probes:**
  - `GET /health` → `{"status":"UP","service":"planning-service"}`
  - `GET /health/ready` → `{"status":"READY","service":"planning-service","database":{"ready":true,"readyState":1,"readyStateLabel":"connected","dbPingOk":true,"latencyMs":1}}`
- **Planning → Core mutual auth (`X-Internal-Service-Key`):**
  - `http://core-service:3001/api/v1/internal/restaurants/candidates?limit=3` → HTTP `200`, `{"candidates":[],"total":0}`
- **AI Service inspection (read-only, AI repo unmodified):**
  - `GET http://127.0.0.1:5000/` → `{"status":"GastroWise AI Microservice Running","architecture":"Enterprise Modular Tree (Clean Architecture)","data_status":"Empty Data","restaurants_loaded":0}`
  - Sanitized log: `[MongoDB Loader] Authenticated cleanly to 'gastro_core_test.restaurants', loaded 0 documents.` (consistent with `db.restaurants.countDocuments({}) === 0` in `gastro_core_test`).
- **Nginx Gateway routing (`nginx-gateway:8080`):**
  - `GET /health` → HTTP `200` (`{"status":"UP","gateway":"nginx-api-gateway"}`)
  - `GET /api/v1/restaurants` → HTTP `200`
  - `GET /api/v1/itineraries` (unauthenticated) → HTTP `401` (confirmed routing to guarded Planning Service)

---

## 5. Stage D — Database CRUD Verification (**PASS**)

Executed inside `mongo-test` against `gastro_core_test._m9_8_0_runtime_crud_probe` using `CORE_DB_USER`:

```json
{
  "inserted": true,
  "afterInsertStep": "created",
  "updatedCount": 1,
  "afterUpdateStep": "updated",
  "afterUpdateVerified": true,
  "deletedCount": 1,
  "afterDeleteCount": 0,
  "persistenceSeeded": 1
}
```

---

## 6. Stage E — Volume Persistence & Reconnection Verification (**PASS**)

1. Restarted `mongo-test` via `docker compose restart mongo-test` (without removing volumes).
2. Verified `kltn-123-gastrowise-be_mongo_test_data` retained original `CreatedAt` (`2026-11-26T05:19:26Z`).
3. Verified `m9_8_0_persistence_probe` survived restart and cleaned up `_m9_8_0_runtime_crud_probe`:
   ```json
   {
     "survived": true,
     "docId": "m9_8_0_persistence_probe",
     "persisted": true,
     "probeCollectionCleaned": true
   }
   ```
4. **Readiness probe & reconnect observation:**
   - Immediately after MongoDB restart (`+2s`), `core-service /health/ready` accurately returned `503 Service Unavailable` while the driver re-established its connection.
   - Within `~15s`, both `core-service` and `planning-service` auto-recovered without container restarts (`uptime: 101s`), returning `200 READY` (`"ready": true, "readyState": 1, "dbPingOk": true, "latencyMs": 1`).

---

## 7. Remaining Blockers & Scope Boundaries

- **`BLK-11` (BLOCKED — High):** Staging Atlas clone audit remains unexecuted (local Docker validation does not substitute for staging Atlas data profiling).
- **Migrations & Backup Restore (`NOT TESTED` in M9.8.0):** Excluded from this runtime validation task; requires separate explicit approval.
- **AI Catalog Population (`NOT TESTED` in M9.8.0):** Local `gastro_core_test.restaurants` has `0` documents; seeding synthetic test restaurants or testing AI model inference with non-empty data was outside M9.8.0 scope.
