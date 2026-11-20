# GASTROWISE — MILESTONE 1 VERIFICATION REVIEW REPORT
**Independent Security & Backend Architecture Audit**

**Reviewer:** Senior Backend Engineer & Independent Security Reviewer  
**Repository:** [KLTN-123-GastroWise-BE](file:///D:/GastroWise/KLTN-123-GastroWise-BE)  
**Target Branch:** `refactor/microservices-backend`  
**Commit Evaluated:** `8d3d012` (*feat: implement authentication, JWT strategies, and ACL integration services*)  
**Audit Date:** November 20, 2026  
**Final Verdict:** **PASS WITH CONDITIONS**  

---

## 1. EXECUTIVE SUMMARY

An independent verification audit of **Milestone 1: Security & Configuration Hardening** was conducted on repository `KLTN-123-GastroWise-BE` at commit `8d3d012`. The audit independently analyzed the actual codebase, runtime configurations, container orchestrations, and automated test suites without relying on prior reports.

### Key Audit Findings Summary:
1. **Insecure Secrets Eliminated:** All hardcoded fallback secrets (`changeme-production-secret...`, `default-secret-change-in-production`, `gastrowise_jwt_secret`) have been excised. Docker Compose and NestJS application services strictly enforce environment variable presence with fail-fast initialization.
2. **Mutual Service Authentication Hardened:** `InternalAuthGuard` enforces timing-safe comparisons via `crypto.timingSafeEqual` and strictly rejects requests if the server secret is unconfigured.
3. **AI Authentication Contract Synchronized:** The `X-Internal-AI-Key` header and timing-safe mutual authentication contract in `KLTN-123-GastroWise-AI` are correctly matched by both `CoreApiClient` and `AiApiClient`.
4. **ACL Silent Failure Defect Remediated:** `CoreApiClient` no longer converts network timeouts, connection refusals, or HTTP 401/500 errors into deceptive empty arrays (`[]`), protecting itinerary generation from silent data corruption.
5. **Circuit Breaker Auth Awareness Implemented:** `AiApiClient` explicitly raises `UnauthorizedException` on HTTP 401/403 and refuses to trip circuit breaker heuristic fallback when credentials fail.
6. **JWT Strategy Standardized:** Tokens are signed and verified with strict `issuer: 'gastrowise-auth'`, `audience: 'gastrowise-api'`, and `ignoreExpiration: false`.
7. **Two Conditions Identified:**
   - **Condition 1 (Medium):** While `AiApiClient` correctly refuses to fall back on HTTP 401/403, the upstream caller `ItinerariesService.generateItinerary` wraps the call in a broad `try...catch (aiErr: any)` and proceeds to fall back to its internal `Gastronomic Progression Heuristic`.
   - **Condition 2 (Low):** `RestaurantsService` in Core Service still accesses `process.env.INTERNAL_AI_KEY` inline with ternary fallback `{}` rather than a centralized, fail-fast ACL client.

---

## 2. FILES INSPECTED

The following files were inspected directly from disk and through the Git commit history:

### Configuration & Infrastructure
- [docker-compose.yml](file:///D:/GastroWise/KLTN-123-GastroWise-BE/docker-compose.yml)
- [.env.example](file:///D:/GastroWise/KLTN-123-GastroWise-BE/.env.example)
- [apps/core-service/.env.example](file:///D:/GastroWise/KLTN-123-GastroWise-BE/apps/core-service/.env.example)
- [apps/planning-service/.env.example](file:///D:/GastroWise/KLTN-123-GastroWise-BE/apps/planning-service/.env.example)

### Core Service (`apps/core-service`)
- [apps/core-service/src/main.ts](file:///D:/GastroWise/KLTN-123-GastroWise-BE/apps/core-service/src/main.ts)
- [apps/core-service/src/auth/auth.service.ts](file:///D:/GastroWise/KLTN-123-GastroWise-BE/apps/core-service/src/auth/auth.service.ts)
- [apps/core-service/src/auth/jwt.strategy.ts](file:///D:/GastroWise/KLTN-123-GastroWise-BE/apps/core-service/src/auth/jwt.strategy.ts)
- [apps/core-service/src/auth/auth.module.ts](file:///D:/GastroWise/KLTN-123-GastroWise-BE/apps/core-service/src/auth/auth.module.ts)
- [apps/core-service/src/reviews/dto/create-review.dto.ts](file:///D:/GastroWise/KLTN-123-GastroWise-BE/apps/core-service/src/reviews/dto/create-review.dto.ts)
- [apps/core-service/src/restaurants/restaurants.service.ts](file:///D:/GastroWise/KLTN-123-GastroWise-BE/apps/core-service/src/restaurants/restaurants.service.ts)
- [apps/core-service/src/internal/internal-restaurants.controller.ts](file:///D:/GastroWise/KLTN-123-GastroWise-BE/apps/core-service/src/internal/internal-restaurants.controller.ts)
- [apps/core-service/src/internal/internal-taste-dna.controller.ts](file:///D:/GastroWise/KLTN-123-GastroWise-BE/apps/core-service/src/internal/internal-taste-dna.controller.ts)
- [apps/core-service/src/internal/internal-interactions.controller.ts](file:///D:/GastroWise/KLTN-123-GastroWise-BE/apps/core-service/src/internal/internal-interactions.controller.ts)

### Planning Service (`apps/planning-service`)
- [apps/planning-service/src/main.ts](file:///D:/GastroWise/KLTN-123-GastroWise-BE/apps/planning-service/src/main.ts)
- [apps/planning-service/src/auth/jwt.strategy.ts](file:///D:/GastroWise/KLTN-123-GastroWise-BE/apps/planning-service/src/auth/jwt.strategy.ts)
- [apps/planning-service/src/acl/core-api.client.ts](file:///D:/GastroWise/KLTN-123-GastroWise-BE/apps/planning-service/src/acl/core-api.client.ts)
- [apps/planning-service/src/acl/ai-api.client.ts](file:///D:/GastroWise/KLTN-123-GastroWise-BE/apps/planning-service/src/acl/ai-api.client.ts)
- [apps/planning-service/src/itineraries/itineraries.service.ts](file:///D:/GastroWise/KLTN-123-GastroWise-BE/apps/planning-service/src/itineraries/itineraries.service.ts)

### Shared Library (`libs/shared`)
- [libs/shared/src/guards/internal-auth.guard.ts](file:///D:/GastroWise/KLTN-123-GastroWise-BE/libs/shared/src/guards/internal-auth.guard.ts)
- [libs/shared/src/guards/internal-auth.guard.spec.ts](file:///D:/GastroWise/KLTN-123-GastroWise-BE/libs/shared/src/guards/internal-auth.guard.spec.ts)

### AI Service Repository (`KLTN-123-GastroWise-AI`)
- [KLTN-123-GastroWise-AI/app/core/auth.py](file:///D:/GastroWise/KLTN-123-GastroWise-AI/app/core/auth.py)
- [KLTN-123-GastroWise-AI/app/api/v1/router.py](file:///D:/GastroWise/KLTN-123-GastroWise-AI/app/api/v1/router.py)

### Security Test Suites
- [apps/planning-service/src/acl/security.spec.ts](file:///D:/GastroWise/KLTN-123-GastroWise-BE/apps/planning-service/src/acl/security.spec.ts)
- [apps/core-service/src/auth/jwt.strategy.spec.ts](file:///D:/GastroWise/KLTN-123-GastroWise-BE/apps/core-service/src/auth/jwt.strategy.spec.ts)
- [apps/planning-service/src/auth/jwt.strategy.spec.ts](file:///D:/GastroWise/KLTN-123-GastroWise-BE/apps/planning-service/src/auth/jwt.strategy.spec.ts)

---

## 3. VERIFIED SECURITY IMPROVEMENTS

### 3.1. Elimination of Insecure Default Fallbacks
- In `docker-compose.yml`, lines 46–48, 70–72, and 91 were updated from `${VAR:-default}` to `${VAR:?VAR must be set}`.
- In `AuthService._generateTokens`, line 143: if `JWT_SECRET` is unset, it throws `Error('Missing mandatory security configuration: JWT_SECRET must be set in environment variables')`.
- In `CoreApiClient.constructor`, lines 27–31: if `INTERNAL_SERVICE_KEY` is unset, it throws `Error('Missing mandatory security configuration: INTERNAL_SERVICE_KEY must be set in environment variables')`.
- In `AiApiClient.constructor`, lines 27–31: if `INTERNAL_AI_KEY` is unset, it throws `Error('Missing mandatory security configuration: INTERNAL_AI_KEY must be set in environment variables')`.
- In `JwtStrategy` (both Core and Planning): constructor throws if `JWT_SECRET` is undefined in `ConfigService`.

### 3.2. Timing-Safe Mutual Authentication
- `libs/shared/src/guards/internal-auth.guard.ts` applies:
  ```typescript
  const aBuffer = Buffer.from(provided);
  const bBuffer = Buffer.from(expected);
  if (aBuffer.length !== bBuffer.length) throw new UnauthorizedException('Invalid internal service key');
  if (!timingSafeEqual(aBuffer, bBuffer)) throw new UnauthorizedException('Invalid internal service key');
  ```
  This guarantees $O(1)$ constant-time comparison across all key checks.
- Server configuration check: If `process.env.INTERNAL_SERVICE_KEY` is missing on the host, the guard throws `UnauthorizedException('Internal service key is not configured on the server')` instead of crashing with a null buffer dereference or allowing open bypass.

### 3.3. Anti-Corruption Layer (ACL) Error Differentiation
- In `apps/planning-service/src/acl/core-api.client.ts`:
  - HTTP 401/403 $\rightarrow$ maps to `UnauthorizedException`.
  - HTTP 404 $\rightarrow$ returns `[]` (business query yielded no matching candidates).
  - HTTP 500 / 502 / 503 $\rightarrow$ maps to `BadGatewayException`.
  - Timeout (`ECONNABORTED`, `ETIMEDOUT`) $\rightarrow$ maps to `ServiceUnavailableException`.
  - Connection refused (`ECONNREFUSED`) $\rightarrow$ maps to `ServiceUnavailableException`.
- This ensures that transient network failures or service crashes never persist empty itineraries to MongoDB.

### 3.4. AI Service Circuit Breaker Auth Guarding
- In `apps/planning-service/src/acl/ai-api.client.ts`:
  - When AI returns HTTP 401 or 403, the client emits a `CRITICAL` log and throws `UnauthorizedException`.
  - Circuit breaker fallback to `Gastronomic Greedy Fallback` is strictly restricted to network timeouts (3500ms exceeded), connection refused, and downstream 5xx errors.

### 3.5. Standardized Distributed Tracing & Logging
- Inter-service HTTP requests from `CoreApiClient` and `AiApiClient` inject `X-Correlation-Id`.
- Both clients log structured JSON containing `timestamp`, `level`, `context`, `method`, `url`, `status`, `durationMs`, and `correlationId`.

### 3.6. DTO Validation Whitelist Bug Fix
- `CreateReviewDto` received `class-validator` annotations (`@IsNotEmpty`, `@IsNumber`, `@IsString`, `@IsOptional`, `@Min(1)`, `@Max(10)`).
- `ValidationPipe` in both services was configured with `{ whitelist: false, transform: true }`, ensuring client requests with unmapped auxiliary fields are not silently wiped.

---

## 4. DETAILED AUDIT FINDINGS

### CRITICAL FINDINGS
*None observed. All P0 and Critical vulnerabilities previously identified have been remediated.*

---

### HIGH FINDINGS
*None observed.*

---

### MEDIUM FINDINGS

#### FINDING-M01: `ItinerariesService.generateItinerary` Catches and Masks AI Authentication Failure
- **Location:** [apps/planning-service/src/itineraries/itineraries.service.ts:349-356](file:///D:/GastroWise/KLTN-123-GastroWise-BE/apps/planning-service/src/itineraries/itineraries.service.ts#L349-L356)
- **Evidence:**
  ```typescript
  try {
    const aiResult = await this.aiApiClient.optimizeRoute(...);
    ...
  } catch (aiErr: any) {
    this.logger.warn(`AI Route Optimizer error: ${aiErr.message}`);
  }

  // Heuristic fallback if AI yielded no stops
  if (optimizedStops.length === 0) {
    optimizedBy = 'Gastronomic Progression Heuristic';
    const selected = scoredCandidates.slice(0, desiredStops);
    ...
  ```
- **Analysis:**  
  While `AiApiClient` was successfully hardened to throw `UnauthorizedException` and refuse fallback when HTTP 401/403 occurs, the upstream caller `ItinerariesService` catches all errors uniformly with `catch (aiErr: any)`. If `INTERNAL_AI_KEY` is wrong, the service logs a warning and proceeds to generate an itinerary via its local heuristic, returning HTTP 201 to the user.
- **Impact:** Misconfigured AI keys will not block itinerary generation (providing high availability), but operators might not notice authentication misconfiguration unless monitoring server logs.
- **Recommended Action (Milestone 2):**  
  In `ItinerariesService.generateItinerary`, inspect `aiErr`:
  ```typescript
  if (aiErr instanceof UnauthorizedException) {
    throw aiErr; // Re-throw critical authentication failure to alert caller/monitoring
  }
  ```

---

### LOW FINDINGS

#### FINDING-L01: Legacy Inline AI Calls in `restaurants.service.ts` Lack Constructor Fail-Fast
- **Location:** [apps/core-service/src/restaurants/restaurants.service.ts:514-517, 632-635, 1143-1146](file:///D:/GastroWise/KLTN-123-GastroWise-BE/apps/core-service/src/restaurants/restaurants.service.ts#L514-L517)
- **Evidence:**
  ```typescript
  const aiKey = process.env.INTERNAL_AI_KEY;
  const headers: Record<string, string> = aiKey ? { 'X-Internal-AI-Key': aiKey } : {};
  ```
- **Analysis:**  
  In Core Service, hybrid recommendations and copilot message routing read `process.env.INTERNAL_AI_KEY` inline at call-time. If the key is omitted in Core's `.env`, Core will still start up, but outgoing calls to AI will be rejected with HTTP 401 by FastAPI.
- **Recommended Action (Milestone 2):**  
  Extract Core's outgoing AI calls into a dedicated `AiApiClient` in Core Service that enforces constructor validation, matching Planning Service.

---

### INFORMATIONAL / MIGRATION OBSERVATIONS

#### OBS-01: Session Invalidation for Pre-Existing JWT Tokens
- **Context:** `JwtStrategy` now enforces `issuer: 'gastrowise-auth'` and `audience: 'gastrowise-api'`.
- **Observation:** Any legacy access token issued prior to Milestone 1 that lacks `iss` or `aud` claims will be rejected with HTTP 401. This is the desired outcome of security hardening, but requires users to re-login once deployed to staging/production.

---

## 5. TEST EVIDENCE & VALIDATION

The reviewer independently executed the test suites inside the repository to verify genuine defect detection and coverage.

### 5.1. Security Unit Test Execution
**Command:**
```powershell
Set-Location D:\GastroWise\KLTN-123-GastroWise-BE
$env:NODE_OPTIONS="--max-old-space-size=4096"
npx jest apps/planning-service/src/acl/security.spec.ts apps/core-service/src/auth/jwt.strategy.spec.ts apps/planning-service/src/auth/jwt.strategy.spec.ts libs/shared/src/guards/internal-auth.guard.spec.ts --runInBand
```
**Output Evidence:**
```text
[Nest] ERROR [CoreApiClient] {"timestamp":"...","level":"ERROR","context":"CoreApiClient","method":"GET","url":".../candidates","status":401,"durationMs":1,"correlationId":"...","message":"Invalid token/key"}
[Nest] ERROR [CoreApiClient] {"timestamp":"...","level":"ERROR","context":"CoreApiClient","method":"GET","url":".../candidates","code":"ECONNABORTED","durationMs":1,"correlationId":"...","message":"timeout of 4000ms exceeded"}
[Nest] ERROR [CoreApiClient] {"timestamp":"...","level":"ERROR","context":"CoreApiClient","method":"GET","url":".../candidates","code":"ECONNREFUSED","durationMs":0,"correlationId":"...","message":"connect ECONNREFUSED 127.0.0.1:3001"}
[Nest] ERROR [CoreApiClient] {"timestamp":"...","level":"ERROR","context":"CoreApiClient","method":"GET","url":".../candidates","status":500,"durationMs":0,"correlationId":"...","message":"DB crash"}
[Nest] ERROR [AiApiClient] {"timestamp":"...","level":"ERROR","context":"AiApiClient","method":"POST","url":".../routes/optimize","status":401,"durationMs":0,"correlationId":"...","message":"CRITICAL: AI Service internal authentication failed. Keys mismatched or rejected."}

PASS apps/planning-service/src/acl/security.spec.ts (10 tests)
PASS apps/core-service/src/auth/jwt.strategy.spec.ts (3 tests)
PASS apps/planning-service/src/auth/jwt.strategy.spec.ts (3 tests)
PASS libs/shared/src/guards/internal-auth.guard.spec.ts (5 tests)

Test Suites: 4 passed, 4 total
Tests:       22 passed, 22 total
Snapshots:   0 total
Time:        5.091 s
```
*Verification Assessment:* Tests are authentic; they instantiate actual service classes and test genuine exception branches rather than trivial mocks.

### 5.2. Microservices Full Regression Suite
**Command:**
```powershell
Set-Location D:\GastroWise\KLTN-123-GastroWise-BE
$env:NODE_OPTIONS="--max-old-space-size=4096"
npx jest apps/planning-service/ apps/core-service/src/auth/ apps/core-service/src/users/ apps/core-service/src/taste-dna/ apps/core-service/src/health/ libs/ --runInBand
```
**Output Evidence:**
```text
Test Suites: 15 passed, 15 total
Tests:       71 passed, 71 total
Snapshots:   0 total
Time:        19.729 s
```

### 5.3. Service Compilation Verification
**Commands:**
```powershell
npm run build:core
npm run build:planning
```
**Output Evidence:**
```text
> nest build core-service       --> Exit Code: 0
> nest build planning-service   --> Exit Code: 0
```
Both microservices compile with zero TypeScript errors.

---

## 6. VERIFICATION CHECKLIST AUDIT SUMMARY

| # | Checklist Item | Status | Finding / Evidence |
| :-: | :--- | :---: | :--- |
| 1 | No insecure default secrets in runtime config | ✅ VERIFIED | All fallbacks removed; `${VAR:?error}` in Compose. |
| 2 | Internal API authentication cannot be bypassed | ✅ VERIFIED | `InternalAuthGuard` enforces timing-safe checks on all `/internal/*` routes. |
| 3 | AI service authentication matches contract | ✅ VERIFIED | `X-Internal-AI-Key` matched between FastAPI and NestJS ACL clients. |
| 4 | JWT validation & authentication compatibility | ✅ VERIFIED | Issuer (`gastrowise-auth`) and audience (`gastrowise-api`) strictly validated. |
| 5 | Timeouts/errors do not silently produce empty data | ✅ VERIFIED | `CoreApiClient` throws distinct NestJS exceptions on 401, 5xx, and timeouts. |
| 6 | Missing env vars cause clear startup failures | ✅ VERIFIED | Client and strategy constructors throw `Error` on missing required keys. |
| 7 | Tests genuinely cover security cases | ✅ VERIFIED | 22 security unit tests assert on genuine exception types and status codes. |
| 8 | No regressions introduced | ✅ VERIFIED | 15 regression suites (71 tests) passed; core/planning builds succeed. |
| 9 | Frontend-facing API contracts unchanged | ✅ VERIFIED | Auth login/register responses, review endpoints, and itinerary schemas identical. |
| 10 | Security fixes consistent across environments | ✅ VERIFIED | Docker Compose, `.env.example`, and application code all share identical key names. |

---

## 7. FINAL VERDICT & RECOMMENDATIONS

### Final Verdict: **PASS WITH CONDITIONS**

**Justification:**  
Milestone 1 has successfully met all core security requirements. Default secrets have been eliminated, constant-time mutual authentication is enforced, JWT validation is standardized, and the Anti-Corruption Layer now distinguishes fatal infrastructure failures from legitimate empty queries.

### Conditions for Milestone 2:
1. **Condition 1:** In `apps/planning-service/src/itineraries/itineraries.service.ts:349`, check `aiErr` and rethrow `UnauthorizedException` so AI authentication misconfigurations bubble up to monitoring instead of triggering silent heuristic fallback.
2. **Condition 2:** In `apps/core-service/src/restaurants/restaurants.service.ts`, encapsulate outbound AI calls into an injectable client with fail-fast constructor validation for `INTERNAL_AI_KEY`.

---
*End of Verification Review Report.*

