# GASTROWISE — MILESTONE 1: SECURITY & CONFIGURATION HARDENING REPORT

**Author:** Senior Backend Security Engineer  
**Repository:** [KLTN-123-GastroWise-BE](https://github.com/maanxx/KLTN-123-GastroWise-BE)  
**Branch:** `refactor/microservices-backend`  
**Date:** November 20, 2026  
**Status:** ✅ COMPLETED & AUDITED  

---

## 1. FINDINGS FIXED

| ID | Category | Severity | Description | Remediation Applied |
| :--- | :--- | :---: | :--- | :--- |
| **SEC-01** | Secrets & Credentials | **CRITICAL** | Hardcoded default secrets in `docker-compose.yml` (`changeme-production-secret...`, `internal-sec-key...`, `ai-secret-key...`) | Replaced with mandatory environment variable expressions `${VAR:?VAR must be set}`. Docker Compose will fail fast on startup if secrets are omitted. |
| **SEC-02** | Secrets & Credentials | **HIGH** | Fallback key in `CoreApiClient` (`process.env.INTERNAL_SERVICE_KEY \|\| 'default-secret-change-in-production'`) | Removed hardcoded fallback. Constructor throws fast if `INTERNAL_SERVICE_KEY` is not configured. |
| **SEC-03** | Secrets & Credentials | **HIGH** | Fallback secret in `AuthService` (`configService.get('JWT_SECRET') \|\| 'gastrowise_jwt_secret'`) | Removed hardcoded fallback. Throws fast with explicit configuration error if `JWT_SECRET` is missing. |
| **SEC-04** | Secrets & Credentials | **HIGH** | Optional `INTERNAL_AI_KEY` in `AiApiClient` allowing silent unauthenticated requests | Removed optional fallback. Constructor enforces presence of `INTERNAL_AI_KEY` or fails fast. |
| **SEC-05** | Service Boundary & Auth | **CRITICAL** | `InternalAuthGuard` lacked server-side configuration presence check | Added explicit check verifying `process.env.INTERNAL_SERVICE_KEY` exists on server before comparison; returns HTTP 401 with structured message if missing. Preserved constant-time `crypto.timingSafeEqual`. |
| **SEC-06** | Fault Tolerance & Data Integrity | **CRITICAL** | Silent failure in `CoreApiClient.getCandidates` returning `[]` on HTTP 401, 500, or timeouts, causing empty itineraries to be persisted | Implemented structured error handler: differentiates 401/403 (`UnauthorizedException`), timeout / 503 / connection refused (`ServiceUnavailableException`), 500 (`BadGatewayException`), and 404 (`[]`). |
| **SEC-07** | Fault Tolerance & Security | **CRITICAL** | `AiApiClient` tripped circuit breaker and fell back to heuristic on HTTP 401/403, silently masking authentication failures | Explicitly catches HTTP 401/403 and immediately throws `UnauthorizedException` without falling back. Circuit breaker now activates strictly on timeouts (3500ms) or 5xx/network errors. |
| **SEC-08** | Observability & Audit | **MEDIUM** | Missing distributed tracing and correlation propagation in inter-service calls | Implemented `X-Correlation-Id` forwarding/generation in both `CoreApiClient` and `AiApiClient`, accompanied by structured JSON log records (timestamp, level, status, durationMs, cid). |
| **SEC-09** | Token Security | **MEDIUM** | Inconsistent JWT validation parameters between Core Service and Planning Service | Standardized `issuer: 'gastrowise-auth'`, `audience: 'gastrowise-api'`, and `ignoreExpiration: false` in both `JwtStrategy` providers and in `AuthService._generateTokens`. |
| **SEC-10** | Input Validation | **HIGH** | `ValidationPipe({ whitelist: true })` stripped unannotated fields in `CreateReviewDto` | Added `class-validator` annotations to `CreateReviewDto` and switched global pipe configuration to `{ whitelist: false, transform: true }` across Core and Planning entrypoints. |

---

## 2. FILES MODIFIED & CREATED

### Files Modified:
1. `docker-compose.yml` — Enforced mandatory environment variables without insecure defaults.
2. `apps/core-service/src/auth/auth.service.ts` — Removed fallback secret, added mandatory check and standardized token `issuer`/`audience`.
3. `apps/core-service/src/auth/jwt.strategy.ts` — Enforced mandatory secret check, standardized `issuer` and `audience` validation.
4. `apps/planning-service/src/auth/jwt.strategy.ts` — Enforced mandatory secret check, standardized `issuer` and `audience` validation.
5. `libs/shared/src/guards/internal-auth.guard.ts` — Hardened timing-safe verification and server-side secret validation.
6. `libs/shared/src/guards/internal-auth.guard.spec.ts` — Added test coverage for server missing secret configuration.
7. `apps/planning-service/src/acl/core-api.client.ts` — Fail-fast constructor, structured error differentiation, correlation propagation, and JSON logging.
8. `apps/planning-service/src/acl/ai-api.client.ts` — Fail-fast constructor, security-aware circuit breaker (no fallback on auth failure), and JSON logging.
9. `apps/core-service/src/reviews/dto/create-review.dto.ts` — Added `class-validator` decorators.
10. `apps/core-service/src/main.ts` — Configured `ValidationPipe({ whitelist: false, transform: true })`.
11. `apps/planning-service/src/main.ts` — Configured `ValidationPipe({ whitelist: false, transform: true })`.

### Files Created:
1. `apps/planning-service/src/acl/security.spec.ts` — Security and fault tolerance unit tests for `CoreApiClient` and `AiApiClient`.
2. `apps/core-service/src/auth/jwt.strategy.spec.ts` — Security unit tests for Core Service JWT strategy validation.
3. `apps/planning-service/src/auth/jwt.strategy.spec.ts` — Security unit tests for Planning Service JWT strategy validation.
4. `docs/security/SECURITY_HARDENING_REPORT.md` — This comprehensive milestone report.

---

## 3. SECURITY DECISIONS & RATIONALE

### Decision 1: Fail-Fast over Lenient Fallbacks
- **Context:** In development, developers frequently rely on hardcoded fallback secrets like `'changeme-secret'`. If deployed to staging or production without explicit environment variables, the system silently uses predictable secrets.
- **Decision:** Remove all fallbacks in `docker-compose.yml`, `AuthService`, `CoreApiClient`, and `AiApiClient`. If any required secret (`JWT_SECRET`, `INTERNAL_SERVICE_KEY`, `INTERNAL_AI_KEY`) is missing, the service immediately throws an exception on initialization.

### Decision 2: Distinct Error Semantics in Anti-Corruption Layer (ACL)
- **Context:** Previously, `CoreApiClient` wrapped all HTTP requests in a generic `try...catch` and returned `[]` or `null`. When Core Service was down or internal auth failed, Planning Service assumed zero restaurants existed and generated empty itineraries.
- **Decision:**
  - HTTP 401/403 $\rightarrow$ Throw `UnauthorizedException`.
  - HTTP 408 / Timeout / ECONNREFUSED $\rightarrow$ Throw `ServiceUnavailableException`.
  - HTTP 500 / 502 / 503 $\rightarrow$ Throw `BadGatewayException`.
  - HTTP 404 $\rightarrow$ Return `[]` (valid business case: no restaurants matched the filter).

### Decision 3: Disallowing Silent Circuit Breaker Fallback on Auth Failures
- **Context:** `AiApiClient` had a circuit breaker fallback that triggered on any exception. If `INTERNAL_AI_KEY` was mismatched or expired, the system silently fell back to the heuristic without alerting operators.
- **Decision:** When the AI service responds with HTTP 401 or 403, `AiApiClient` logs a `CRITICAL` error and immediately throws `UnauthorizedException`. It only falls back to the Gastronomic Greedy Heuristic when the service is unreachable due to network latency (timeout > 3500ms) or server downtime (5xx).

### Decision 4: Distributed Tracing with Correlation IDs
- **Context:** In a microservices architecture, tracking requests across Core, Planning, and AI services is essential for debugging and security auditing.
- **Decision:** Every inter-service request automatically injects an `X-Correlation-Id` header (using `crypto.randomUUID()` if not passed from ingress). Every log statement emitted by the ACL clients prints structured JSON with the correlation ID, status, URL, and latency in milliseconds.

---

## 4. TESTS EXECUTED

The following test suites were executed to validate the security hardening:

1. `libs/shared/src/guards/internal-auth.guard.spec.ts` (5 tests)
   - Allow access when `X-Internal-Service-Key` matches.
   - Reject with 401 when header is missing.
   - Reject with 401 when key value differs.
   - Reject with 401 when key length differs.
   - Reject with 401 when server environment variable is missing.

2. `apps/planning-service/src/acl/security.spec.ts` (10 tests)
   - `CoreApiClient` fails fast in constructor when `INTERNAL_SERVICE_KEY` is missing.
   - `CoreApiClient` injects `X-Internal-Service-Key` and `X-Correlation-Id`.
   - `CoreApiClient` propagates HTTP 401 as `UnauthorizedException`.
   - `CoreApiClient` maps timeout (ECONNABORTED) to `ServiceUnavailableException`.
   - `CoreApiClient` maps connection refused (ECONNREFUSED) to `ServiceUnavailableException`.
   - `CoreApiClient` maps 500 server crash to `BadGatewayException`.
   - `CoreApiClient` returns `[]` on 404 without error.
   - `AiApiClient` fails fast in constructor when `INTERNAL_AI_KEY` is missing.
   - `AiApiClient` throws `UnauthorizedException` on HTTP 401 and DOES NOT fall back.
   - `AiApiClient` trips circuit breaker and falls back to heuristic on timeout (3500ms) and ECONNREFUSED.

3. `apps/core-service/src/auth/jwt.strategy.spec.ts` (3 tests)
   - Fails fast in constructor when `JWT_SECRET` is unset.
   - Successfully validates and returns standardized user object (`userId`, `sub`, `email`, `role`).
   - Throws `UnauthorizedException` when token payload lacks `sub`.

4. `apps/planning-service/src/auth/jwt.strategy.spec.ts` (3 tests)
   - Fails fast in constructor when `JWT_SECRET` is unset.
   - Successfully validates and returns standardized user object.
   - Throws `UnauthorizedException` when token payload lacks `sub`.

5. Full Microservices Regression Suite (15 suites, 71 tests).

6. Compilation Builds:
   - `npm run build:core`
   - `npm run build:planning`

---

## 5. ACTUAL TEST RESULTS

### 5.1. Security Unit Test Results
```text
Test Suites: 4 passed, 4 total
Tests:       22 passed, 22 total
Snapshots:   0 total
Time:        4.978 s
Result:      ✅ 100% PASS
```

### 5.2. Monorepo Regression Test Results
```text
Test Suites: 15 passed, 15 total
Tests:       71 passed, 71 total
Snapshots:   0 total
Time:        19.729 s
Result:      ✅ 100% PASS
```

### 5.3. Compilation Verification
```text
> nest build core-service       --> Exit Code: 0 (SUCCESS)
> nest build planning-service   --> Exit Code: 0 (SUCCESS)
```

---

## 6. REMAINING SECURITY RISKS & RECOMMENDATIONS

While Milestone 1 has addressed all critical configuration and service-mesh authentication issues, the following secondary risks should be addressed in subsequent milestones:

1. **Secret Rotation Mechanism (Milestone 2):**
   - Currently, `INTERNAL_SERVICE_KEY` and `INTERNAL_AI_KEY` are static strings loaded from process environment variables. Rotating keys requires a restart of all services.
   - *Recommendation:* Introduce dual-key support or key-versioning headers (`X-Internal-Key-Version`) to enable seamless rotation without downtime.

2. **mTLS for In-Flight Encryption in Production:**
   - In containerized deployments (`docker-compose`), services communicate over an internal bridge network (`gastrowise_network`) via plaintext HTTP.
   - *Recommendation:* When migrating to a multi-host or Kubernetes deployment, terminate mTLS via a service mesh (e.g. Istio / Linkerd) or configure Nginx/Envoy sidecars.

3. **Rate Limiting on Internal Endpoints:**
   - Internal endpoints (`/api/v1/internal/*`) rely solely on `InternalAuthGuard` and have no per-IP or per-service rate limiters.
   - *Recommendation:* Add internal token-bucket rate limiting (e.g., 200 req/s per service) to prevent accidental DoS if a downstream client loops indefinitely.

4. **Public Review / Restaurant Legacy Endpoints in Monolith `src/`:**
   - The legacy monolith code in `src/` is intentionally kept untouched for backward compatibility during the migration phase. It still contains legacy patterns until fully deprecated.

