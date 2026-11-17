# GASTROWISE – 8-WEEK CONTROLLED MIGRATION PLAN (STRANGLER PATTERN)
**Thesis:** Xây dựng hệ thống thông tin trải nghiệm ẩm thực thông minh (GastroWise)  
**Author:** Senior Software Architect & Tech Lead  
**Planning Date:** November 17, 2026  
**Status:** PHASE 0 COMPLETED — ROADMAP FORMALIZED  

---

## 1. MIGRATION METHODOLOGY & PRINCIPLES

GastroWise will execute an **Incremental Migration (Strangler Fig Pattern)** over an 8-week timeline to transition from the current Modular Monolith to a Microservices Architecture:

1. **No Big-Bang Rewrite:** Existing working code is preserved and refactored incrementally.
2. **Backward Compatibility:** Existing client endpoints remain operational through every transition phase.
3. **Database Segregation Before Physical Decoupling:** Logical database separation (`gastro_core` vs `gastro_planning`) occurs before network isolation.
4. **Independent Verifiability:** Each week concludes with automated build, unit test, and integration test verification before progressing to the next phase.

```mermaid
gantt
    title GastroWise 8-Week Microservices Migration Roadmap
    dateFormat  YYYY-MM-DD
    section Phase 0: Audit
    Week 1: Source Audit & Architecture Design       :done,    w1, 2026-11-17, 7d
    section Phase 1: Foundation
    Week 2: API Contracts & Monorepo Foundation     :active,  w2, after w1, 7d
    section Phase 2: Extraction
    Week 3: Core Service Extraction & Isolation     :         w3, after w2, 7d
    Week 4: Planning Service Extraction & Decoupling:         w4, after w3, 7d
    section Phase 3: Communication & Gateway
    Week 5: AI Integration & Resilience (Fallbacks) :         w5, after w4, 7d
    Week 6: API Gateway Setup & Client Integration  :         w6, after w5, 7d
    section Phase 4: Production & Defense
    Week 7: Dockerization & Security Hardening      :         w7, after w6, 7d
    Week 8: E2E Testing, Failure Drills & Thesis    :         w8, after w7, 7d
```

---

## 2. DETAILED WEEK-BY-WEEK MILESTONES

### WEEK 1: SOURCE AUDIT & ARCHITECTURE DESIGN (COMPLETED)
- **Status:** COMPLETED (Phase 0).
- **Deliverables:**
  - `docs/migration/SOURCE_AUDIT.md`
  - `docs/migration/MODULE_OWNERSHIP.md`
  - `docs/migration/API_DEPENDENCIES.md`
  - `docs/migration/MIGRATION_PLAN.md`
  - `docs/architecture/CURRENT_ARCHITECTURE.md`
  - `docs/architecture/TARGET_ARCHITECTURE.md`
  - `docs/architecture/SERVICE_BOUNDARIES.md`
  - `docs/architecture/DATABASE_OWNERSHIP.md`
- **Criteria:** Zero source code modifications; full consensus on architecture.

---

### WEEK 2: API CONTRACTS & WORKSPACE FOUNDATION
- **Goal:** Establish multi-application monorepo structure in `KLTN-123-GastroWise-BE` and formalize contracts.
- **Tasks:**
  1. Configure `nest-cli.json` for multi-app workspace (`apps/core-service`, `apps/planning-service`).
  2. Create `libs/shared` for pure DTO interfaces, enums, and geo math utilities.
  3. Define OpenAPI/Swagger specifications for Core, Planning, and AI services.
  4. Implement `HealthModule` with `/health` endpoints (liveness & readiness checks) across services.
  5. Establish environment configuration templates (`.env.core.example`, `.env.planning.example`).
- **Rollback Plan:** Revert `nest-cli.json` and keep single monolith app.
- **Acceptance Criteria:** `nest build core-service` and `nest build planning-service` scaffold and compile independently.

---

### WEEK 3: CORE SERVICE EXTRACTION
- **Goal:** Isolate Core Service into `apps/core-service` with dedicated database `gastro_core`.
- **Tasks:**
  1. Migrate modules: Auth, Users, Restaurants, Menu Items, Reviews, Favorites, Taste DNA, Interactions, Contacts.
  2. Configure connection to `gastro_core` database.
  3. Expose internal REST endpoints: `GET /internal/restaurants/candidates`, `GET /internal/taste-dna/:userId`.
  4. Implement `InternalAuthGuard` validating `X-Internal-Service-Key`.
  5. Fix review mutation security defect (add `JwtAuthGuard` and ownership checks to `reviews.controller.ts`).
  6. Execute unit and integration tests.
- **Rollback Plan:** Core modules remain mirrored in root monolith until standalone tests achieve 100% pass.
- **Acceptance Criteria:** Core Service boots on port `3001`, connects to `gastro_core`, and passes all auth, user, restaurant, and review unit tests.

---

### WEEK 4: PLANNING SERVICE EXTRACTION
- **Goal:** Isolate Planning Service into `apps/planning-service` with dedicated database `gastro_planning`.
- **Tasks:**
  1. Migrate `ItinerariesModule` and schemas into `apps/planning-service`.
  2. Remove `@InjectModel(Restaurant.name)` and cross-imports from `ItinerariesService`.
  3. Implement `CoreApiClient` in Planning Service using `@nestjs/axios` to query `/internal/restaurants/candidates`.
  4. Store denormalized snapshot data (`restaurant_name`, `lat`, `lng`, `estimated_cost`) in `ItineraryStop`.
  5. Configure connection to `gastro_planning` database.
  6. Execute itinerary generation and stop reordering tests.
- **Rollback Plan:** Re-enable monolithic `ItinerariesModule` if inter-service REST calls fail.
- **Acceptance Criteria:** Planning Service boots on port `3003`, connects to `gastro_planning`, calls Core Service via REST, generates tours, and passes all itinerary tests.

---

### WEEK 5: AI INTEGRATION & SERVICE RESILIENCE
- **Goal:** Standardize inter-service communication and enforce resilience and mutual authentication.
- **Tasks:**
  1. Fix AI URL routing discrepancies: Align BE calls with FastAPI routes (`/recommend/hybrid`, `/cf/train`, `/copilot/message`).
  2. Implement `X-Internal-AI-Key` validation in FastAPI `main.py` and inject header in NestJS `HttpService`.
  3. Fix 5.4★ rating normalization bug in `KLTN-123-GastroWise-AI/app/db/mongo.py` (`rating = raw / 2.0` if $>5.0$).
  4. Decouple `nlu_service.py` from `cv2` by moving nutrition data to standalone module.
  5. Implement timeout budgets (3500ms on routing) and graceful fallback heuristics.
- **Rollback Plan:** Revert to fallback heuristics if AI authentication blocks requests.
- **Acceptance Criteria:** All AI endpoints return 200 OK with valid credentials; invalid requests receive 401; recommendations display accurate ratings $\le 5.0$.

---

### WEEK 6: API GATEWAY & CLIENT INTEGRATION
- **Goal:** Deploy API Gateway and unify client entrypoints.
- **Tasks:**
  1. Configure Nginx reverse proxy routing:
     - `/api/v1/itineraries/*` $\rightarrow$ Planning Service (`:3003`)
     - `/api/v1/*` $\rightarrow$ Core Service (`:3001`)
  2. Implement Gateway CORS policy and rate limiting.
  3. Update `KLTN-123-GastroWise-FE` `NEXT_PUBLIC_API_GATEWAY_URL`.
  4. Update `KLTN-123-GastroWise-Admin-FE` `NEXT_PUBLIC_API_URL`.
  5. Update `KLTN-123-GastroWise-Mobile` `EXPO_PUBLIC_API_URL`.
  6. Verify end-to-end client flows on all 3 frontends.
- **Rollback Plan:** Gateway routes all traffic to legacy monolith port 3001.
- **Acceptance Criteria:** All 3 clients perform login, venue browsing, and itinerary creation through the Gateway without hardcoded internal service URLs.

---

### WEEK 7: DOCKER, SECURITY & OBSERVABILITY
- **Goal:** Containerize all services and establish production-grade deployment scripts.
- **Tasks:**
  1. Write multi-stage Dockerfiles for `core-service`, `planning-service`, and `ai-service`.
  2. Write `docker-compose.yml` orchestrating Gateway, Core, Planning, AI, and Mongo services.
  3. Implement correlation ID middleware (`X-Correlation-Id`) across Gateway, Core, and Planning.
  4. Enforce container health checks (`docker-compose ps` reports healthy).
  5. Conduct security audit: verify zero hardcoded credentials, test file upload limits (5MB limit on image search).
- **Rollback Plan:** Run services natively via `npm run start` and `uvicorn main:app`.
- **Acceptance Criteria:** `docker compose up -d` boots entire platform from cold state in $<60\text{ s}$; all health checks report healthy.

---

### WEEK 8: END-TO-END TESTING & THESIS PREPARATION
- **Goal:** Execute comprehensive system validation, chaos failure testing, and finalize thesis defense artifacts.
- **Tasks:**
  1. Run End-to-End Test Suite: User Registration $\rightarrow$ Taste DNA $\rightarrow$ Nearby Search $\rightarrow$ Itinerary Generation $\rightarrow$ Reorder Stops.
  2. Run Failure Drills:
     - Terminate AI Service: Verify Planning Service falls back to internal heuristic; Core falls back to rating sort.
     - Terminate Planning Service: Verify Core Service remains 100% operational (discovery, login, reviews unaffected).
  3. Author final thesis documentation:
     - `docs/architecture/MICROSERVICES_ARCHITECTURE.md`
     - `docs/testing/INTEGRATION_TEST_REPORT.md`
     - `docs/thesis/BEFORE_AFTER_COMPARISON.md`
     - `docs/thesis/DEMO_SCENARIOS.md`
  4. Rehearse thesis presentation demo flows.
- **Acceptance Criteria:** 100% required thesis documentation ready; demo script runs reliably without manual workarounds.

---

## 3. TWO-PERSON TEAM RESPONSIBILITY SPLIT

```
┌───────────────────────────────────────┬───────────────────────────────────────┐
│ MEMBER 1: Core & Gateway Lead         │ MEMBER 2: Planning & AI Lead          │
├───────────────────────────────────────┼───────────────────────────────────────┤
│ • Core Service Extraction             │ • Planning Service Extraction         │
│ • Authentication & User Management    │ • Itinerary Generation & Management   │
│ • Restaurant & Menu Catalog           │ • Route Optimization Orchestration    │
│ • Reviews, Favorites & Interactions   │ • AI Service Communication & Auth     │
│ • API Gateway Configuration (Nginx)   │ • AI Model Quality & 5.4★ Bug Fix     │
│ • Gateway Security & CORS             │ • Graceful Fallback Heuristics        │
│ • Customer & Admin FE Integration     │ • Mobile App Integration              │
└───────────────────────────────────────┴───────────────────────────────────────┘
```

---

## 4. STRICT CHANGE MANAGEMENT RULES
1. **Never commit production credentials:** Verify `.env` is ignored before every commit.
2. **Never break existing APIs:** If an API must change, version it (`/api/v2`) and deprecate gracefully.
3. **Never skip automated tests:** No task is marked completed without passing tests.
4. **Approval Gate:** Approval from both team members is required before initiating Phase 1.

