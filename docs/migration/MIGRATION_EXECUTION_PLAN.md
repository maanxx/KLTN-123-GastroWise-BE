# GASTROWISE – INCREMENTAL MIGRATION EXECUTION PLAN (STRANGLER PATTERN)

**Document:** `docs/migration/MIGRATION_EXECUTION_PLAN.md`  
**Repository:** [KLTN-123-GastroWise-BE](https://github.com/maanxx/KLTN-123-GastroWise-BE)  
**Author:** Senior Software Architect & Backend Tech Lead  
**Last Updated:** November 20, 2026  
**Status:** 8-WEEK PHASED ROADMAP — ZERO-BREAKAGE STRATEGY  

---

## 1. MIGRATION PHILOSOPHY: STRANGLER FIG PATTERN

To eliminate the existential risk of a "big bang" rewrite, GastroWise uses Martin Fowler's **Strangler Fig Pattern**:
1. The existing monolith in `src/` remains fully operational.
2. New microservices are built incrementally in `apps/` within a NestJS Monorepo structure.
3. Traffic is shifted incrementally at the API Gateway level (first `/itineraries/*` to Planning, then `/api/v1/*` to Core).
4. Old monolithic routes are deprecated only after extensive dual-run validation.

---

## 2. PHASED ROADMAP BREAKDOWN

```
┌────────────────────────────────────────────────────────────────────────┐
│                   8-WEEK MIGRATION ROADMAP OVERVIEW                    │
├────────────────────────────────────────────────────────────────────────┤
│ WEEK 1: Phase 0 – Architecture Audit & Target Design (COMPLETED)       │
│ WEEK 2: Phase 1 – Monorepo Foundation & Shared Library Setup           │
│ WEEK 3: Phase 2 – Core Service Extraction & Security Remediation       │
│ WEEK 4: Phase 3 – Planning Service Extraction & Anti-Corruption Layer  │
│ WEEK 5: Phase 4 – AI Service Hardening & Mutual Auth Integration       │
│ WEEK 6: Phase 5 – API Gateway Deployment & Traffic Shift (Nginx)       │
│ WEEK 7: Phase 6 – Docker Containerization & Distributed Observability  │
│ WEEK 8: Phase 7 – End-to-End Chaos Drills & Thesis Verification        │
└────────────────────────────────────────────────────────────────────────┘
```

---

### PHASE 1 (WEEK 2): MONOREPO FOUNDATION & SHARED CONTRACTS
- **Objective:** Reconfigure `KLTN-123-GastroWise-BE` into a NestJS Monorepo supporting independent service builds and shared DTO/contract packages.
- **Affected Files:**
  - `nest-cli.json` (convert to monorepo structure with projects: `core-service`, `planning-service`, `shared`)
  - `tsconfig.json` (configure path alias `@shared/*` $\rightarrow$ `libs/shared/src/*`)
  - `libs/shared/*` (Create pure contracts, DTOs, enums, math utilities)
  - `apps/core-service/src/main.ts`, `apps/planning-service/src/main.ts` (Scaffold bootstrap files)
- **Key Tasks:**
  1. Create working branch: `feat/milestone-1-foundation`.
  2. Implement `libs/shared/src/contracts/` (`core.contract.ts`, `planning.contract.ts`, `ai.contract.ts`).
  3. Implement `libs/shared/src/enums/` (`roles.enum.ts`, `routing-mode.enum.ts`, `itinerary-status.enum.ts`).
  4. Implement `libs/shared/src/utils/geo.utils.ts` (Haversine math distance calculation).
  5. Configure independent `HealthModule` on both apps (`/health`).
- **Dependencies:** None.
- **Risks:** Cyclic dependencies between shared library and apps. (Mitigation: Shared library contains ONLY pure interfaces, enums, and utility functions; ZERO Mongoose models or controller imports).
- **Acceptance Criteria:**
  - `npm run build core-service` exits with code 0.
  - `npm run build planning-service` exits with code 0.
  - `GET http://127.0.0.1:3001/health` returns 200 OK.
  - `GET http://127.0.0.1:3003/health` returns 200 OK.
- **Rollback Strategy:** Revert working branch; monolith in `src/` remains untouched.

---

### PHASE 2 (WEEK 3): CORE SERVICE EXTRACTION & SECURITY HARDENING
- **Objective:** Extract Identity, Users, Catalog, Reviews, Favorites, Taste DNA, and Interactions into `apps/core-service`, and fix critical P0 access control vulnerabilities.
- **Affected Files:**
  - `apps/core-service/src/modules/*` (Auth, Users, Restaurants, Reviews, Favorites, Taste DNA, Interactions, Contacts)
  - `apps/core-service/src/internal/` (Create internal API endpoints for Planning Service)
- **Key Tasks:**
  1. Migrate Core modules into `apps/core-service`.
  2. **Security Fix [P0]:** Enforce `JwtAuthGuard` on `POST /reviews` (extract `userId` from token).
  3. **Security Fix [P0]:** Enforce author/admin ownership check on `DELETE /reviews/:id` and `PATCH /reviews/:id`.
  4. **Security Fix [P0]:** Enforce `@Roles('admin')` or `X-Internal-Service-Key` on `GET /interactions/matrix`.
  5. Implement internal REST endpoints:
     - `GET /internal/restaurants/candidates`
     - `GET /internal/restaurants/:id`
     - `GET /internal/taste-dna/:userId`
     - `POST /internal/interactions/event`
  6. Fix Jest unit test module mocks (`restaurants.service.spec.ts`, `reviews.service.spec.ts`).
- **Dependencies:** Phase 1 (Monorepo foundation & shared library).
- **Risks:** Regression in authentication flows (Google OAuth, 2FA). (Mitigation: Dedicated auth integration suite).
- **Acceptance Criteria:**
  - Core Service boots on port 3001 with database `gastro_core`.
  - Unauthenticated review deletion returns 401/403.
  - Public matrix export returns 401/403.
  - Internal candidate API responds to queries with valid candidates.
- **Rollback Strategy:** Switch port 3001 back to legacy monolith in `src/`.

---

### PHASE 3 (WEEK 4): PLANNING SERVICE EXTRACTION & DATABASE SPLIT
- **Objective:** Extract Itinerary Planning into `apps/planning-service` with complete database and model isolation, executing the 4-stage database split.
- **Affected Files:**
  - `apps/planning-service/src/modules/itineraries/*`
  - `apps/planning-service/src/acl/core-api.client.ts` (Anti-Corruption Layer)
  - `scripts/migrations/split-databases.js`, `verify-parity.js`
- **Key Tasks:**
  1. Implement `CoreApiClient` in Planning Service calling `http://127.0.0.1:3001/internal/*` with `X-Internal-Service-Key`.
  2. Remove `@InjectModel(Restaurant.name)`, `TasteDnaService`, and `InteractionsService` from Planning.
  3. Transform `ItineraryStop` to use `ItineraryStopSnapshot` (Snapshot Value Pattern).
  4. **Execute 4-Stage Database Split (ADR-06):**
     - Step 1: Create `mongodump` pre-migration archive with timestamp.
     - Step 2: Run `$merge` pipeline splitting `gastrowise` into `gastro_core` and `gastro_planning`.
     - Step 3: Run `verify-parity.js` asserting `countDocuments()` parity and rebuilding indexes (`2dsphere`).
     - Step 4: Verify rollback drill.
- **Dependencies:** Phase 2 (Core Service providing internal candidate APIs).
- **Risks:** Data loss or index dropping during DB split. (Mitigation: Pre-migration dump, `$merge` instead of raw `$out`, parity assertions).
- **Acceptance Criteria:**
  - Planning Service boots on port 3003 with zero connections to `gastro_core`.
  - `POST /itineraries/generate` creates valid multi-stop tour using Core candidate API.
  - Document counts in `gastro_planning` match `gastrowise` 100%.
- **Rollback Strategy:** Restore connection strings to untouched `gastrowise` database.

---

### PHASE 4 (WEEK 5): AI SERVICE HARDENING & INTEGRATION
- **Objective:** Resolve routing mismatches, enforce mutual inter-service authentication, and integrate AI with Core and Planning.
- **Affected Files:**
  - `KLTN-123-GastroWise-AI/app/api/v1/router.py`, `main.py`
  - `KLTN-123-GastroWise-AI/app/core/security.py`
  - `apps/core-service/src/infrastructure/ai-client.service.ts`
  - `apps/planning-service/src/infrastructure/ai-routing.client.ts`
- **Key Tasks:**
  1. **Routing Fix [P0]:** Update FastAPI router to support dual routes (`/v1/recommendation/...` and `/recommend/...`).
  2. **Security Fix [P0]:** Implement `X-Internal-AI-Key` validation in FastAPI via `Security(verify_internal_key)`.
  3. Configure Core and Planning HTTP clients to inject `X-Internal-AI-Key`.
  4. Configure Circuit Breaker with 3,500ms timeout budget and automatic fallback heuristics.
- **Dependencies:** Phase 2 & 3.
- **Risks:** AI timeouts degrading user experience. (Mitigation: Instant fallback to Greedy heuristic / rating sort).
- **Acceptance Criteria:**
  - Unauthenticated calls to port 5000 return 401.
  - Calls with key succeed with 200 OK.
  - Hybrid recommendation calls from Core receive actual AI inference (zero 404s).
- **Rollback Strategy:** Disable `verify_internal_key` dependency; revert to top-level router mounting.

---

### PHASE 5 (WEEK 6): API GATEWAY DEPLOYMENT & TRAFFIC SHIFT
- **Objective:** Deploy Nginx API Gateway, unify public ingress routing, and verify full client compatibility.
- **Affected Files:**
  - `nginx/nginx.conf`, `nginx/conf.d/gateway.conf`
  - Frontend client configurations (`FE`, `Admin-FE`, `Mobile`)
- **Key Tasks:**
  1. Configure Nginx reverse proxy rules:
     - `/api/v1/itineraries/*` $\rightarrow$ Planning Service (`:3003`)
     - `/api/v1/*` $\rightarrow$ Core Service (`:3001`)
  2. Configure gateway CORS whitelist matching Web, Admin, and Mobile origins.
  3. Configure `X-Correlation-Id` generation and propagation.
  4. Update `KLTN-123-GastroWise-FE`, `Admin-FE`, and `Mobile` base URLs to point to Gateway.
- **Dependencies:** Phases 2, 3, 4.
- **Risks:** Broken client endpoints due to missing proxy paths. (Mitigation: Verify against `API_COMPATIBILITY_MATRIX.md`).
- **Acceptance Criteria:**
  - All 3 client applications (Customer Web, Admin Web, Mobile App) perform login, browsing, and tour generation through Gateway without errors.
- **Rollback Strategy:** Switch Gateway upstream back to monolithic port 3001.

---

### PHASE 6 (WEEK 7): DOCKER CONTAINERIZATION & OBSERVABILITY
- **Objective:** Containerize all services with multi-stage Dockerfiles and compose orchestration.
- **Affected Files:**
  - `Dockerfile.core`, `Dockerfile.planning`, `Dockerfile.ai`, `docker-compose.yml`
- **Key Tasks:**
  1. Author production multi-stage Dockerfiles for Core, Planning, and AI services.
  2. Author `docker-compose.yml` orchestrating Gateway, Core, Planning, AI, and MongoDB.
  3. Enforce health checks and dependency boot ordering (`depends_on: condition: service_healthy`).
- **Acceptance Criteria:** `docker compose up -d` boots entire platform from cold state in $< 60\text{ s}$; all health checks report green.

---

### PHASE 7 (WEEK 8): END-TO-END VALIDATION & THESIS ARTIFACTS
- **Objective:** Execute comprehensive chaos resilience testing and finalize thesis defense artifacts.
- **Key Tasks:**
  1. Execute End-to-End Test Suite: User Registration $\rightarrow$ Taste DNA $\rightarrow$ Search $\rightarrow$ Itinerary $\rightarrow$ Recalculate $\rightarrow$ Complete.
  2. Chaos Resilience Drill:
     - Terminate AI Service: Verify Planning falls back to Greedy heuristic (zero tour failures); Core falls back to rating sort.
     - Terminate Planning Service: Verify Core remains 100% operational (catalog browsing, login, reviews unaffected).
  3. Author final thesis documentation: `docs/thesis/MICROSERVICES_BENCHMARK_REPORT.md`.

