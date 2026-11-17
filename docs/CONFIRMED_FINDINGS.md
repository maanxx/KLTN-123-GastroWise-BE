# GASTROWISE – CONFIRMED AUDIT FINDINGS REGISTER

**Thesis:** Xây dựng hệ thống thông tin trải nghiệm ẩm thực thông minh (GastroWise)  
**Status:** 13/13 FINDINGS VERIFIED & CONFIRMED AGAINST SOURCE CODE  
**Last Updated:** November 17, 2026  

---

## FINDING-01: AI Route Prefix Mismatch (404 Fallback)
- **Classification:** **CONFIRMED**
- **Severity:** **P0** (Core Functionality Blocker)
- **Source Evidence:**
  - `KLTN-123-GastroWise-BE/src/restaurants/restaurants.service.ts`: Lines 448, 547, 969
  - `KLTN-123-GastroWise-AI/app/api/v1/router.py`: Lines 9–15
  - `KLTN-123-GastroWise-AI/main.py`: Line 32
- **Current Behavior:** Backend hardcodes `${aiBaseUrl}/v1/recommendation/recommend/hybrid`, `/v1/recommendation/cf/train`, and `/v1/copilot/message`. FastAPI mounts routes directly at `/recommend/hybrid`, `/cf/train`, and `/copilot/message` without `/v1`.
- **Expected Behavior:** Request paths match FastAPI router mounting so AI inference executes without triggering 404 catch blocks.
- **Technical Impact:** 100% of hybrid recommendations and copilot queries fail in runtime, silently executing primitive database fallbacks.
- **Proposed Solution:** Update FastAPI router mounting to support both canonical `/v1/...` routes and top-level aliases, or normalize Backend call paths to match FastAPI.
- **Risk of Implementation:** Medium (requires aligning contract between both services).
- **Required Tests:** End-to-end integration test calling `POST /recommend/hybrid` and `POST /copilot/message` expecting HTTP 200 OK with AI response schema.

---

## FINDING-02: Missing Mutual Service Authentication (`X-Internal-AI-Key`)
- **Classification:** **CONFIRMED**
- **Severity:** **P0** (Security Defect - OWASP API2)
- **Source Evidence:**
  - `KLTN-123-GastroWise-AI/main.py`: Lines 22–29
  - `KLTN-123-GastroWise-BE/src/restaurants/restaurants.service.ts`: Lines 333, 448, 547, 969
- **Current Behavior:** FastAPI has `allow_origins=["*"]` and checks zero authentication headers. Backend sends requests without security tokens.
- **Expected Behavior:** FastAPI enforces `Security(verify_internal_key)` on all internal endpoints. Backend injects `X-Internal-AI-Key: <SECRET_KEY>`.
- **Technical Impact:** Unrestricted public execution of CPU-heavy OR-Tools TSPTW optimization and SVD training.
- **Proposed Solution:** Implement `verify_internal_key` dependency using `secrets.compare_digest` in FastAPI; configure NestJS HTTP interceptor with `AI_SECRET_KEY`.
- **Risk of Implementation:** Low (isolated to inter-service headers).
- **Required Tests:** Request without key returns 401 Unauthorized; request with valid key returns 200 OK.

---

## FINDING-03: Broken Object Level Authorization on Reviews
- **Classification:** **CONFIRMED**
- **Severity:** **P0** (Security Defect - OWASP API1 & API5)
- **Source Evidence:** `KLTN-123-GastroWise-BE/src/reviews/reviews.controller.ts`: Lines 19, 48, 53, 58
- **Current Behavior:**
  - `POST /reviews` has no guard; trusts `userId` in body.
  - `DELETE /reviews/:id` has no guard; allows deleting any review.
  - `PATCH /reviews/:id` has no guard; allows modifying any review with unvalidated `any` DTO.
  - `POST /reviews/migrate-sentiment` has no admin guard.
- **Expected Behavior:** All mutating endpoints require `JwtAuthGuard`. Deletion and modification verify that `review.userId.toString() === req.user.id` or `req.user.role === 'admin'`.
- **Technical Impact:** Data corruption, review tampering, vandalism, and loss of trust.
- **Proposed Solution:** Add `@UseGuards(JwtAuthGuard)` and ownership validation logic in `ReviewsService` / `ReviewsController`.
- **Risk of Implementation:** Low (standard NestJS security pattern).
- **Required Tests:** Unit tests asserting 401 on missing token, 403 on non-owner modification, 200 on owner/admin deletion.

---

## FINDING-04: Sensitive Behavioral Matrix Exfiltration
- **Classification:** **CONFIRMED**
- **Severity:** **P0** (Security Defect - OWASP API3)
- **Source Evidence:** `KLTN-123-GastroWise-BE/src/interactions/interactions.controller.ts`: Lines 67–70
- **Current Behavior:** `GET /interactions/matrix?limit=5000` is publicly exposed without authentication.
- **Expected Behavior:** Endpoint restricted to Admin users or internal microservices via `Roles(Role.Admin)` and `X-Internal-Service-Key`.
- **Technical Impact:** Full dump of user behavior, IDs, preferences, and timestamps to unauthorized clients.
- **Proposed Solution:** Guard with `@UseGuards(JwtAuthGuard, RolesGuard)` and `@Roles('admin')`.
- **Risk of Implementation:** Very Low.
- **Required Tests:** Anonymous call returns 401; user call returns 403; admin call returns matrix data.

---

## FINDING-05: AI Foody Rating Scale Normalization Flaw (The 5.4★ Anomaly)
- **Classification:** **CONFIRMED**
- **Severity:** **P1** (Algorithmic / Data Quality Defect)
- **Source Evidence:**
  - `KLTN-123-GastroWise-AI/app/db/mongo.py`: Line 58
  - `KLTN-123-GastroWise-AI/app/core/recommender.py`: Lines 423–424
- **Current Behavior:** `temp_df.rename(columns={'diemTrungBinh': 'rating'})` leaves ratings on Foody 10-point scale. A 5.4/10 restaurant (2.7★ actual) is tagged as `"⭐ Đánh giá xuất sắc (5.4★)"`.
- **Expected Behavior:** Rating scaled to 5-star standard: `rating = round(r / 2.0, 1) if r > 5.0 else round(r, 1)`.
- **Technical Impact:** Misleading recommendations, severe user experience degradation, and loss of credibility during thesis demo.
- **Proposed Solution:** Apply rating normalization in `app/db/mongo.py` during dataframe loading.
- **Risk of Implementation:** Very Low (pure data transformation).
- **Required Tests:** Unit test verifying restaurant with raw 5.4 becomes 2.7 and receives no false excellence badge.

---

## FINDING-06: Cross-Domain Database & Service Coupling in `ItinerariesService`
- **Classification:** **CONFIRMED**
- **Severity:** **P1** (Architecture Boundary Violation)
- **Source Evidence:** `KLTN-123-GastroWise-BE/src/itineraries/itineraries.service.ts`: Lines 88–93
- **Current Behavior:** Directly injects `RestaurantModel`, `TasteDnaService`, and `InteractionsService` across bounded contexts.
- **Expected Behavior:** Planning Service communicates with Core Service exclusively via REST API (`/internal/restaurants/candidates`) and stores snapshot value objects.
- **Technical Impact:** Blocks database isolation; changes in restaurant schema break itinerary generation.
- **Proposed Solution:** Decouple into standalone `apps/planning-service` with Anti-Corruption Layer (ACL).
- **Risk of Implementation:** Medium (handled in Milestone 3).
- **Required Tests:** Planning Service builds and runs independently with mocked Core REST API.

---

## FINDING-07: Port Discrepancy for Food Image Prediction
- **Classification:** **CONFIRMED**
- **Severity:** **P1** (Configuration Defect)
- **Source Evidence:** `KLTN-123-GastroWise-BE/src/restaurants/restaurants.service.ts`: Line 223
- **Current Behavior:** Falls back to `http://127.0.0.1:8000` instead of port `5000`.
- **Expected Behavior:** Fallback defaults consistently to `http://127.0.0.1:5000`.
- **Technical Impact:** Image recognition crashes with connection refused when `AI_SERVICE_URL` is omitted.
- **Proposed Solution:** Change default port from 8000 to 5000 in `restaurants.service.ts:223`.
- **Risk of Implementation:** Very Low (1-line fix).
- **Required Tests:** Verify default URL points to port 5000.

---

## FINDING-08: Architectural Contradiction on AI Database Access
- **Classification:** **CONFIRMED**
- **Severity:** **P1** (Architecture Inconsistency)
- **Source Evidence:** `SERVICE_BOUNDARIES.md:13` vs `DATABASE_OWNERSHIP.md:42, 52` & `app/db/mongo.py:48-50`
- **Current Behavior:** Boundaries doc stated Zero Database Sharing, while Database Ownership doc and actual code connect AI directly to MongoDB Atlas.
- **Expected Behavior:** Formal demarcation of Interim State (Phase 0-3: read-only find via `gastrowise_ai_service`) vs Target State (Phase 4: Pure REST candidate ingestion).
- **Technical Impact:** Confusion among developers regarding data boundaries.
- **Proposed Solution:** Reconciled in documentation (ADR-05).
- **Risk of Implementation:** Zero (documentation formalization).
- **Required Tests:** Atlas RBAC rejection tests verified.

---

## FINDING-09: Database Split Procedure Lacks Operational Safeguards
- **Classification:** **CONFIRMED**
- **Severity:** **P1** (Database Operational Risk)
- **Source Evidence:** `DATABASE_OWNERSHIP.md:94-112`
- **Current Behavior:** Raw `$out` aggregation without pre-migration dump, parity validation, or index rebuilding.
- **Expected Behavior:** 4-stage pipeline: Backup Snapshot (`mongodump`) $\rightarrow$ `$merge` split $\rightarrow$ Parity check (`countDocuments()`) $\rightarrow$ Rollback drill.
- **Technical Impact:** Risk of dropped indexes (e.g. `2dsphere`) or data loss during migration.
- **Proposed Solution:** Formally updated in `DATABASE_OWNERSHIP.md` (ADR-06).
- **Risk of Implementation:** Low.
- **Required Tests:** Parity validation script dry-run.

---

## FINDING-10: Mobile API Prefix Mismatch
- **Classification:** **CONFIRMED**
- **Severity:** **P1** (Integration Defect)
- **Source Evidence:** `KLTN-123-GastroWise-Mobile/.env:6` vs `KLTN-123-GastroWise-BE/src/main.ts`
- **Current Behavior:** Mobile app expects `/api/v1` prefix, but NestJS has no global prefix.
- **Expected Behavior:** API Gateway maps `/api/v1/*` to backend microservices, or NestJS configures prefix.
- **Technical Impact:** Direct connection from mobile to backend fails with 404.
- **Proposed Solution:** Configured via Nginx API Gateway in Milestone 6.
- **Risk of Implementation:** Low.
- **Required Tests:** Mobile client HTTP probes return 200 OK.

---

## FINDING-11: OpenCV Dependency Coupling in NLU Test
- **Classification:** **CONFIRMED**
- **Severity:** **P2** (Test Environment Defect)
- **Source Evidence:** `KLTN-123-GastroWise-AI/app/core/nlu_service.py:3`
- **Current Behavior:** `nlu_service.py` imports `VIETNAMESE_FOOD_NUTRITION` from `vision_service.py`, which imports `cv2`. Running `test_nlu_copilot.py` fails if OpenCV is not installed.
- **Expected Behavior:** NLU text processing does not depend on computer vision binaries.
- **Technical Impact:** Blocks isolated testing of the dialogue engine.
- **Proposed Solution:** Decouple nutrition table into `app/core/nutrition_data.py`.
- **Risk of Implementation:** Very Low.
- **Required Tests:** `python test_nlu_copilot.py` passes without `cv2`.

---

## FINDING-12: Historical Credential Exposure in `remediate-config.js`
- **Classification:** **CONFIRMED**
- **Severity:** **P2** (Credential Hygiene)
- **Source Evidence:** `KLTN-123-GastroWise-BE/scripts/remediate-config.js`
- **Current Behavior:** File committed in git HEAD containing plaintext MongoDB credentials for user `thienthien`.
- **Expected Behavior:** No credentials in repository; `.gitignore` ignores `scripts/remediate*.js`.
- **Technical Impact:** Credential leakage in git repository.
- **Proposed Solution:** Untrack file (`git rm scripts/remediate-config.js`), update `.gitignore`, rotate user on Atlas.
- **Risk of Implementation:** Zero.
- **Required Tests:** `git status` verifies file is untracked.

---

## FINDING-13: Missing Test Module Mock Providers in Jest Suites
- **Classification:** **CONFIRMED**
- **Severity:** **P2** (Test Infrastructure Defect)
- **Source Evidence:** `restaurants.controller.spec.ts`, `restaurants.service.spec.ts`, `reviews.controller.spec.ts`, `reviews.service.spec.ts`
- **Current Behavior:** 4 test suites fail due to missing NestJS dependency injection mocks in RootTestModule.
- **Expected Behavior:** All unit tests pass cleanly with mocked dependencies.
- **Technical Impact:** Obscures real regression failures.
- **Proposed Solution:** Provide mock providers in test modules during Milestone 2.
- **Risk of Implementation:** Low.
- **Required Tests:** `npm test` passes 14/14 suites.

