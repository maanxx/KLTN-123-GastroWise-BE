# M8.7 — Runtime Index, Query Execution & Cross-Service Validation

- **Repository:** `maanxx/KLTN-123-GastroWise-BE`
- **Branch:** `feature/m8-7-migration-testing`
- **Execution Window (UTC):** `2026-11-25T09:06:11Z` – `2026-11-25T09:13:43Z`
- **Companion Docs:** [`M8_7_MIGRATION_TEST_REPORT.md`](./M8_7_MIGRATION_TEST_REPORT.md), [`M8_7_DATA_INTEGRITY_RESULTS.md`](./M8_7_DATA_INTEGRITY_RESULTS.md)

---

## 1. Staging Isolation & Environment Validation (M8.7.2)

Verified against Docker Compose topology ([`docker-compose.yml`](../../docker-compose.yml)):

| Check | Observed Runtime Value | Status | Notes / Parity Gaps |
|---|---|---|---|
| **Docker Network** | `kltn-123-gastrowise-be_gastrowise_network` (`bridge`, `172.18.0.0/16`) | **PASS** | `5` healthy containers (`gastrowise-mongo-test`, `core-service`, `planning-service`, `ai-service`, `nginx-gateway`). `27017` is not exposed to host. |
| **MongoDB Engine** | `gastrowise-mongo-test` (`mongo:7.0`, version `7.0.48`, container `39c68c2757ef`) | **PASS** | `mongosh`, `mongodump`, `mongorestore` verified present. |
| **DB Isolation (No Atlas/Prod)** | Core: `mongodb://mongo-test:27017/gastro_core_test`<br/>Planning: `mongodb://mongo-test:27017/gastro_planning_test`<br/>AI: `mongodb://mongo-test:27017/gastro_ai_test` | **PASS** | Zero production URIs or credentials in any container env. |
| **Database Authentication** | `mongo-test` runs **without** `--auth` / SCRAM users | **PARITY GAP** | Local Docker Compose tests connectivity only; least-privilege per-DB roles (`readWrite` vs AI `read`-only) remain unverified at runtime until Atlas/authenticated staging is provisioned. |
| **AI ↔ Core DB Parity** | AI targets `gastro_ai_test` (`0` docs), Core targets `gastro_core_test` | **DEFECT CONFIRMED** | AI `GET /` returned `{"data_status":"Empty Data","restaurants_loaded":0}`. |

---

## 2. Index & Query Execution Analysis — `explain("executionStats")` (M8.7.6)

Executed on seeded synthetic collections (`200` restaurants, `200` menu_items, `248` post-dedup reviews, `100` contacts, `250` interactions, `40` itineraries) **Before** vs **After** `V001` indexes:

| Query Pattern | Pre-Migration Plan (`stages`) | Pre `DocsExamined` / `nRet` | Post-Migration Plan (`stages`) | Post `Index Used` | Post `Keys` / `Docs` / `nRet` |
|---|---|---|---|---|---|
| `menu_items.find({restaurantId}).sort({isFeatured:-1,createdAt:-1})` | `COLLSCAN` + **`SORT`** | `200` / `4` (`0` keys) | `FETCH` + `IXSCAN` | `restaurantId_1_isFeatured_-1_createdAt_-1` | `4` / `4` / `4` (`0 ms`) |
| `reviews.find({restaurantId,status}).sort({isFeatured:-1,createdAt:-1})` | `IXSCAN` (`restaurantId_1_status_1_createdAt_-1`) + **`SORT`** | `6` / `6` (`6` keys) | `FETCH` + `IXSCAN` | `restaurantId_1_isFeatured_-1_createdAt_-1` | `5` / `5` / `5` (`0 ms`) |
| `reviews.find({urlGoc}).sort({isFeatured:-1,createdAt:-1})` | `IXSCAN` (`urlGoc_1`) + **`SORT`** | `6` / `6` (`6` keys) | `FETCH` + `IXSCAN` | `urlGoc_1_isFeatured_-1_createdAt_-1` | `5` / `5` / `5` (`0 ms`) |
| `restaurants.aggregate([$geoNear])` (`limit 10`) | `GEO_NEAR_2DSPHERE` | N/A (`IXSCAN` + `FETCH`) | `GEO_NEAR_2DSPHERE` | `location_2dsphere` | Geospatially indexed |
| `restaurants.find().sort({diemTrungBinh:-1,reviewsCount:-1}).limit(10)` | `COLLSCAN` + **`SORT`** | `200` / `10` (`0` keys) | `LIMIT` + `FETCH` + `IXSCAN` | `diemTrungBinh_-1_reviewsCount_-1` | `10` / `10` / `10` (`0 ms`) |
| `contacts.find().sort({createdAt:-1}).limit(20)` | `COLLSCAN` + **`SORT`** | `100` / `20` (`0` keys) | `LIMIT` + `FETCH` + `IXSCAN` | `createdAt_-1` | `20` / `20` / `20` (`0 ms`) |
| `user_interactions.find({targetType,targetId})` | `FETCH` + `IXSCAN` (`targetId_1`) | `5` / `5` (`5` keys) | `FETCH` + `IXSCAN` | `targetType_1_targetId_1` | `5` / `5` / `5` (`0 ms`) |
| `itineraries.find({user_id}).sort({createdAt:-1})` | `FETCH` + `IXSCAN` | `4` / `4` (`4` keys) | `FETCH` + `IXSCAN` | `user_id_1_createdAt_-1` | `4` / `4` / `4` (`0 ms`) |

- **`$indexStats` Confirmation:** Unused legacy indexes `restaurants.cityId_1` (`ops: 0`) and `restaurants.slug_1` (`ops: 0`) showed zero accesses during benchmark reads, matching M8.2's finding.

---

## 3. Cross-Service Compatibility & Live Gateway Probes (M8.7.7)

All probes sent through Nginx Gateway `http://127.0.0.1:8080` against synthetic data in `gastro_core_test` / `gastro_planning_test`:

| Endpoint / Flow | Request / Context | Observed HTTP Status & Runtime Evidence | Compatibility Verdict |
|---|---|---|---|
| `GET /health` | Gateway, Core (`:3001`), Planning (`:3003`), AI (`:5000`) | All `200 OK`; AI reports `restaurants_loaded: 0` (`gastro_ai_test` empty) | **PASS (AI DB Mismatch Noted)** |
| `GET /api/v1/restaurants?limit=3` | Core catalog read | `200 OK` (`3` hydrated venues returned) | **PASS** |
| `GET /api/v1/restaurants/nearby` (with Array `tags`) | Unvalidated array stored in `tags` field | **`500 Internal Server Error`** (`TypeError: r.tags.split is not a function`) | **DEFECT CONFIRMED (Missing `$jsonSchema` / Type Guard)** |
| `GET /api/v1/restaurants/nearby` (with String `tags`) | Updated `tags` to string `"pho, com, vietnamese"` | `200 OK` (`20` venues returned via `$geoNear`) | **PASS (With String `tags`)** |
| `POST /api/v1/auth/register` & `POST /api/v1/auth/login` | Synthetic user `m87_runtime_probe@example.com` | `201 Created` & `200 OK` (JWT access + refresh tokens issued) | **PASS** |
| `POST /api/v1/auth/refresh` | Valid `{ userId, refreshToken }` immediately after login | **`403 Forbidden`** (`"Access Denied"`) — **live proof of M8.6 Critical Bug:** `User.hashedRefreshToken` lacks `@Prop()` in `user.schema.ts`, causing Mongoose strict mode to omit it | **FAIL (Pre-existing Code Defect)** |
| `POST /api/v1/reviews` | Payload `{ diemReview: 9 }` | **`201 Created`** (stored `diemReview: 9`) — **live proof of M8.6 Critical Bug** (`CreateReviewDto` `@Max(10)` corrupts 5-star scale). Also triggered AI Sentiment (`NEUTRAL`, `0.5`) | **DEFECT CONFIRMED** |
| `POST /api/v1/contacts` | Valid contact payload | `201 Created` (AI classification + status `'CHỜ XỬ LÝ'`) | **PASS** |
| `GET /api/v1/itineraries` & `POST /api/v1/itineraries/generate` | Authenticated JWT, Planning $\leftrightarrow$ Core internal candidates $\leftrightarrow$ AI route optimization | `200 OK` & `201 Created` (saved to `gastro_planning_test.itineraries`). **Geo defect observed in Stop 1:** venue `Số 180` had `lat: 0, lon: 0` vs `location: [106.7009, 10.7769]`, yielding `distance_to_next_km: 15971.73` (`transit_time_mins: 39929`) | **PASS Cross-Service Auth / Geo Anomaly Confirmed** |

---

## 4. Host Unit Test Suite Regression

Executed after final repository changes:
- Command: `npm run test:microservices` (`jest libs/ apps/`)
- Result: **PASS** — `Test Suites: 23 passed, 23 total` | `Tests: 132 passed, 132 total` | `Snapshots: 0 total` | `Time: 1.343 s`.
