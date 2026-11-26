# M9.6 — Database Readiness Probes (`/health` & `/health/ready`)

**Milestone:** M9.6 (`P1.3` / `BLK-10`)  
**Services Covered:** `core-service` (`:3001`), `planning-service` (`:3003`)

---

## 1. Endpoint Contract Separation

| Endpoint | Purpose | Success Response | Failure Response | Prefix Exclusion |
| :--- | :--- | :--- | :--- | :--- |
| `GET /health` | Process liveness probe | `200 OK` `{ status: 'UP', service, timestamp, uptime }` | Container unresponsive | Excluded (`'health'`) |
| `GET /health/ready` | Database readiness probe (`readyState === 1` + bounded admin `ping`) | `200 OK` `{ status: 'READY', service, database: { ready: true, readyState: 1, readyStateLabel: 'connected', dbPingOk: true, latencyMs }, timestamp, uptime }` | **`503 Service Unavailable`** `{ status: 'NOT_READY', service, database: { ready: false, readyState, readyStateLabel, dbPingOk: false, error }, timestamp, uptime }` | Excluded (`'health/ready'`) |

---

## 2. Implementation Files

- [`libs/shared/src/health/mongo-readiness.util.ts`](../../libs/shared/src/health/mongo-readiness.util.ts) — `checkMongoReadiness()` verifies Mongoose `readyState === 1` and executes a `2000ms`-bounded `connection.db.admin().command({ ping: 1 })` without exposing URIs or credentials.
- [`apps/core-service/src/health/health.controller.ts`](../../apps/core-service/src/health/health.controller.ts) & [`apps/core-service/src/main.ts`](../../apps/core-service/src/main.ts) — exposes un-prefixed `GET /health` and `GET /health/ready`.
- [`apps/planning-service/src/health/health.controller.ts`](../../apps/planning-service/src/health/health.controller.ts) & [`apps/planning-service/src/main.ts`](../../apps/planning-service/src/main.ts) — exposes un-prefixed `GET /health` and `GET /health/ready`.
- [`docker-compose.yml`](../../docker-compose.yml), [`apps/core-service/Dockerfile`](../../apps/core-service/Dockerfile), and [`apps/planning-service/Dockerfile`](../../apps/planning-service/Dockerfile) — container healthchecks probe `/health/ready`, and `nginx-gateway` waits on `condition: service_healthy` for both backend microservices.
