# GASTROWISE — MILESTONE 2.2: DOCKER RUNTIME & INTER-SERVICE NETWORKING VALIDATION REPORT

**Author:** Senior Backend & DevOps Engineer  
**Repositories:**  
- Backend: [`KLTN-123-GastroWise-BE`](https://github.com/maanxx/KLTN-123-GastroWise-BE)  
- AI Microservice: [`KLTN-123-GastroWise-AI`](https://github.com/thienthiencute/KLTN-123-GastroWise-AI)  
**Branch:** `fix/m2.2-runtime-validation` (branched from `main` baseline PR #10)  
**Execution Date:** November 24, 2026  
**Final Milestone Verdict:** **PASS WITH CONDITIONS**  

---

## 1. EXECUTIVE SUMMARY & VERDICT

The primary objective of **Milestone 2.2** was to validate the Docker container runtime, network topology, container healthchecks, and inter-service HTTP communication for the GastroWise microservices platform under strict local database isolation rules.

```
                              +---------------------------------------+
                              |         Ingress Traffic (Host)        |
                              +---------------------------------------+
                                                  |
                                            Port 8080:8080
                                                  v
                    +-----------------------------------------------------------+
                    |           API GATEWAY (nginx:1.27-alpine)                 |
                    |         gastrowise-nginx-gateway (Healthy)                |
                    |   Routes: /api/v1/itineraries -> planning_service         |
                    |           /api/v1/*           -> core_service             |
                    +-----------------------------------------------------------+
                                          /               \
              Docker Network (172.18.0.0/16)             Docker Network (172.18.0.0/16)
                                        /                   \
                                       v                     v
+------------------------------------------+    +------------------------------------------+
|       CORE SERVICE (NestJS 11)           |    |     PLANNING SERVICE (NestJS 11)         |
|      gastrowise-core-service (Healthy)   |    |  gastrowise-planning-service (Healthy)   |
|               IP: 172.18.0.4             |    |              IP: 172.18.0.5              |
|               Port: 3001                 |    |              Port: 3003                  |
+------------------------------------------+    +------------------------------------------+
      |                ^                                  |               |
      |                | X-Internal-Service-Key           |               |
      |                +----------------------------------+               |
      |                                                   |               | X-Internal-AI-Key
      |                                                   |               v
      |                                         +------------------------------------------+
      |                                         |       AI SERVICE (FastAPI / PyTorch)     |
      |                                         |       gastrowise-ai-service (Healthy)    |
      |                                         |              IP: 172.18.0.3              |
      |                                         |              Port: 5000                  |
      |                                         +------------------------------------------+
      |                                                               |
      | DB: gastro_core_test       DB: gastro_planning_test           | DB: gastro_ai_test
      +------------------------+-------------+------------------------+
                               |             |
                               v             v
                +------------------------------------------+
                |     LOCAL TEST DATABASE (MongoDB 7.0)    |
                |       gastrowise-mongo-test (Healthy)    |
                |               IP: 172.18.0.2             |
                |               Port: 27017                |
                +------------------------------------------+
```

### Key Execution Highlights:
1. **100% Database Isolation Verified:** No traffic touched MongoDB Atlas (`cluster01.adts0oq.mongodb.net`). All containers connected exclusively to an isolated local test container (`gastrowise-mongo-test:27017`) targeting `gastro_core_test`, `gastro_planning_test`, and `gastro_ai_test`.
2. **Container Build Verification:** All 3 application images (`gastrowise-core-service:test`, `gastrowise-planning-service:test`, `gastrowise-ai-service:test`) and base gateway image (`nginx:1.27-alpine`) built successfully with exit code `0`.
3. **Container Runtime & Healthcheck Status:** All 5 containers reached `healthy` Docker health status. An Alpine Linux IPv6 healthcheck anomaly was identified and remediated.
4. **Inter-Service Authentication & Mutual Handshakes:** Verified 100% pass for mutual secret authentication (`X-Internal-Service-Key` for Planning $\rightarrow$ Core, `X-Internal-AI-Key` for Planning $\rightarrow$ AI). Missing or invalid keys resulted in `401 Unauthorized` or `403 Forbidden`.
5. **Gateway Routing & Rewrites:** Gateway correctly routed `/health`, `/api/v1/restaurants`, `/api/v1/auth/login`, and `/api/v1/itineraries`. Legacy compatibility rewrites (`/restaurants`, `/itineraries`) functioned as designed.
6. **Verdict Justification (PASS WITH CONDITIONS):** All infrastructure, networking, container startup, and communication handshakes passed. The milestone is assigned **PASS WITH CONDITIONS** due to 5 documented blockers (contract mismatch, CORS origin reflection, missing user IDOR guard, unauthenticated contact admin endpoints, and AI fail-open fallback).

---

## 2. PHASE 1 — ENVIRONMENT PREFLIGHT & DATABASE ISOLATION

### 2.1. Host & Engine Diagnostics
- **Operating System:** macOS (Darwin arm64, Apple Silicon)
- **Docker Engine Version:** `29.6.2` (API `1.54`)
- **Docker Desktop Version:** `4.85.0` (Lifecycle: Running, VM healthy)
- **Docker Compose Version:** `v5.3.1` (Go compose plugin)
- **Port Availability Audit:**
  - `3001` (Core Service): Free on host (exposed only internally within container network)
  - `3003` (Planning Service): Free on host (exposed only internally within container network)
  - `5000` (AI Service): Free on host (exposed only internally within container network)
  - `8080` (API Gateway): Free on host, bound to `0.0.0.0:8080`
  - `27017` (Isolated MongoDB): Free on host (exposed only internally within container network)

### 2.2. Strict Database Isolation Verification
Before starting any container, configuration parameters were validated against production Atlas URLs:

```text
[Preflight Audit]
- Target Atlas cluster: cluster01.adts0oq.mongodb.net
- Effective MONGODB_URI_CORE: mongodb://mongo-test:27017/gastro_core_test
- Effective CORE_DB_NAME: gastro_core_test
- Effective MONGODB_URI_PLANNING: mongodb://mongo-test:27017/gastro_planning_test
- Effective PLANNING_DB_NAME: gastro_planning_test
- Effective MONGODB_URI (AI): mongodb://mongo-test:27017/gastro_ai_test
- Effective MONGODB_DB_NAME (AI): gastro_ai_test
- Atlas Connections Detected: 0
- Direct Host MongoDB Exposure: 0 (all DB ports confined to gastrowise_network)
```

**Preflight Verdict:** ✅ **PASS — Absolute database isolation confirmed.**

---

## 3. PHASE 2 — INDEPENDENT DOCKER IMAGE BUILD RESULTS

Every container image was compiled independently from its respective Dockerfile.

| Service | Dockerfile Path | Target Tag | Image ID | Virtual Size | Build Exit Code | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Core Service** | `apps/core-service/Dockerfile` | `gastrowise-core-service:test` | `afe6731b7621` | 392 MB | `0` | ✅ PASS |
| **Planning Service** | `apps/planning-service/Dockerfile` | `gastrowise-planning-service:test` | `64939fdfeaba` | 391 MB | `0` | ✅ PASS |
| **AI Service** | `KLTN-123-GastroWise-AI/Dockerfile` | `gastrowise-ai-service:test` | `829e329fa687` | 3.89 GB | `0` | ✅ PASS |
| **API Gateway** | `nginx/nginx.conf` | `nginx:1.27-alpine` | `33b497f394c8` | 46.5 MB | `0` | ✅ PASS |
| **Isolated DB** | Base Image | `mongo:7.0` | `43b96ff374fa` | 772 MB | `0` | ✅ PASS |

### Build Logs & Command Evidence:
- **Core Service Build:**
  ```bash
  docker build -t gastrowise-core-service:test -f apps/core-service/Dockerfile .
  # Outcome: Successfully built afe6731b7621, Exit Code: 0
  ```
- **Planning Service Build:**
  ```bash
  docker build -t gastrowise-planning-service:test -f apps/planning-service/Dockerfile .
  # Outcome: Successfully built 64939fdfeaba, Exit Code: 0
  ```
- **AI Service Build:**
  ```bash
  cd ../KLTN-123-GastroWise-AI && docker build -t gastrowise-ai-service:test .
  # Outcome: Successfully installed PyTorch, Torchvision, Ultralytics, Transformers.
  # Output: naming to docker.io/library/gastrowise-ai-service:test, Exit Code: 0
  ```

---

## 4. PHASE 3 — CONTAINER STARTUP & HEALTHCHECK VALIDATION

### 4.1. Orchestrated Container Inventory (`docker ps`)
```text
CONTAINER ID   IMAGE                               COMMAND                  CREATED         STATUS                   PORTS                                           NAMES
b438d15c7e39   nginx:1.27-alpine                   "/docker-entrypoint.…"   2 minutes ago   Up 2 minutes (healthy)   0.0.0.0:8080->8080/tcp, [::]:8080->8080/tcp     gastrowise-nginx-gateway
e7e163b0a70f   gastrowise-planning-service:test    "docker-entrypoint.s…"   2 minutes ago   Up 2 minutes (healthy)   3003/tcp                                        gastrowise-planning-service
580c8100ae01   gastrowise-ai-service:test          "uvicorn main:app --…"   2 minutes ago   Up 2 minutes (healthy)   5000/tcp                                        gastrowise-ai-service
c3e60656a812   gastrowise-core-service:test        "docker-entrypoint.s…"   2 minutes ago   Up 2 minutes (healthy)   3001/tcp                                        gastrowise-core-service
9d0046e7f8ab   mongo:7.0                           "docker-entrypoint.s…"   5 minutes ago   Up 5 minutes (healthy)   27017/tcp                                       gastrowise-mongo-test
```

### 4.2. Runtime Healthcheck Diagnosis & Fix
- **Issue Discovered:** When running under `node:24-alpine`, Alpine's default DNS resolver resolves `localhost` to IPv6 `::1` first. Because NestJS `listen(port)` binds to IPv4 `0.0.0.0:3001`, `wget http://localhost:3001/health` failed with `Connection refused`.
- **Remediation:** Updated healthcheck probe target to explicit IPv4 loopback `http://127.0.0.1:3001/health` and `http://127.0.0.1:3003/health` in Dockerfiles and `docker-compose.yml`.
- **Validation:** Both services immediately transitioned to `healthy` state.

---

## 5. PHASE 4 — INTER-SERVICE NETWORKING & AUTHENTICATION VALIDATION

All inter-service network tests were executed directly inside the container network namespace (`gastrowise_network`).

### 5.1. Docker DNS & TCP Connectivity Matrix
```text
+----------------------------+-----------------------+--------------+---------------+
| Source Container           | Target Hostname       | Resolved IP  | Ping RTT (ms) |
+----------------------------+-----------------------+--------------+---------------+
| gastrowise-planning-service| core-service          | 172.18.0.4   | 0.128 ms      |
| gastrowise-planning-service| ai-service            | 172.18.0.3   | 2.295 ms      |
| gastrowise-planning-service| mongo-test            | 172.18.0.2   | 0.066 ms      |
| gastrowise-core-service    | planning-service      | 172.18.0.5   | 0.051 ms      |
| gastrowise-core-service    | ai-service            | 172.18.0.3   | 0.053 ms      |
| gastrowise-core-service    | mongo-test            | 172.18.0.2   | 0.077 ms      |
+----------------------------+-----------------------+--------------+---------------+
```
Packet loss across all service pairs: **0.0%**.

---

### 5.2. Planning Service $\rightarrow$ Core Service Internal API
Target: `http://core-service:3001/api/v1/internal/restaurants/candidates`

| Test Scenario | Header Injected | HTTP Status | Response Payload | Verdict |
| :--- | :--- | :--- | :--- | :--- |
| **Missing Header** | None | `401 Unauthorized` | `{"message":"Missing internal service key credentials","statusCode":401}` | ✅ PASS |
| **Invalid Header** | `X-Internal-Service-Key: invalid_wrong_key` | `401 Unauthorized` | `{"message":"Invalid internal service key","statusCode":401}` | ✅ PASS |
| **Valid Mutual Key** | `X-Internal-Service-Key: [REDACTED_32_CHAR_SECRET]` | `200 OK` | `{"candidates":[],"total":0}` | ✅ PASS |

**Correlation ID Verification:** When Planning sent `X-Correlation-Id: cid-planning-core-test-999`, Core Service reflected and returned `X-Correlation-Id: cid-planning-core-test-999` in the HTTP response headers.

---

### 5.3. Planning Service $\rightarrow$ AI FastAPI Service
Target: `http://ai-service:5000/routes/optimize`

| Test Scenario | Header Injected | HTTP Status | Response Summary | Verdict |
| :--- | :--- | :--- | :--- | :--- |
| **Root Health** | None (`GET /`) | `200 OK` | `{"status":"GastroWise AI Microservice Running","restaurants_loaded":0}` | ✅ PASS |
| **Missing AI Key** | None | `401 Unauthorized` | `{"detail":"Missing X-Internal-AI-Key header"}` | ✅ PASS |
| **Invalid AI Key** | `X-Internal-AI-Key: wrong_key` | `403 Forbidden` | `{"detail":"Invalid internal AI service key"}` | ✅ PASS |
| **Valid Key (AI Schema)** | `X-Internal-AI-Key: [REDACTED_32_CHAR_SECRET]` | `200 OK` | `{"stops":[...],"total_distance_km":0.56,"algorithm_used":"Gastronomic Progression Heuristic"}` | ✅ PASS |
| **Valid Key (Nest DTO)** | `X-Internal-AI-Key: [REDACTED_32_CHAR_SECRET]` | `422 Unprocessable`| `{"detail":[{"loc":["body","start_location"],"msg":"Field required"},...]}` | ⚠️ CONTRACT MISMATCH |

---

## 6. PHASE 5 — API GATEWAY VALIDATION (PORT 8080)

Tested directly from host ingress (`http://localhost:8080`).

### 6.1. Route Ingress Table

| Endpoint Tested | Destination Service | Expected HTTP | Actual HTTP | Response Evidence |
| :--- | :--- | :--- | :--- | :--- |
| `GET /health` | Nginx Gateway | `200 OK` | `200 OK` | `{"status":"UP","gateway":"nginx-api-gateway"}` |
| `GET /api/v1/restaurants` | `core-service:3001` | `200 OK` | `200 OK` | `{"data":[],"total":0,"currentPage":1,"totalPages":0}` |
| `POST /api/v1/auth/login` | `core-service:3001` | `400 Bad Request`| `400 Bad Request`| `{"message":["password must be longer than or equal to 6 characters"]}` |
| `GET /api/v1/itineraries` | `planning-service:3003`| `401 Unauthorized`| `401 Unauthorized`| `{"message":"Unauthorized","statusCode":401}` |
| `GET /restaurants` (Legacy) | Rewrite $\rightarrow$ `/api/v1/restaurants` | `200 OK` | `200 OK` | `{"data":[],"total":0,"currentPage":1,"totalPages":0}` |
| `GET /itineraries` (Legacy) | Rewrite $\rightarrow$ `/api/v1/itineraries` | `401 Unauthorized`| `401 Unauthorized`| `{"message":"Unauthorized","statusCode":401}` |

### 6.2. Correlation ID Header Lifecycle
1. **Client Provided:**
   - Request: `curl -i -H "X-Correlation-Id: test-trace-client-12345" http://localhost:8080/health`
   - Response: `X-Correlation-Id: test-trace-client-12345`
2. **Client Omitted (Gateway Auto-Injection):**
   - Request: `curl -i http://localhost:8080/health`
   - Response: `X-Correlation-Id: 22bc9a21eea5fcaf65d46d99dbb400cd` (Nginx `$request_id` generated)

---

## 7. PHASE 6 — KNOWN BLOCKERS & SECURITY FINDINGS

During the execution of Milestone 2.2, five specific architectural and security findings were verified and documented. In accordance with safety rules, these fixes are documented with exact remediation paths without altering unrelated code during runtime validation.

---

### Finding 1: User IDOR Vulnerability (`GET /users/:id`)
- **File:** `apps/core-service/src/users/users.controller.ts` (lines 49-53)
- **Evidence:**
  ```typescript
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }
  ```
- **Severity:** 🚨 **HIGH** (Insecure Direct Object Reference / Information Disclosure — CWE-639)
- **Impact:** Any authenticated user with a valid JWT token can query any other user's ID (`GET /api/v1/users/<victim-id>`) and retrieve full personal profiles, email addresses, and dietary preferences.
- **Recommended Remediation:**
  Enforce caller ownership checks matching `update()`:
  ```typescript
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    const callerRole = req.user?.role || 'user';
    const callerId = req.user?.userId || req.user?.sub;
    if (callerRole !== 'admin' && callerId !== id) {
      throw new ForbiddenException('Access Denied: You can only view your own profile');
    }
    return this.usersService.findOne(id);
  }
  ```

---

### Finding 2: Unprotected Administrative Endpoints in Contacts Controller
- **File:** `apps/core-service/src/contacts/contacts.controller.ts` (lines 22-43)
- **Evidence:**
  ```typescript
  @Get()
  async findAll() { return this.contactsService.findAll(); }

  @Patch(':id')
  async updateStatus(...) { ... }

  @Delete(':id')
  async remove(...) { ... }
  ```
- **Severity:** 🚨 **CRITICAL** (Broken Access Control — CWE-306 / CWE-862)
- **Impact:** `findAll()`, `updateStatus()`, and `remove()` have zero guards. Anyone on the internet can list customer support inquiries, alter resolution audit logs, or permanently delete contact records.
- **Recommended Remediation:**
  Decorate `findAll()`, `updateStatus()`, and `remove()` with `@UseGuards(JwtAuthGuard, RolesGuard)` and `@Roles('admin')`. Leave only `POST /contacts` unauthenticated.

---

### Finding 3: Planning Service $\rightarrow$ AI Service Payload & Response Contract Inconsistency
- **Files:**
  - `libs/shared/src/contracts/ai.contracts.ts` (lines 28-45)
  - `apps/planning-service/src/acl/ai-api.client.ts` (lines 50-94)
  - `KLTN-123-GastroWise-AI/app/schemas/routing.py` (lines 18-53)
- **Evidence:**
  - **Payload Discrepancy:** Planning sends `restaurants`, `start_lat`, `start_lng`, `start_time` (string `"11:00"`), and `budget_vnd`. AI Service requires `candidates`, `start_location: [lat, lon]`, `start_time_mins` (integer `660`), and `budget`.
  - **Actual Execution Result:** Test 5 returned `HTTP 422 Unprocessable Entity` (`Field required: start_location`, `Field required: candidates`).
  - **Response Discrepancy:** AI Service returns `{ stops: [...] }`. Planning `AiApiClient.ts` expects `{ ordered_stops: [...] }`, causing response parsing to silently fail.
- **Severity:** 🚨 **HIGH** (Service Contract Breakage / Functional Failure)
- **Recommended Remediation:** Update `AiApiClient` transformation layer in Planning Service to properly adapt internal NestJS entities to FastAPI request schema, and map `data.stops` back to `RouteOptimizationResult`.

---

### Finding 4: Insecure Default in AI Service Authentication (Fail-Open)
- **File:** `KLTN-123-GastroWise-AI/app/core/auth.py` (lines 11-13)
- **Evidence:**
  ```python
  expected_key = os.getenv("INTERNAL_AI_KEY")
  if not expected_key:
      return True  # Permits dev traffic without authentication
  ```
- **Severity:** 🚨 **HIGH** (Authentication Bypass / Insecure Fallback — CWE-1188)
- **Impact:** If `INTERNAL_AI_KEY` is omitted or accidentally erased from container environment, the AI Service disables authentication entirely and permits unauthenticated requests rather than failing closed.
- **Recommended Remediation:**
  Change logic to fail-closed:
  ```python
  if not expected_key:
      raise HTTPException(
          status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
          detail="Internal configuration error: INTERNAL_AI_KEY is required",
      )
  ```

---

### Finding 5: API Gateway Arbitrary Origin Reflection with Credentials
- **File:** `nginx/nginx.conf` (lines 58-59)
- **Evidence:**
  ```nginx
  add_header 'Access-Control-Allow-Origin' '$http_origin' always;
  add_header 'Access-Control-Allow-Credentials' 'true' always;
  ```
  - Tested: Sending `Origin: https://malicious-website.com` returned `Access-Control-Allow-Origin: https://malicious-website.com` and `Access-Control-Allow-Credentials: true`.
- **Severity:** 🚨 **CRITICAL** (CORS Misconfiguration — CWE-942)
- **Impact:** Any attacker website can perform authenticated, credentialed cross-origin AJAX requests against GastroWise APIs.
- **Recommended Remediation:**
  Use an explicit origin map whitelist in Nginx:
  ```nginx
  map $http_origin $cors_origin {
      default "";
      "http://localhost:3000" "$http_origin";
      "http://localhost:8081" "$http_origin";
      "http://localhost:19006" "$http_origin";
  }
  ...
  add_header 'Access-Control-Allow-Origin' $cors_origin always;
  ```

---

## 8. MILESTONE VERDICT & NEXT STEPS

### Final Verdict: **PASS WITH CONDITIONS**
- **Full Infrastructure Pass:**
  - Multi-service Docker container topology running and healthy.
  - Zero leakage to MongoDB Atlas; 100% database isolation verified.
  - Inter-service networking, Docker DNS, routing, and header propagation verified.
- **Conditions to Resolve in Milestone 2.3:**
  1. Fix Planning $\rightarrow$ AI schema mismatch (`ai.contracts.ts` / `ai-api.client.ts`).
  2. Implement explicit CORS origin whitelist in `nginx.conf`.
  3. Patch IDOR vulnerability on `GET /users/:id`.
  4. Protect administrative contact endpoints with `JwtAuthGuard` and `RolesGuard`.
  5. Enforce fail-closed authentication in AI Service `auth.py`.

**Stop Point:** Milestone 2.2 is complete. Test containers remain running for verification. Do NOT push to `main` and do NOT run database migrations. Awaiting Tech Lead review.
