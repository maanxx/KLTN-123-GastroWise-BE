# M8.5 — GastroWise Disaster Recovery Plan & Failover Architecture

- **Repository:** `maanxx/KLTN-123-GastroWise-BE`
- **Branch:** `feature/m8-5-disaster-recovery` (branched from M8.4 `feature/m8-4-backup-restore-strategy` `ed8ea67881ff5a8f55fdc77c1c83cd6706d11ddb`)
- **Predecessor Docs:** [`M8_3_MIGRATION_STRATEGY.md`](./M8_3_MIGRATION_STRATEGY.md), [`M8_4_BACKUP_STRATEGY.md`](./M8_4_BACKUP_STRATEGY.md), [`M8_4_RESTORE_RUNBOOK.md`](./M8_4_RESTORE_RUNBOOK.md)
- **Scope:** Planning & architecture documentation only. Zero services were stopped, no failovers were triggered, and no DR exercises were executed in this milestone.

---

## 1. Actual Architecture Assessment (Implemented vs. Proposed)

Verified directly from `docker-compose.yml`, `nginx/nginx.conf`, NestJS source (`apps/core-service`, `apps/planning-service`), and AI (`KLTN-123-GastroWise-AI`):

| Capability | Current Status | Actual Repository Evidence | Proposed Enhancement (Future) |
|---|---|---|---|
| **Service Topology** | **Implemented** | `nginx-gateway` (`:8080`) $\rightarrow$ `core-service` (`:3001`) + `planning-service` (`:3003`); `ai-service` (`:5000`, internal-only) | Production multi-replica scaling behind managed load balancer |
| **Health Probes** | **Liveness Only** | `GET /health` on `nginx-gateway`, `core-service`, `planning-service` return static `200 {status:'UP'}` without checking MongoDB; `ai-service` `GET /` reports `restaurants_loaded` | Add `/health/ready` readiness probe checking `mongoose.connection.readyState === 1` |
| **DB Resilience** | **Partial** | Mongoose `serverSelectionTimeoutMS: 5000`; Docker `mongo-test` has `mongosh` ping healthcheck; Atlas failover depends on external cluster tier | MongoDB Atlas M10+ 3-node Replica Set automatic election + PITR oplog |
| **Logging & Tracing** | **Implemented** | JSON structured error logs + `X-Correlation-Id` generated/forwarded by `nginx.conf`, `CoreApiClient`, and `AiApiClient` | Centralized log aggregation (Loki/ELK), Prometheus metrics, alert webhooks |
| **Inter-Service Timeouts & Fallback** | **Implemented** | `CoreApiClient` (`4000ms` timeout); `AiApiClient` (`3500ms` timeout + per-request Greedy Heuristic fallback); Core fallbacks to DB/rule-based sentiment when AI offline | Bounded exponential-backoff retries on idempotent `GET`s + stateful circuit breaker metrics |
| **Nginx Failure Handling** | **Implemented** | Upstream `max_fails=3 fail_timeout=10s`, `proxy_connect_timeout 5s`, `proxy_read_timeout 30s` (`15s` on auth), rate limits | Multi-upstream active-active containers behind `nginx-gateway` |
| **On-Call / Incident Tooling** | **Not Implemented** | No automated alerting, runbook automation, or on-call schedule exists in repo | Proposed role assignments (`Backend`, `Database`, `DevOps/SRE`, `Tech Lead`) |

---

## 2. Service Recovery Priority Matrix (M8.5.5)

Using exact service names from `docker-compose.yml`:

| Recovery Order | Service / Component | DB Dependency | Can Operate Independently? | Degradation Behavior When Dependencies Fail | Operations Gated Until Data Integrity Verified |
|---|---|---|---|---|---|
| **Priority 0 (Foundation)** | **MongoDB (`gastro_core`, `gastro_planning`)** | N/A (Root datastore) | Yes (infrastructure layer) | Cannot serve persisted reads/writes; AI keeps stale RAM catalog until restart | All write operations (`POST`/`PUT`/`PATCH`/`DELETE`), migrations, and user auth until `M8_4_RECOVERY_VALIDATION.md` passes |
| **Priority 1** | **`core-service` (`:3001`)** | **Hard dependency** on `gastro_core` (`MONGODB_URI_CORE`) | Operates independently of `planning-service` & `ai-service` | Degrades cleanly if `ai-service` is down: search falls back to MongoDB regex, `/recommend/hybrid` falls back to geo/top-rated DB query, `/analyze-sentiment` falls back to keyword rules | `auth/register`, `auth/login`, `auth/refresh`, review writes, and restaurant writes blocked while `gastro_core` is corrupted or restoring |
| **Priority 2** | **`planning-service` (`:3003`)** | **Hard dependency** on `gastro_planning` (`MONGODB_URI_PLANNING`) + runtime ACL dependency on `core-service` | Read/recalculate existing itineraries without AI; generation requires `core-service` candidates | If `ai-service` is unreachable/timeouts, `AiApiClient` trips fallback to `Gastronomic Greedy Fallback` heuristic (never falls back on `401`/`403`/`422`) | Itinerary creation/completion mutations blocked during `gastro_planning` restore |
| **Priority 2 (Parallel)** | **`ai-service` (`:5000`)** | **Startup Read-Only** on `restaurants` (`MONGODB_URI`) | Serves stateless endpoints (`/routes/optimize`, `/analyze-sentiment`, `/predict-food`) even with empty DB | If DB unavailable at boot, `mongo.py` safely initializes empty DataFrame (`Active`/`Empty Data`) without crashing process; Open-Meteo timeout defaults to `28.0°C` | Hybrid & semantic restaurant recommendations degraded/empty until reloaded after `gastro_core.restaurants` recovery |
| **Priority 3 (Ingress)** | **`nginx-gateway` (`:8080`)** | None | Proxy layer only | Returns `502`/`504` if downstream services are offline; must remain paused/maintenance-gated during full DB swap | Public write routes disabled until Priority 0–2 pass smoke tests |

---

## 3. Service Recovery & Failover Strategy (M8.5.4)

### 3.1 Database Failover & Replica Set Considerations
- **Managed Production (Proposed Atlas M10+):** 3-node PSA/PSS Replica Set (`Primary + 2 Secondaries`) handles single-node hardware failure via automatic Raft-based election (`~10–30s`). Mongoose `serverSelectionTimeoutMS: 5000` reconnects automatically once a new Primary is elected (`retryWrites=true`).
- **Shared Tier (`M0/M2/M5`) Constraint:** No dedicated replica failover SLA or Cloud PITR; relies strictly on `M8_4_BACKUP_STRATEGY.md` logical `mongodump` archives and maintenance-window restores.

### 3.2 Dependency Startup & Recovery Ordering
1. Verify MongoDB connectivity & run [`M8_4_RECOVERY_VALIDATION.md`](./M8_4_RECOVERY_VALIDATION.md) Phases A–D before unblocking traffic.
2. Start **`core-service`** (`:3001`) and confirm `GET /health` + MongoDB read/write probe.
3. Start **`ai-service`** (`:5000`) **after** `gastro_core.restaurants` is verified clean so `load_dataset_from_mongo()` loads the clean catalog on startup (`restaurants_loaded > 0`), then re-trigger `POST` Core `syncInteractionsToAi` (`/cf/train`) if `user_interactions` recovered.
4. Start **`planning-service`** (`:3003`) once `core-service` is ready and verify `CORE_SERVICE_URL` + `INTERNAL_SERVICE_KEY` + `INTERNAL_AI_KEY`.
5. Re-enable public write routing on **`nginx-gateway`** (`:8080`) after Phase E smoke tests pass.

### 3.3 Retry, Timeout & Circuit Breaker Matrix
- **Implemented:**
  - `CoreApiClient`: `4000ms` timeout, immediate fail-closed propagation (`401`/`403` → `UnauthorizedException`, network/timeout → `503 ServiceUnavailableException`).
  - `AiApiClient`: `3500ms` timeout, per-call heuristic fallback (`Gastronomic Greedy Fallback`), strict pass-through on auth/schema errors (`401`/`403`/`400`/`422`).
  - `Nginx`: `5s` connect, `15s` auth read, `30s` API read; `max_fails=3 fail_timeout=10s`.
- **Proposed Future Hardening:** Add idempotent retry (max `2` retries, `100ms` jitter) strictly for `GET /internal/restaurants/*` in `CoreApiClient`; add stateful circuit-breaker cooldown window (`30s` open state) in `AiApiClient` & `RestaurantsService` to avoid compounding thread exhaustion during sustained AI outages.
