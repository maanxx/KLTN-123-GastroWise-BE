# M9.4 — Runtime Validation Report

**Branch:** `feature/m9-4-docker-db-auth-ai-parity`  
**Environment:** Isolated Docker Compose staging (`gastrowise-mongo-test` `mongo:7.0`, `gastrowise-core-service`, `gastrowise-planning-service`, `gastrowise-ai-service`, `gastrowise-nginx-gateway`)  
**Overall Result:** **PASS** (`BLK-06` and `BLK-09` resolved)

---

## 1. Container Topology & Startup Verification

Command executed: `docker compose config -q && docker compose up -d --build`

| Container | Image | Health State | Verified Startup Behavior |
| :--- | :--- | :--- | :--- |
| `gastrowise-mongo-test` | `mongo:7.0` | `healthy` | Booted with `--auth --bind_ip_all`; initialized `mongo_test_data` volume via `01-init-users.js` |
| `gastrowise-core-service` | `gastrowise-core-service:test` | `healthy` | Connected to `gastro_core_test` via SCRAM user `gastro_core_svc`; listening on `:3001` |
| `gastrowise-planning-service` | `gastrowise-planning-service:test` | `healthy` | Connected to `gastro_planning_test` via SCRAM user `gastro_planning_svc`; listening on `:3003` |
| `gastrowise-ai-service` | `gastrowise-ai-service:test` | `healthy` | Authenticated to `gastro_core_test.restaurants` via read-only `gastro_ai_reader`; listening on `:5000` |
| `gastrowise-nginx-gateway` | `nginx:1.27-alpine` | `healthy` | Routed `:8080/health`, `/api/v1/restaurants` (`200`), and `/api/v1/itineraries/all` (`401` JWT-enforced) |

---

## 2. Unauthenticated Access & RBAC Permission Matrix Results

Executed live against `gastrowise-mongo-test` via `mongosh`:

| Test Case | Principal / Auth DB | Target Operation | Observed Result |
| :--- | :--- | :--- | :--- |
| Unauthenticated read | None | `gastro_core_test.restaurants.findOne()` | **PASS (Denied):** `code=13 codeName=Unauthorized` |
| Unauthenticated admin read | None | `admin.system.users.findOne()` | **PASS (Denied):** `code=13 codeName=Unauthorized` |
| Core RW own DB | `gastro_core_svc` (`gastro_core_test`) | `insertOne` + `countDocuments` + `deleteOne` on `gastro_core_test.m94_rbac_probe` | **PASS (Allowed):** `acknowledged=true, count=1, deletedCount=1` |
| Core read Planning DB | `gastro_core_svc` (`gastro_core_test`) | `gastro_planning_test.itineraries.findOne()` | **PASS (Denied):** `code=13 codeName=Unauthorized` |
| Core write Planning DB | `gastro_core_svc` (`gastro_core_test`) | `gastro_planning_test.m94_rbac_probe.insertOne(...)` | **PASS (Denied):** `code=13 codeName=Unauthorized` |
| Planning RW own DB | `gastro_planning_svc` (`gastro_planning_test`) | `insertOne` + `countDocuments` + `deleteOne` on `gastro_planning_test.m94_rbac_probe` | **PASS (Allowed):** `acknowledged=true, count=1, deletedCount=1` |
| Planning read Core DB | `gastro_planning_svc` (`gastro_core_test` target) | `gastro_core_test.restaurants.findOne()` | **PASS (Denied):** `code=13 codeName=Unauthorized` |
| Planning write Core DB | `gastro_planning_svc` (`gastro_core_test` target) | `gastro_core_test.m94_rbac_probe.insertOne(...)` | **PASS (Denied):** `code=13 codeName=Unauthorized` |
| AI read Core catalog | `gastro_ai_reader` (`gastro_core_test`) | `gastro_core_test.restaurants.countDocuments({})` | **PASS (Allowed):** succeeded |
| AI insert Core catalog | `gastro_ai_reader` (`gastro_core_test`) | `gastro_core_test.restaurants.insertOne(...)` | **PASS (Denied):** `code=13 codeName=Unauthorized` |
| AI update Core catalog | `gastro_ai_reader` (`gastro_core_test`) | `gastro_core_test.restaurants.updateOne(...)` | **PASS (Denied):** `code=13 codeName=Unauthorized` |
| AI delete Core catalog | `gastro_ai_reader` (`gastro_core_test`) | `gastro_core_test.restaurants.deleteOne(...)` | **PASS (Denied):** `code=13 codeName=Unauthorized` |
| AI read Planning DB | `gastro_ai_reader` (`gastro_core_test`) | `gastro_planning_test.itineraries.findOne()` | **PASS (Denied):** `code=13 codeName=Unauthorized` |

---

## 3. AI Database Parity & Authentication Failure Verification

1. **Shared Core Catalog Load (`BLK-06`):**
   - Seeded `2` temporary synthetic restaurant documents (`m94_parity_test_1`, `m94_parity_test_2`) into `gastro_core_test.restaurants` via `gastro_core_svc`.
   - Core gateway query `GET http://127.0.0.1:8080/api/v1/restaurants?limit=5` returned HTTP `200` with the seeded documents.
   - Restarted `ai-service` cleanly and queried `GET http://127.0.0.1:5000/`:
     ```json
     {"status":"GastroWise AI Microservice Running","architecture":"Enterprise Modular Tree (Clean Architecture)","data_status":"Active","restaurants_loaded":2}
     ```
   - Removed the `2` synthetic fixtures (`CLEANED_SYNTHETIC_FIXTURES=2`) and restarted `ai-service`.
2. **Explicit Failure on Bad AI Credentials:**
   - Invoked `load_dataset_from_mongo()` inside `gastrowise-ai-service` with an invalid password URI (`authSource=gastro_core_test`).
   - MongoDB logged `AuthenticationFailed: SCRAM authentication failed, storedKey mismatch` (`code=18`).
   - AI raised `DatabaseLoadError` (`code: 18 AuthenticationFailed`) rather than silently returning an empty dataset, and verified the password string did not appear in exception messages or console output.

---

## 4. Persistence, Idempotency & Automated Test Suites

| Check | Command | Outcome |
| :--- | :--- | :--- |
| Idempotent user sync on running `--auth` container | `bash ./docker/mongo/ensure-auth-users.sh gastrowise-mongo-test` | **PASS** — updated all 4 accounts idempotently without error |
| Restart persistence | `docker compose restart mongo-test` + `gastro_core_svc` ping & health probes | **PASS** — `mongo-test` returned `healthy`; `POST_RESTART_CORE_AUTH_PING=1`; Gateway/Core/Planning/AI all healthy |
| Backend TypeScript builds | `npm run build:shared && npm run build:core && npm run build:planning` | **PASS** — exit code `0` |
| Backend microservice tests | `npm run test:microservices` | **PASS** — `27 passed, 27 total` suites; `160 passed, 160 total` tests (including `mongo-uri.util.spec.ts`) |
| AI service contract tests | `docker exec gastrowise-ai-service python -m unittest discover -s tests -v` | **PASS** — `Ran 20 tests in 0.105s`, `OK` |
