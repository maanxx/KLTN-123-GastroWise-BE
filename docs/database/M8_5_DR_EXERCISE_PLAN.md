# M8.5 — Staging-Only Disaster Recovery Exercise Plan

- **Repository:** `maanxx/KLTN-123-GastroWise-BE`
- **Target Environment:** **ISOLATED STAGING / LOCAL DOCKER (`docker-compose.yml` + `mongo:7.0`) ONLY** — strictly forbidden against production MongoDB Atlas.
- **Execution Status in M8.5:** **PLANNED ONLY — NOT EXECUTED IN THIS MILESTONE** *(awaiting Tech Lead sign-off).*

---

## Exercise Matrix (M8.5.6)

### Exercise 1 — MongoDB Outage Simulation (Isolated Staging)
- **Preconditions:** Staging Compose stack running (`mongo-test`, `core-service`, `planning-service`, `ai-service`, `nginx-gateway`) with seeded test data and baseline health `200`.
- **Test Steps:**
  1. Stop `mongo-test` container (`docker compose stop mongo-test`).
  2. Issue `POST /api/v1/auth/login`, `GET /api/v1/restaurants`, `GET /api/v1/itineraries`, and AI `POST /recommend/hybrid` (internal).
  3. Restart `mongo-test` (`docker compose start mongo-test`) and wait for `service_healthy`.
  4. Re-issue the same API requests.
- **Expected Results:** During outage, Mongoose times out (`5000ms` serverSelection) and returns controlled `5xx` errors without crashing NestJS processes; AI continues answering from cached RAM catalog. After `mongo-test` recovers, Core & Planning reconnect automatically without container rebuild.
- **Evidence to Collect:** Gateway status codes before/during/after outage, container restart count (`0` crashes on NestJS), timestamps measuring reconnection time.
- **Pass/Fail Criteria:** PASS iff Core/Planning resume 100% DB read/write automatically after DB restart with `0` uncaught process crashes.
- **Cleanup / Restoration:** Verify clean `mongo-test` state and re-run API smoke test.

### Exercise 2 — Service Restart Simulation (`core-service` & `ai-service`)
- **Preconditions:** Full staging Compose stack healthy; note `restaurants_loaded` on `ai-service` `GET /`.
- **Test Steps:**
  1. Stop `ai-service` (`docker compose stop ai-service`); call Core personalized recommendations & Planning itinerary generation.
  2. Restart `ai-service`, wait for `GET /` `Active`.
  3. Restart `core-service` and test Nginx failover recovery (`fail_timeout=10s`).
- **Expected Results:** While AI is down, Core falls back to geo/top-rated DB recommendations and Planning trips `AiApiClient` circuit breaker to `Gastronomic Greedy Fallback` (`solver = "Gastronomic Greedy Fallback"`). Once restarted, `ai-service` reloads catalog and OR-Tools resumes.
- **Evidence to Collect:** Response JSON proving fallback `solver` tag, Core/Planning JSON logs containing `X-Correlation-Id`, recovery timestamps.
- **Pass/Fail Criteria:** PASS iff zero `500` crashes on Planning itinerary generation during AI outage, and AI restores `OR-Tools TSPTW` within `<= 30s` of container restart.
- **Cleanup / Restoration:** Ensure all 5 Compose containers show `healthy` / `running`.

### Exercise 3 — Failed Schema Migration Simulation (Aligned with M8.3)
- **Preconditions:** Staging snapshot backed up via `mongodump` (`M8_4_BACKUP_STRATEGY.md`); synthetic duplicate `{ userId, restaurantId }` row injected into staging `reviews` to force an `E11000` failure during unique index build.
- **Test Steps:**
  1. Trigger staging migration wave targeting `reviews` unique index without pre-dedup.
  2. Observe expected migration abort (`E11000`) and verify `schema_migrations` marks failure.
  3. Execute M8.3/M8.4 Scenario 4 rollback procedure + restore pre-migration archive.
- **Expected Results:** Runner halts cleanly without corrupting valid reviews; pre-migration archive restores exact pre-test review count.
- **Evidence to Collect:** Runner stdout failure log, `schema_migrations` state, pre- vs post-rollback `reviews.countDocuments()`.
- **Pass/Fail Criteria:** PASS iff post-rollback document counts and indexes match pre-migration snapshot 100%.
- **Cleanup / Restoration:** Delete injected synthetic duplicate document after verification.

### Exercise 4 — Backup Restoration Verification (`mongodump` → `mongorestore`)
- **Preconditions:** Fresh `mongodump --archive --gzip` taken from seeded staging `gastro_core_test` and `gastro_planning_test`.
- **Test Steps:**
  1. Record pre-backup counts and `sha256sum` of archives.
  2. Drop staging DBs (`db.dropDatabase()` in isolated staging container **ONLY**).
  3. Execute [`M8_4_RESTORE_RUNBOOK.md`](./M8_4_RESTORE_RUNBOOK.md) Scenario 1 + restart `ai-service`.
  4. Execute [`M8_4_RECOVERY_VALIDATION.md`](./M8_4_RECOVERY_VALIDATION.md) Phases A–F.
- **Expected Results:** All collections, Vietnamese UTF-8 strings, `2dsphere` + unique indexes restore cleanly; measured total RTO fits `<= 30 min` Tier-1 target.
- **Evidence to Collect:** Checksums, `mongorestore` summary log, `getIndexes()` output, RTO timing table (`T_fetch`, `T_restore`, `T_verify`).
- **Pass/Fail Criteria:** PASS iff 100% document/index parity and `<= 30 min` RTO achieved.
- **Cleanup / Restoration:** Re-seed default staging fixture state if modified during drill.

### Exercise 5 — Inter-Service Connectivity & Auth Mismatch Recovery
- **Preconditions:** Running staging stack.
- **Test Steps:**
  1. Temporarily inject mismatched `INTERNAL_AI_KEY` into staging `planning-service` container env and restart `planning-service`.
  2. Trigger itinerary generation → confirm fail-closed `HTTP 401`/`403` error (never falling back silently to greedy heuristic!).
  3. Restore matching `INTERNAL_AI_KEY`, restart `planning-service`, and re-test.
- **Expected Results:** Invalid key surfaces `UnauthorizedException`/`ForbiddenException` immediately with redacted logs; restoring matching key immediately restores `OR-Tools TSPTW`.
- **Evidence to Collect:** Planning error JSON response + logs confirming zero key value leakage + post-fix `201`/`200` itinerary response.
- **Pass/Fail Criteria:** PASS iff `401`/`403` is never masked by fallback and recovery completes cleanly once key matches.
- **Cleanup / Restoration:** Verify staging `.env` matches baseline secret alignment.

### Exercise 6 — Post-Recovery End-to-End API Smoke Suite
- **Preconditions:** Staging stack restored cleanly from Exercise 4/5.
- **Test Steps:** Execute automated E2E contract/integration smoke calls through `nginx-gateway` (`:8080`):
  - `GET /health`
  - `POST /api/v1/auth/register` & `/login`
  - `GET /api/v1/restaurants/nearby`
  - `GET /api/v1/restaurants` (personalized hybrid)
  - `POST /api/v1/itineraries/generate`
- **Expected Results:** All HTTP status codes `200`/`201`, hydrated restaurant fields + AI scores + 1-based `stops[].order_index` (`[1, 2, ...]`), valid `X-Correlation-Id` headers.
- **Evidence to Collect:** Automated test runner output + response payload snapshots (redacted of tokens).
- **Pass/Fail Criteria:** PASS iff `100%` of critical smoke endpoints succeed.
- **Cleanup / Restoration:** Clean up test user/itinerary rows created during smoke run.
