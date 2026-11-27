# GASTROWISE — MILESTONE 2.3: BACKEND MICROSERVICES INTEGRATION & SECURITY HARDENING REPORT

**Author:** Senior Backend Architect, Security Engineer & DevOps Engineer  
**Date:** November 24, 2026  
**Repositories:**  
- Backend: [`maanxx/KLTN-123-GastroWise-BE`](https://github.com/maanxx/KLTN-123-GastroWise-BE)  
- AI Microservice: [`thienthiencute/KLTN-123-GastroWise-AI`](https://github.com/thienthiencute/KLTN-123-GastroWise-AI)  
**Working Branch:** `fix/m2.3-backend-integration-security` (branched from remote HEAD `3017fdf` on `fix/m2.2-runtime-validation`)  
**Final Milestone Verdict:** **FULL PASS**

---

## 1. EXECUTIVE SUMMARY & VERDICT

Milestone 2.3 successfully hardens the GastroWise microservices backend architecture, eliminates all security vulnerabilities identified during Milestone 2.2 runtime validation, harmonizes the Planning Service $\rightarrow$ AI Service route optimization contract, and delivers verified end-to-end integration across all containerized services.

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
                    |   • Strict CORS Whitelist Map (No Wildcard + Credentials) |
                    |   • Preflight OPTIONS 204 with Origin & Max-Age Cache     |
                    |   • Ingress Correlation ID Injection ($corr_id)           |
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
|   • IDOR Protected (GET/PATCH /users/:id)|    |   • Canonical AI Request/Response Adapter|
|   • SafeUserResponseDto (No secrets leak)|    |   • Fail-Closed Auth & Schema Validation |
|   • Contacts RBAC (Admin-only + JWT audit|    |   • Circuit Breaker (3500ms Fallback)    |
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
      |                                         |   • Fail-Closed Auth (401/403 timing-safe|
      |                                         |   • Dual Compatibility (stops + ordered) |
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

### Milestone Scorecard

| Area | Evaluation Item | Milestone 2.2 Baseline | Milestone 2.3 Status | Evidence / Verification |
| :--- | :--- | :---: | :---: | :--- |
| **Security** | User IDOR Vulnerability | Missing (`GET /users/:id` open) | **RESOLVED** | Forbidden (403) on cross-tenant access; Admin bypass permitted |
| **Security** | User Credential Leakage | Passwords/tokens exposed | **RESOLVED** | `SafeUserResponseDto` strips password, tokens, OTP secrets |
| **Security** | Contacts Administrative RBAC | Unauthenticated (`GET /contacts` open) | **RESOLVED** | Protected by `JwtAuthGuard`, `RolesGuard`, `@Roles('admin')` |
| **Security** | Contacts Audit Trail Forgery | Client-supplied `resolvedBy` trusted | **RESOLVED** | Derived strictly from authenticated JWT (`req.user.email`) |
| **Security** | Ingress Gateway CORS Policy | Arbitrary `$http_origin` reflection | **RESOLVED** | Explicit whitelist mapping; unlisted origins stripped of CORS |
| **Security** | AI Internal Authentication | Open when key unset | **RESOLVED** | Fail-closed: raises HTTP 500 on start; 401 on missing; 403 on invalid |
| **Integration**| Planning $\rightarrow$ AI Contract | Payload mismatch (422 error) | **RESOLVED** | Canonical adapter transforms DTO; AI dual-supports both shapes |
| **Reliability**| AI Circuit Breaker Behavior | Undifferentiated fallback | **RESOLVED** | 400/401/403/422 never fallback; only 5xx/timeouts trigger fallback |
| **Runtime** | Docker Compose Topology | 5/5 containers running | **PASS** | 5/5 healthy containers, zero restarts or crash loops |
| **Database** | Isolation Guarantee | 100% Local MongoDB | **PASS** | Zero Atlas requests; test databases strictly partitioned |

---

## 2. DETAILED SECURITY HARDENING FINDINGS & REMEDIATION

### 2.1 User IDOR & Information Leakage Prevention

- **Affected File:** `apps/core-service/src/users/users.controller.ts`, `apps/core-service/src/users/schemas/user.schema.ts`
- **New DTO:** `apps/core-service/src/users/dto/safe-user-response.dto.ts`
- **Vulnerability:** Prior to M2.3, any authenticated user could query any other user's full database document via `GET /users/:id`, exposing sensitive internal fields (`password`, `hashedRefreshToken`, `twoFactorSecret`, `resetOtp`).
- **Remediation Implemented:**
  1. Enforced ownership check in `findOne`:
     ```typescript
     const callerRole = req.user?.role || 'user';
     const callerId = req.user?.userId || req.user?.sub;
     if (callerRole !== 'admin' && callerId !== id) {
       throw new ForbiddenException('Access Denied: You can only view your own profile');
     }
     ```
  2. Implemented `SafeUserResponseDto` and `toSafeUser(user)` stripper function that extracts only safe public/profile fields.
  3. Hardened `user.schema.ts` `toJSON` and `toObject` transform functions to delete `password`, `hashedRefreshToken`, `twoFactorSecret`, and `resetOtp`.
- **Live Verification:**
  - Non-owner request (`userToken` for ID `650c...1111` querying ID `650c...9999`):
    ```
    HTTP/1.1 403 Forbidden
    {"message":"Access Denied: You can only view your own profile","error":"Forbidden","statusCode":403}
    ```
  - Admin request (`adminToken` querying ID `650c...9999`):
    ```
    HTTP/1.1 404 Not Found (Allowed through IDOR check; user not found in local test DB)
    ```
- **Automated Tests:** `apps/core-service/src/users/users.controller.spec.ts` (7/7 passed).

---

### 2.2 Contacts RBAC & Audit Trail Forgery Prevention

- **Affected File:** `apps/core-service/src/contacts/contacts.controller.ts`
- **New Test File:** `apps/core-service/src/contacts/contacts.controller.spec.ts`
- **Vulnerability:** `GET /contacts`, `PATCH /contacts/:id`, and `DELETE /contacts/:id` had no guards, allowing unauthenticated public access. Additionally, `PATCH /contacts/:id` accepted `resolvedBy` directly from the client request body, allowing arbitrary identity spoofing in the audit trail.
- **Remediation Implemented:**
  1. Kept `POST /contacts` public for legitimate user feedback, backed by `CreateContactDto` validation.
  2. Applied `@UseGuards(JwtAuthGuard, RolesGuard)` and `@Roles('admin')` to `GET`, `PATCH`, and `DELETE`.
  3. Extracted `adminIdentity` strictly from the authenticated JWT token (`req.user?.email || req.user?.userId`), completely ignoring client-supplied `body.resolvedBy`.
- **Live Verification:**
  - Unauthenticated `GET /api/v1/contacts`:
    ```
    HTTP/1.1 401 Unauthorized
    {"message":"Unauthorized","statusCode":401}
    ```
  - Authenticated Normal User (`role: 'user'`) `GET /api/v1/contacts`:
    ```
    HTTP/1.1 403 Forbidden
    {"message":"Forbidden resource","error":"Forbidden","statusCode":403}
    ```
  - Authenticated Admin User (`role: 'admin'`) `GET /api/v1/contacts`:
    ```
    HTTP/1.1 200 OK
    []
    ```
- **Automated Tests:** `apps/core-service/src/contacts/contacts.controller.spec.ts` (8/8 passed).

---

### 2.3 Gateway CORS Origin Whitelisting

- **Affected File:** `nginx/nginx.conf`
- **Vulnerability:** The previous gateway configuration reflected `$http_origin` dynamically with `Access-Control-Allow-Credentials: true`, permitting cross-site request forgery and data exfiltration from any arbitrary attacker website.
- **Remediation Implemented:**
  1. Configured Nginx `map $http_origin $cors_allowed_origin` supporting:
     - `localhost:[0-9]+` (Local developer portals, Vite, Next.js, React Native Metro)
     - `127.0.0.1:[0-9]+`
     - `https://gastrowise.vn`
     - `https://admin.gastrowise.vn`
     - `https://api.gastrowise.vn`
  2. Configured conditional credentials mapping `map $cors_allowed_origin $cors_allow_credentials` ensuring unauthorized origins receive neither `Access-Control-Allow-Origin` nor `Access-Control-Allow-Credentials`.
  3. Preflight `OPTIONS` requests return `204 No Content` with cached `Access-Control-Max-Age: 86400`.
- **Live Verification:**
  - Whitelisted Origin (`Origin: http://localhost:3000`):
    ```
    HTTP/1.1 204 No Content
    Access-Control-Allow-Origin: http://localhost:3000
    Access-Control-Allow-Credentials: true
    Access-Control-Max-Age: 86400
    ```
  - Malicious Origin (`Origin: https://evil-attacker.com`):
    ```
    HTTP/1.1 204 No Content
    X-Correlation-Id: 5843aa9183b490cc9b0912681a0211a7
    (No Access-Control-Allow-Origin header returned)
    (No Access-Control-Allow-Credentials header returned)
    ```

---

### 2.4 AI Internal Authentication Fail-Closed Mechanism

- **Affected File:** `app/core/auth.py` in `thienthiencute/KLTN-123-GastroWise-AI`
- **Vulnerability:** Previously, if `INTERNAL_AI_KEY` was missing from the environment, requests could bypass validation.
- **Remediation Implemented:**
  1. If `INTERNAL_AI_KEY` is not configured, the authenticator raises `HTTPException(status_code=500)` immediately (fail-closed).
  2. Missing `X-Internal-AI-Key` header returns `HTTP 401 Unauthorized`.
  3. Invalid key returns `HTTP 403 Forbidden`.
  4. Timing-safe comparison using `secrets.compare_digest(api_key, internal_key)` prevents side-channel timing attacks.
- **Live Verification:**
  - Call without key from `gastrowise-planning-service`:
    ```
    HTTP/1.1 401 Unauthorized
    ```
  - Call with invalid key `X-Internal-AI-Key: invalid-key`:
    ```
    HTTP/1.1 403 Forbidden
    ```
  - Call with valid key `X-Internal-AI-Key: gastrowise_ai_secret_internal_token_32chars`:
    ```
    HTTP/1.1 200 OK
    ```
- **Automated Tests:** `test_internal_auth.py` in AI repo (4/4 passed).

---

## 3. PLANNING $\rightarrow$ AI SERVICE INTEGRATION CONTRACT HARMONIZATION

### 3.1 Canonical Contract Definition

- **Shared Contracts File:** `libs/shared/src/contracts/ai.contracts.ts`
- **Canonical Outbound Shape:**
  ```typescript
  export class RouteOptimizeCanonicalRequest {
    start_location: [number, number]; // [lat, lon]
    start_time_mins?: number;          // Minutes from midnight (e.g., 660 = 11:00 AM)
    budget?: number;                  // VND amount
    routing_mode?: string;             // 'motorbike' | 'car' | 'walking'
    desired_stops?: number;
    max_duration_mins?: number;
    candidates: CandidateStopItem[];   // Normalized candidate pool
  }
  ```

### 3.2 Planning Service Adapter Layer

- **Affected File:** `apps/planning-service/src/acl/ai-api.client.ts`
- Implemented `mapToCanonicalAiRequest`:
  - Translates `start_lat`, `start_lng` $\rightarrow$ `start_location: [lat, lng]`.
  - Parses string `start_time` ("11:00") into minutes integer `start_time_mins` (660).
  - Normalizes candidate list from `restaurants` to `candidates` with fallback fields.
- Implemented robust response parsing:
  - Supports modern AI responses with `stops` as well as legacy `ordered_stops`.
  - Normalizes `arrival_time`, `departure_time`, `transit_time_mins`, and `distance_km`.

### 3.3 AI Service Dual Compatibility

- **Affected File:** `app/schemas/routing.py` in AI repo
- Added Pydantic `@model_validator(mode='before')` to accept both canonical and legacy formats:
  - Maps `restaurants` $\rightarrow$ `candidates`
  - Maps `start_lat`, `start_lng` $\rightarrow$ `start_location`
  - Maps `lng` $\rightarrow$ `lon`
  - Maps `open` $\rightarrow$ `open_time`, `close` $\rightarrow$ `close_time`, `duration_mins` $\rightarrow$ `dining_duration_mins`
- Added `@model_validator(mode='after')` to automatically mirror `stops` into `ordered_stops` in `RouteOptimizeResponse`.
- **Automated Tests:** `test_routing_contract.py` in AI repo (3/3 passed).

### 3.4 Circuit Breaker & Fallback Differentiation

Prior to M2.3, any error (including authentication failures or validation errors) was caught by a generic `catch` block that tripped the circuit breaker and generated a fake greedy route. This disguised critical integration faults as successful operations.

**Hardened Rule Matrix:**

| Error Condition | HTTP Code / Error | Circuit Breaker Action | Resulting Client Exception |
| :--- | :---: | :---: | :--- |
| Missing AI Auth Key | 401 | **DO NOT FALLBACK** | `UnauthorizedException` |
| Invalid AI Auth Key | 403 | **DO NOT FALLBACK** | `ForbiddenException` |
| Contract Schema Validation | 400 / 422 | **DO NOT FALLBACK** | `BadRequestException` |
| AI Service Downtime | 5xx | **TRIP CIRCUIT BREAKER** | Gastronomic Greedy Heuristic Fallback |
| AI Service Timeout (>3500ms)| `ECONNABORTED` | **TRIP CIRCUIT BREAKER** | Gastronomic Greedy Heuristic Fallback |
| Connection Refused | `ECONNREFUSED` | **TRIP CIRCUIT BREAKER** | Gastronomic Greedy Heuristic Fallback |

**Live Verification:**
- When `gastrowise-ai-service` was intentionally paused (`docker pause gastrowise-ai-service`), `gastrowise-planning-service` logged:
  ```
  WARN [AiApiClient] {"timestamp":"2026-11-24T14:46:48.177Z","level":"WARN","context":"AiApiClient","method":"POST","url":"http://ai-service:5000/routes/optimize","status":"NETWORK_ERROR","code":"ECONNABORTED","durationMs":3509,"correlationId":"0af7c3ff-c1fc-4744-bb2d-2b0c22574bf9","message":"AI Route Optimizer unavailable (timeout of 3500ms exceeded). Tripping circuit breaker to Greedy Heuristic."}
  ```
  The itinerary was successfully generated via greedy heuristic with zero client downtime.
- When AI service was unpaused, requests completed in **4ms** with `HTTP 200 OK` via `Gastronomic Progression Heuristic`.

---

## 4. DOCKER RUNTIME & INTER-SERVICE VALIDATION

### 4.1 Container Health & Status Summary

All 5 microservice containers are healthy, running on the dedicated bridge network `gastrowise_network`:

| Container Name | Image Tag | Status | Exposed Ports | Healthcheck Test |
| :--- | :--- | :---: | :--- | :--- |
| `gastrowise-mongo-test` | `mongo:7.0` | `Up 35m (healthy)` | `27017/tcp` | `mongosh db.adminCommand('ping')` |
| `gastrowise-core-service` | `gastrowise-core-service:test` | `Up 12m (healthy)` | `3001/tcp` | `wget -qO- http://127.0.0.1:3001/health` |
| `gastrowise-planning-service` | `gastrowise-planning-service:test` | `Up 12m (healthy)` | `3003/tcp` | `wget -qO- http://127.0.0.1:3003/health` |
| `gastrowise-ai-service` | `gastrowise-ai-service:test` | `Up 12m (healthy)` | `5000/tcp` | `curl -f http://localhost:5000/` |
| `gastrowise-nginx-gateway` | `nginx:1.27-alpine` | `Up 10m (healthy)` | `0.0.0.0:8080->8080` | `wget -qO- http://127.0.0.1:8080/health` |

### 4.2 End-to-End Route Validation

| Route | Ingress Host | Method | Auth / Headers | HTTP Status | Response Summary |
| :--- | :--- | :---: | :--- | :---: | :--- |
| `/health` | Gateway (8080) | GET | Public | **200 OK** | `{"status":"UP","gateway":"nginx-api-gateway"}` |
| `/api/v1/restaurants` | Gateway (8080) | GET | Public | **200 OK** | Paginated catalog from Core Service |
| `/restaurants` (Legacy) | Gateway (8080) | GET | Public | **200 OK** | Backward-compatible catalog rewrite |
| `/api/v1/contacts` | Gateway (8080) | POST | Public | **400 / 201** | Input DTO validation active |
| `/api/v1/contacts` | Gateway (8080) | GET | None | **401 Unauthorized** | Blocked without JWT |
| `/api/v1/contacts` | Gateway (8080) | GET | User JWT | **403 Forbidden** | RBAC active; normal users blocked |
| `/api/v1/contacts` | Gateway (8080) | GET | Admin JWT | **200 OK** | Authorized admin access |
| `/api/v1/users/:id` | Gateway (8080) | GET | Non-owner JWT | **403 Forbidden** | IDOR blocked: "Access Denied" |
| `/api/v1/users/:id` | Gateway (8080) | GET | Admin JWT | **404 / 200** | Admin bypass permitted |
| `/api/v1/itineraries/generate` | Gateway (8080) | POST | User JWT | **201 Created** | Full Planning $\rightarrow$ Core $\rightarrow$ AI pipeline execution |

---

## 5. AUTOMATED TEST SUITE SUMMARY

### Backend Repository (`KLTN-123-GastroWise-BE`)

```bash
# Core Service Full Test Suite (All 14 test suites)
npx jest apps/core-service
Test Suites: 14 passed, 14 total
Tests:       64 passed, 64 total

# Planning Service Full Test Suite (All 5 test suites)
npx jest apps/planning-service
Test Suites: 5 passed, 5 total
Tests:       31 passed, 31 total

# Microservices TypeScript Build Verification
npm run build:shared && npm run build:planning && npm run build:core
Result: 0 errors, 0 warnings
```

### AI Repository (`KLTN-123-GastroWise-AI`)

```bash
# Internal AI Key Fail-Closed Tests
./.venv/bin/python test_internal_auth.py
Ran 4 tests in 0.001s -> OK

# Pydantic Canonical & Dual Compatibility Schema Tests
./.venv/bin/python test_routing_contract.py
Ran 3 tests in 0.003s -> OK
```

---

## 6. RESIDUAL RISKS & NEXT STEPS

1. **Production Deployment Origin Whitelist:**  
   The Nginx allowlist currently permits `localhost:[0-9]+` and `127.0.0.1:[0-9]+` to accelerate local developer workflows. When preparing production Kubernetes / Cloud Run manifests, restrict allowed origins to `https://gastrowise.vn` and `https://admin.gastrowise.vn`.
2. **MongoDB Atlas Migration (Sprint 3):**  
   Database isolation rules were strictly observed: zero connections were made to Atlas during M2.3. The production migration scripts (`scripts/db-split-dryrun.ts`) should be executed during scheduled maintenance in Sprint 3.
3. **Mobile App Gateway Prefix Alignment (Milestone 6):**  
   `KLTN-123-GastroWise-Mobile/.env` currently points to port 3001 (Core Service) and should be updated to API Gateway port 8080 during Milestone 6.
4. **Historical Credential Revocation:**  
   The historical credentials referenced in commit `f6bc66fc` must be revoked/deleted directly on the MongoDB Atlas console.

---

## 7. MILESTONE 2.3.1 DEEP CODE REVIEW FINDINGS & FIXES

| Finding ID | Priority | Affected File | Root Cause | Implemented Resolution | Verification |
| :--- | :---: | :--- | :--- | :--- | :--- |
| **DEFECT-M231-01** | **P1** | `apps/core-service/src/restaurants/restaurants.service.ts` | Calls to `/predict-food`, `/weather-recommend`, and `/recommend` omitted `X-Internal-AI-Key` header | Added `'X-Internal-AI-Key': this.internalAiKey` to all outbound HTTP calls | All calls now pass fail-closed AI auth |
| **DEFECT-M231-02** | **P2** | `apps/core-service/src/restaurants/restaurants.service.spec.ts` | `MenuItemModel` and `findOne` mock missing from unit test setup | Added `MenuItemModel`, `findOne`, and `INTERNAL_AI_KEY` mock | 7/7 tests passed |
| **DEFECT-M231-03** | **P2** | `apps/core-service/src/restaurants/restaurants.controller.spec.ts` | `RestaurantsService` dependencies unmocked | Injected mock provider for `RestaurantsService` | 1/1 test passed |
| **DEFECT-M231-04** | **P2** | `apps/core-service/src/reviews/reviews.service.spec.ts` | `ReviewModel`, `RestaurantModel`, and services unmocked | Injected all required Mongoose and service mock tokens | 1/1 test passed |
| **DEFECT-M231-05** | **P2** | `apps/core-service/src/reviews/reviews.controller.spec.ts` | `ReviewsService` dependencies unmocked | Injected mock provider for `ReviewsService` | 1/1 test passed |

---

## 8. FINAL VERDICT

# FULL PASS — READY FOR PR (WITH CONDITIONS)

All code review checks, security hardening requirements, contract harmonizations, unit test suites (95/95 tests passing across both services), and Docker runtime healthchecks have passed. The branch `fix/m2.3-backend-integration-security` is ready for review and pull request creation upon human approval.
