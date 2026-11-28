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

## 7. Remaining Limitations

- The currently running `gastrowise-core-service:test` container image was built from `main` prior to merging PR #18 (M10.5 `/dishes` endpoints); rebuilding `core-service` after PR #18 merges is required to validate M10.5 `/dishes` routes inside Docker.
- `Access-Control-Expose-Headers` in `nginx/nginx.conf` currently exposes `Content-Length,Content-Range,X-Correlation-Id` only; cross-origin browser clients reading M10.5.2 legacy menu headers (`X-Result-Truncated`, `X-Total-Count`, `Link`, `Warning`) will need those headers added after PR #18 merges.
- End-to-end authenticated JWT itinerary generation (`POST /api/v1/itineraries/generate`) was not exercised in this read-only validation pass to avoid mutating the existing local test volume.
