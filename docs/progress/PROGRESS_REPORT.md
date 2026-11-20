# GASTROWISE — MICROSERVICES MIGRATION PROGRESS REPORT

**Milestone:** Phase 1–8 Microservices Migration Implementation  
**Branch:** `refactor/microservices-backend`  
**Repository:** [KLTN-123-GastroWise-BE](https://github.com/maanxx/KLTN-123-GastroWise-BE)  
**Date:** November 20, 2026  
**Status:** ✅ IMPLEMENTATION COMPLETED & INDEPENDENT BUILDS VERIFIED  

---

## 1. MILESTONE OBJECTIVES ACHIEVED

1. **Prepared Migration Branch:** Created `refactor/microservices-backend` from `main`. Original `main` branch remains untouched.
2. **Established Monorepo Foundation:** Reconfigured NestJS repository into a clean monorepo architecture (`apps/core-service`, `apps/planning-service`, `libs/shared`).
3. **Extracted Core Service (`apps/core-service`):**
   - Autonomous bootstrap entrypoint on port `3001` with global prefix `/api/v1`.
   - Exclusive database ownership of `gastro_core`.
   - Independent `/health` endpoint.
   - Built and verified independent compilation (`npm run build:core`).
   - Fixed P0 Review BOLA security gap (added `JwtAuthGuard` + owner/admin verification on PATCH/DELETE).
   - Fixed P0 Interaction Matrix exposure (restricted `GET /interactions/matrix` to `@Roles('admin')`).
   - Fixed P0 AI endpoint route mismatch (corrected URLs to `/recommend/hybrid`, `/cf/train`, `/copilot/message`).
   - Implemented `InternalProviderModule` exposing `/internal/restaurants/*`, `/internal/taste-dna/*`, `/internal/interactions/*` protected by `InternalAuthGuard`.
4. **Extracted Planning Service (`apps/planning-service`):**
   - Autonomous bootstrap entrypoint on port `3003` with global prefix `/api/v1`.
   - Exclusive database ownership of `gastro_planning`.
   - Independent `/health` endpoint.
   - Built and verified independent compilation (`npm run build:planning`).
   - Strict Boundary Enforcement: ZERO imports of Core schemas (`Restaurant`, `User`, `TasteDnaProfile`).
   - Anti-Corruption Layer (ACL) implemented: `CoreApiClient` (calls Core internal REST) and `AiApiClient` (calls AI Route Optimizer with 3500ms timeout & circuit breaker fallback to Gastronomic Greedy heuristic).
   - Snapshot Value Object Pattern: `ItineraryStop` stores immutable venue attributes directly, eliminating cross-database joins.
5. **AI Microservice Hardening (`KLTN-123-GastroWise-AI`):**
   - Implemented ADR-07 dual-route compatibility mounts (`/v1/recommendation` and canonical routes) in `app/api/v1/router.py`.
   - Added timing-safe `X-Internal-AI-Key` mutual authentication guard (`app/core/auth.py`).
6. **API Gateway Configured (`nginx/nginx.conf`):**
   - Port 8080 ingress router.
   - Priority 1: `/api/v1/itineraries/*` $\rightarrow$ Planning Service (:3003).
   - Priority 2: `/api/v1/auth/*` $\rightarrow$ Core Service (:3001) with strict rate limiting (5 req/s).
   - Priority 3: `/api/v1/*` $\rightarrow$ Core Service (:3001) with standard rate limiting (30 req/s).
   - Backward-compatibility rewrites for legacy prefix-less routes.
   - `X-Correlation-Id` distributed tracing propagation.
7. **Containerization & DevOps:**
   - Multi-stage Dockerfile for Core Service (`apps/core-service/Dockerfile`).
   - Multi-stage Dockerfile for Planning Service (`apps/planning-service/Dockerfile`).
   - Production Docker Compose topology (`docker-compose.yml`).
   - Safe database split validation dry-run script (`scripts/db-split-dryrun.ts`).

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
| Haversine Math & Transit Floors | `libs/shared/src/utils/geo.utils.spec.ts` | 2 | ✅ PASS |
| Mutual Service InternalAuthGuard | `libs/shared/src/guards/internal-auth.guard.spec.ts` | 4 | ✅ PASS |
| Core Service Health Controller | `apps/core-service/src/health/health.controller.spec.ts` | 1 | ✅ PASS |
| Planning Service Health Controller | `apps/planning-service/src/health/health.controller.spec.ts` | 1 | ✅ PASS |
| Planning Itineraries Service (ACL) | `apps/planning-service/src/itineraries/itineraries.service.spec.ts` | 8 | ✅ PASS |
| Planning Itineraries Controller | `apps/planning-service/src/itineraries/itineraries.controller.spec.ts` | 4 | ✅ PASS |
| **Total Microservices Test Suites** | **6 Suites** | **20 Tests** | **✅ 100% PASS** |
