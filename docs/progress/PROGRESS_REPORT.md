# GASTROWISE — MICROSERVICES MIGRATION PROGRESS REPORT

**Milestone:** Milestone 1: Security & Configuration Hardening  
**Branch:** `refactor/microservices-backend`  
**Repository:** [KLTN-123-GastroWise-BE](https://github.com/maanxx/KLTN-123-GastroWise-BE)  
**Date:** November 20, 2026  
**Status:** ✅ MILESTONE 1 COMPLETED & VERIFIED  

---

## 1. MILESTONE 1 OBJECTIVES ACHIEVED

1. **Eliminated Insecure Default Fallback Secrets:**
   - Updated `docker-compose.yml` to require mandatory environment variables (`${VAR:?VAR must be set}`).
   - Removed fallback keys in `apps/planning-service/src/acl/core-api.client.ts` and `apps/planning-service/src/acl/ai-api.client.ts`.
   - Removed fallback secret in `apps/core-service/src/auth/auth.service.ts`.
   - Configured fast failure on startup if mandatory keys (`JWT_SECRET`, `INTERNAL_SERVICE_KEY`, `INTERNAL_AI_KEY`) are missing.
2. **Hardened Mutual Service Authentication Mesh:**
   - Updated `InternalAuthGuard` to verify server configuration presence and reject invalid keys using timing-safe comparisons (`crypto.timingSafeEqual`).
   - CoreApiClient and AiApiClient consistently send configured keys and propagate `X-Correlation-Id`.
3. **Implemented Structured Error Handling in ACL Clients:**
   - Differentiated HTTP 401/403 (`UnauthorizedException`), timeouts/network refuse (`ServiceUnavailableException`), 5xx crashes (`BadGatewayException`), and 404 (`[]`).
   - Eliminated silent heuristic fallback on auth failures in `AiApiClient`.
   - Structured JSON logging with latency, timestamps, status codes, and correlation IDs.
4. **Standardized JWT Token Validation & Generation:**
   - Configured `issuer: 'gastrowise-auth'`, `audience: 'gastrowise-api'`, and `ignoreExpiration: false` across both Core and Planning services.
   - Standardized extracted user payload interface (`userId`, `sub`, `email`, `role`).
5. **Fixed DTO Whitelist Stripping:**
   - Added `class-validator` annotations to `CreateReviewDto`.
   - Configured `ValidationPipe({ whitelist: false, transform: true })` across services.
6. **Executed Comprehensive Security Test Suites:**
   - Added `apps/planning-service/src/acl/security.spec.ts` (10 tests).
   - Added `apps/core-service/src/auth/jwt.strategy.spec.ts` (3 tests).
   - Added `apps/planning-service/src/auth/jwt.strategy.spec.ts` (3 tests).
   - Expanded `libs/shared/src/guards/internal-auth.guard.spec.ts` (5 tests).
   - All 22 security unit tests passed (100% PASS).
   - Full monorepo microservices regression suite passed: 15 suites, 71 tests (100% PASS).
   - Both Core Service and Planning Service compiled cleanly with exit code 0.

---

## 2. VERIFIED BUILD & TEST RESULTS

### 2.1. Compilation Verification
| Command | Target | Exit Code | Result |
| :--- | :--- | :---: | :---: |
| `npm run build:shared` | Shared Contract Library | 0 | ✅ PASS |
| `npm run build:core` | Core Service (`apps/core-service`) | 0 | ✅ PASS |
| `npm run build:planning` | Planning Service (`apps/planning-service`) | 0 | ✅ PASS |
| `npm run build:all` | Monorepo Full Build | 0 | ✅ PASS |

### 2.2. Unit Test Execution
| Test Suite | File | Tests | Result |
| :--- | :--- | :---: | :---: |
| Mutual Service InternalAuthGuard | `libs/shared/src/guards/internal-auth.guard.spec.ts` | 5 | ✅ PASS |
| ACL Security & Fault Tolerance | `apps/planning-service/src/acl/security.spec.ts` | 10 | ✅ PASS |
| Core Service JWT Strategy | `apps/core-service/src/auth/jwt.strategy.spec.ts` | 3 | ✅ PASS |
| Planning Service JWT Strategy | `apps/planning-service/src/auth/jwt.strategy.spec.ts` | 3 | ✅ PASS |
| Haversine Math & Transit Floors | `libs/shared/src/utils/geo.utils.spec.ts` | 2 | ✅ PASS |
| Core Service Health Controller | `apps/core-service/src/health/health.controller.spec.ts` | 1 | ✅ PASS |
| Planning Service Health Controller | `apps/planning-service/src/health/health.controller.spec.ts` | 1 | ✅ PASS |
| Planning Itineraries Service (ACL) | `apps/planning-service/src/itineraries/itineraries.service.spec.ts` | 8 | ✅ PASS |
| Planning Itineraries Controller | `apps/planning-service/src/itineraries/itineraries.controller.spec.ts` | 4 | ✅ PASS |
| Core Service Auth Controller | `apps/core-service/src/auth/auth.controller.spec.ts` | 5 | ✅ PASS |
| Core Service Auth Service | `apps/core-service/src/auth/auth.service.spec.ts` | 7 | ✅ PASS |
| Core Service Roles Guard | `apps/core-service/src/auth/roles.guard.spec.ts` | 4 | ✅ PASS |
| Core Service Users Controller | `apps/core-service/src/users/users.controller.spec.ts` | 5 | ✅ PASS |
| Core Service Users Service | `apps/core-service/src/users/users.service.spec.ts` | 8 | ✅ PASS |
| Core Service Taste DNA Service | `apps/core-service/src/taste-dna/taste-dna.service.spec.ts` | 5 | ✅ PASS |
| **Total Microservices Regression Suite** | **15 Suites** | **71 Tests** | **✅ 100% PASS** |
