# M10.6 — Local Docker Runtime & Microservices Integration Validation Report

- **Date:** 2026-11-28
- **Repository:** `maanxx/KLTN-123-GastroWise-BE`
- **Branch:** `feat/m10-6-local-runtime-validation` (branched from `main` @ `4529579`)
- **Environment:** Isolated Local Docker Desktop (`29.6.2`) / Docker Compose (`v5.3.1`)
- **Database Safety:** 100% isolated local `mongo:7.0` container (`gastrowise-mongo-test`) with SCRAM `--auth`; zero MongoDB Atlas or production connections; zero remote migrations; existing `mongo_test_data` volume preserved untouched.

---

## 1. Architecture & Container Inventory

All five GastroWise runtime services run on the isolated Docker bridge network `kltn-123-gastrowise-be_gastrowise_network`:

| Container Name | Compose Service | Image / Build Context | Internal Port / Host Binding | Databases / Auth Scope |
|---|---|---|---|---|
| `gastrowise-mongo-test` | `mongo-test` | `mongo:7.0` (`mongod --auth --bind_ip_all`) | `27017/tcp` (internal only) | `gastro_core_test`, `gastro_planning_test` (SCRAM users via `docker/mongo/01-init-users.js`) |
| `gastrowise-core-service` | `core-service` | `apps/core-service/Dockerfile` (`node:24-alpine`) | `3001/tcp` (internal only) | `gastro_core_svc` → `readWrite` on `gastro_core_test` |
| `gastrowise-planning-service` | `planning-service` | `apps/planning-service/Dockerfile` (`node:24-alpine`) | `3003/tcp` (internal only) | `gastro_planning_svc` → `readWrite` on `gastro_planning_test` |
| `gastrowise-ai-service` | `ai-service` | `../KLTN-123-GastroWise-AI/Dockerfile` (`python:3.12-slim`) | `5000/tcp` (internal only) | `gastro_ai_reader` → `read` only on `gastro_core_test` |
| `gastrowise-nginx-gateway` | `nginx-gateway` | `nginx:1.27-alpine` (`./nginx/nginx.conf`) | `0.0.0.0:8080->8080/tcp` | Reverse proxy + rate limiting + correlation ID |

---

## 2. Actual Startup & Inspection Commands

```bash
# Verify Docker runtime & compose stack
docker info --format '{{.ServerVersion}}'
docker compose version
docker compose ps --format 'table {{.Name}}\t{{.Service}}\t{{.Status}}\t{{.Ports}}'

# Start or verify isolated stack without removing volumes (never use `down -v`)
docker compose up -d
```

---

## 3. Actual Container Status & Restart Behavior

Observed via `docker compose ps` and `docker inspect`:

| Container | State | Health | Restart Count | Network |
|---|---|---|---:|---|
| `gastrowise-mongo-test` | `running` | `healthy` | `0` | `kltn-123-gastrowise-be_gastrowise_network` |
| `gastrowise-core-service` | `running` | `healthy` | `0` | `kltn-123-gastrowise-be_gastrowise_network` |
| `gastrowise-planning-service` | `running` | `healthy` | `0` | `kltn-123-gastrowise-be_gastrowise_network` |
| `gastrowise-ai-service` | `running` | `healthy` | `0` | `kltn-123-gastrowise-be_gastrowise_network` |
| `gastrowise-nginx-gateway` | `running` | `healthy` | `0` | `kltn-123-gastrowise-be_gastrowise_network` |

All containers reported `0` restarts over 3+ hours of uptime with clean startup logs (`Nest application successfully started` on Core `0.0.0.0:3001` and Planning `0.0.0.0:3003`, `200 OK` probes on AI `5000` and Nginx `8080`).

---

## 4. Health Check & MongoDB Readiness Responses

| Check | Command / Endpoint | HTTP / Exit | Observed Response |
|---|---|---:|---|
| MongoDB Ping & SCRAM Users | `mongosh` admin ping + `getUser()` on `gastro_core_test` & `gastro_planning_test` | `0` | `{ ping: 1, coreUser: true, aiUser: true, planningUser: true }` |
| MongoDB Cross-DB Isolation | `gastro_core_svc` querying `gastro_planning_test.getCollectionNames()` | `0` | `ISOLATED_OK: Unauthorized` |
| Gateway Health | `GET http://127.0.0.1:8080/health` | `200` | `{"status":"UP","gateway":"nginx-api-gateway","timestamp":"2026-11-28T07:52:36+00:00"}` |
| Core Readiness | `GET http://127.0.0.1:3001/health/ready` (inside container) | `200` | `{"status":"READY","service":"core-service","database":{"ready":true,"readyState":1,"readyStateLabel":"connected","dbPingOk":true,"latencyMs":1}}` |
| Planning Readiness | `GET http://127.0.0.1:3003/health/ready` (inside container) | `200` | `{"status":"READY","service":"planning-service","database":{"ready":true,"readyState":1,"readyStateLabel":"connected","dbPingOk":true,"latencyMs":0}}` |
| AI Service Health | `GET http://127.0.0.1:5000/` (inside container) | `200` | `{"status":"GastroWise AI Microservice Running","data_status":"DATA_READY","restaurants_loaded":3,"validation":{"database":"gastro_core_test",...}}` |

---

## 5. Gateway Routing & Inter-Service Authentication Results

| Test Case | Request | Expected | Observed | Status |
|---|---|---|---|---|
| Gateway → Core Service | `GET http://127.0.0.1:8080/api/v1/restaurants?page=1&limit=1` | `200` + `X-Correlation-Id` | `HTTP 200`, `rt=0.007s`, `X-Correlation-Id` header set | **PASS** |
| Gateway → Planning Service (unauth) | `GET http://127.0.0.1:8080/api/v1/itineraries` | `401 Unauthorized` | `HTTP 401`, `{"message":"Unauthorized","statusCode":401}`, `rt=0.008s` | **PASS** |
| Gateway legacy rewrite | `GET http://127.0.0.1:8080/restaurants?page=1&limit=1` | `200` (rewritten to `/api/v1/restaurants`) | `HTTP 200`, `rt=0.005s` | **PASS** |
| Planning → Core internal (no key) | `GET http://core-service:3001/api/v1/internal/restaurants/candidates?limit=1` | `401` | `HTTP 401` (`Missing internal service key credentials`) | **PASS** |
| Planning → Core internal (invalid key) | Same with `X-Internal-Service-Key: wrong-key` | `401` | `HTTP 401` (`Invalid internal service key`) | **PASS** |
| Planning → Core internal (valid key) | Same with container `INTERNAL_SERVICE_KEY` | `200` | `HTTP 200` (`{"candidates":[],"total":0}`) | **PASS** |
| Planning → AI Service internal | `GET http://ai-service:5000/` from `gastrowise-planning-service` | `200` | `HTTP 200` (`DATA_READY`, `gastro_core_test`) | **PASS** |

---

## 6. Infrastructure Audit Findings & Fixes

1. **Fixed — `planning-service` startup dependency race (`docker-compose.yml`):**
   - **Finding:** `planning-service.depends_on.core-service` used `condition: service_started` instead of `condition: service_healthy`.
   - **Fix:** Updated to `condition: service_healthy` in `docker-compose.yml` so `planning-service` waits until `core-service` passes `/health/ready` before accepting traffic.
2. **Observed (Documented, Not Changed) — Duplicate `X-Correlation-Id` response header:**
   - Nginx sets `add_header X-Correlation-Id $corr_id always;` while Core Service also returns `X-Correlation-Id`, causing two identical `X-Correlation-Id` headers on proxied responses. Recommend using `proxy_hide_header X-Correlation-Id;` in `nginx/nginx.conf` in a follow-up gateway polish task.
3. **Observed (Documented, Not Changed) — Health route path:**
   - Core and Planning expose `/health` and `/health/ready` (not `/health/live`). Docker Compose healthchecks already target `/health/ready` correctly.

---

## 7. M10.6.1 — Docker Security, Gateway & Post-PR #18 Integration Hardening

### 7.1 Docker Credential Hardening (`docker-compose.yml`, `.env.example`, `.gitignore`)
- Removed hardcoded credential fallbacks from `docker-compose.yml` and enforced Docker Compose fail-fast `${VAR:?...}` interpolation for `MONGODB_ROOT_USERNAME`, `MONGODB_ROOT_PASSWORD`, `CORE_DB_USER`, `CORE_DB_PASSWORD`, `PLANNING_DB_USER`, `PLANNING_DB_PASSWORD`, `AI_DB_USER`, `AI_DB_PASSWORD`, `JWT_SECRET`, `INTERNAL_SERVICE_KEY`, `INTERNAL_AI_KEY`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET`.
- Explicitly cleared `CORE_MONGODB_URI=`, `MONGODB_URI_CORE=`, `PLANNING_MONGODB_URI=`, `MONGODB_URI_PLANNING=`, and `MONGODB_URI=` inside Compose service definitions so host `.env` Atlas URIs can never bleed into isolated local Docker containers.
- Updated `.env.example` with placeholder-only local Docker test variables and added `.env.docker.local` / `.env.*.local` to `.gitignore`.
- Verified fail-fast behavior: `docker compose --env-file /dev/null config -q` exited with code `1` (`required variable PLANNING_DB_USER is missing a value: PLANNING_DB_USER is required in .env.docker.local`).

### 7.2 AI Repository Prerequisite (`../KLTN-123-GastroWise-AI`)
- **Required Workspace Layout:** Sibling directory alongside the backend repository:
  ```text
  <workspace-root>/
  ├── KLTN-123-GastroWise-BE/   # docker-compose.yml (build context for core & planning)
  └── KLTN-123-GastroWise-AI/   # build context for ai-service (../KLTN-123-GastroWise-AI)
  ```
- **Observed AI Repository Branch / Commit:** `feature/m10-ai-data-readiness` (`3159c15`, `[feat]: thien implement ai mongo data readiness and live cross-service validation`).
- **Build Prerequisites:** Docker Desktop / Engine with Compose v2+, `KLTN-123-GastroWise-AI/Dockerfile` (`python:3.12-slim`) and `requirements.txt` present in `../KLTN-123-GastroWise-AI`.
- **Exact Local Startup Procedure (never use `down -v`):**
  ```bash
  cd KLTN-123-GastroWise-BE
  cp .env.example .env.docker.local
  # Edit .env.docker.local with local-only credentials (never commit; never use Atlas URIs)
  docker compose --env-file .env.docker.local config -q
  docker compose --env-file .env.docker.local build
  docker compose --env-file .env.docker.local up -d
  docker compose --env-file .env.docker.local ps
  ```

### 7.3 Nginx Gateway Hardening (`nginx/nginx.conf`)
- Added `proxy_hide_header X-Correlation-Id;` so Nginx propagates `$corr_id` to upstreams while emitting **exactly 1** `X-Correlation-Id` response header (verified: `X-Correlation-Id header count: 1`, value `m1061-corr-check`).
- Added `X-Result-Truncated`, `X-Total-Count`, `X-Result-Limit`, `X-Legacy-Endpoint`, `Deprecation`, `Link`, and `Warning` to `Access-Control-Expose-Headers` while preserving existing CORS origin whitelist and preflight behavior.

### 7.4 Post-PR #18 Rebuild & Live Verification Results

| Check | Exit Code / HTTP | Observed Result |
|---|---:|---|
| `docker compose --env-file /dev/null config -q` | `1` (expected fail-fast) | Rejected missing required credential (`PLANNING_DB_USER is required in .env.docker.local`) |
| `git check-ignore -v .env.docker.local` | `0` | Matched `.gitignore:44:.env.*.local` |
| `docker compose --env-file .env.docker.local config -q` | `0` | `COMPOSE_CONFIG_OK` |
| `docker compose --env-file .env.docker.local build core-service planning-service` | `0` | Rebuilt `core-service` and `planning-service` with merged PR #18 (`18a2020`) |
| `docker compose --env-file .env.docker.local up -d core-service planning-service nginx-gateway` + `nginx -s reload` | `0` | All 5 containers `running` + `healthy`, `restarts=0`, existing `mongo_test_data` preserved |
| `GET /api/v1/restaurants?page=1&limit=5` (`Origin: http://localhost:3000`, `X-Correlation-Id: m1061-corr-check`) | `HTTP 200` | Single `X-Correlation-Id: m1061-corr-check`; `Access-Control-Expose-Headers` includes `X-Result-Truncated,X-Total-Count,Link,Warning`; body includes M10.5.1 `"isBoundedResult":false` |
| `GET /api/v1/dishes?page=1&limit=5` | `HTTP 200` | `{"data":[],"total":0,"page":1,"limit":5,"totalPages":0}` |
| `GET /api/v1/restaurants/674000000000000000000099/dishes` | `HTTP 404` | `Restaurant with ID or slug "674000000000000000000099" not found` |
| `GET /api/v1/restaurants/bad!id/dishes` | `HTTP 400` | `Invalid restaurant ID or slug "bad!id".` |
| `GET /api/v1/restaurants/menu/all` | `HTTP 200` | Returns M10.5.2 headers (`X-Legacy-Endpoint: true`, `Deprecation: true`, `Link: </api/v1/dishes>; rel="successor-version"`, `X-Total-Count: 0`, `X-Result-Limit: 200`, `X-Result-Truncated: false`) |
| Core & Planning `/health/ready` | `HTTP 200` | Both `status: "READY"`, `dbPingOk: true` |
| MongoDB cross-DB isolation (`gastro_core_svc` → `gastro_planning_test`) | `0` | `ISOLATED_OK: Unauthorized` |
| Planning → Core internal auth (`/api/v1/internal/restaurants/candidates?limit=1`) | `401` / `401` / `200` | Missing key → `401`, invalid key → `401`, valid `INTERNAL_SERVICE_KEY` → `200` |

---

## 8. Remaining Limitations

- **Empty Local `gastro_core_test` Dataset:** `gastro_core_test.restaurants` currently contains `0` documents in the preserved local volume, so `GET /api/v1/restaurants/{id}/dishes` was verified for `HTTP 400` (invalid ID) and `HTTP 404` (missing restaurant) rather than a populated `HTTP 200` dish list. Seeding `gastro_core_test` via M10.4 local ingestion is needed for populated `HTTP 200` smoke verification.
- **Duplicate `Access-Control-Allow-Origin` Header on Proxied Responses:** Both Core Service (`enableCors`) and Nginx emit `Access-Control-Allow-Origin` and `Access-Control-Allow-Credentials` on `Origin: http://localhost:3000`; left unchanged to preserve existing CORS behavior, recommended for cleanup (`proxy_hide_header Access-Control-Allow-Origin;` in Nginx) in a follow-up task.
- **Authenticated JWT Itinerary Flow:** End-to-end `POST /api/v1/itineraries/generate` was not run to avoid mutating the preserved local test database.
