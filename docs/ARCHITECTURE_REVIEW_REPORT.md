# GASTROWISE – COMPREHENSIVE ARCHITECTURE REVIEW REPORT (PHASE 1 & 2)

**Thesis:** Xây dựng hệ thống thông tin trải nghiệm ẩm thực thông minh (GastroWise)  
**Evaluator Roles:** Senior Software Architect, Senior Backend Engineer, Senior AI/ML Engineer, QA Engineer, Tech Lead  
**Audit Date:** November 17, 2026  
**Repositories Inspected:**
- Backend Service: `KLTN-123-GastroWise-BE` (Commit `f6bc66f`)
- AI Microservice: `KLTN-123-GastroWise-AI` (Commit `7a1e9fc`)
- Supporting Clients: `FE`, `Admin-FE`, `Mobile` (Read-only reference)

---

## 1. EXECUTIVE SUMMARY

An autonomous, deep architectural audit was conducted across the GastroWise platform. The inspection directly evaluated source code, runtime configurations, route decorators, authentication guards, database queries, and test coverage across both the NestJS Backend and Python FastAPI AI services.

### Core Audit Metric:
- **Total Architectural & Code Findings Identified:** 13
- **P0 Critical Severity (Immediate Security / Core Functionality Blocker):** 4
- **P1 High Severity (Architecture Decoupling / Data Integrity / Algorithm Flaw):** 6
- **P2 Medium Severity (Code Cleanup / Test Isolation / Credential Sanitization):** 3
- **Classification Status:** 13/13 findings **CONFIRMED** with direct file and line source code evidence. Zero findings categorized as Not Reproducible or Speculative.

---

## 2. DETAILED AUDIT FINDINGS BY COMPONENT

### A. API Routing & Cross-Service Communication
1. **[FINDING-01 / P0 - CONFIRMED] Cross-Tier Route Prefix Mismatch (404 Fallback)**
   - *Source Evidence:* [restaurants.service.ts:448, 547, 969](file:///D:/GastroWise/KLTN-123-GastroWise-BE/src/restaurants/restaurants.service.ts#L448) vs `KLTN-123-GastroWise-AI/app/api/v1/router.py:9-15` & `main.py:32`.
   - *Current Behavior:* NestJS calls `${aiBaseUrl}/v1/recommendation/recommend/hybrid`, `${aiBaseUrl}/v1/recommendation/cf/train`, and `${aiBaseUrl}/v1/copilot/message`. FastAPI mounts routes without `/v1` or `/recommendation` prefix (`/recommend/hybrid`, `/cf/train`, `/copilot/message`).
   - *Technical Impact:* Every single AI recommendation request, SVD training trigger, and Copilot message fails with HTTP 404. NestJS catches the error and silently drops back to database sort and regex fallback. AI cognitive capability is 100% bypassed in runtime!
   - *Expected Behavior:* Unified API routing contract where requests resolve directly to active FastAPI endpoints without 404s.

2. **[FINDING-07 / P1 - CONFIRMED] Port Discrepancy for Food Image Prediction**
   - *Source Evidence:* [restaurants.service.ts:223-228](file:///D:/GastroWise/KLTN-123-GastroWise-BE/src/restaurants/restaurants.service.ts#L223-L228).
   - *Current Behavior:* `const aiUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000';` while all other AI endpoints default to `http://127.0.0.1:5000`.
   - *Technical Impact:* If `AI_SERVICE_URL` is omitted, image search calls port 8000 and crashes with `ECONNREFUSED`.

---

### B. Security & Access Control
3. **[FINDING-02 / P0 - CONFIRMED] Missing Mutual Service Authentication (`X-Internal-AI-Key`)**
   - *Source Evidence:* `KLTN-123-GastroWise-AI/main.py:22-29` and `KLTN-123-GastroWise-BE/src/restaurants/restaurants.service.ts:448`.
   - *Current Behavior:* FastAPI configures `CORSMiddleware(allow_origins=["*"])` with zero authorization header verification. Backend NestJS makes HTTP calls without injecting any mutual authentication header.
   - *Technical Impact:* Severe OWASP API2 vulnerability. Port 5000 is open to arbitrary network callers who can trigger expensive OR-Tools TSPTW route solvers and SVD model re-training.

4. **[FINDING-03 / P0 - CONFIRMED] Broken Object Level Authorization on Reviews**
   - *Source Evidence:* [reviews.controller.ts:19-58](file:///D:/GastroWise/KLTN-123-GastroWise-BE/src/reviews/reviews.controller.ts#L19-L58).
   - *Current Behavior:*
     - `POST /reviews`: Missing `JwtAuthGuard` (allows client to forge `userId`).
     - `DELETE /reviews/:id` & `PATCH /reviews/:id`: Completely unauthenticated, no ownership verification. Anyone can delete or modify any review in the platform.
     - `POST /reviews/migrate-sentiment`: Unprotected bulk database migration trigger.
   - *Technical Impact:* Critical data tampering and deletion vulnerability (OWASP API1 & API5).

5. **[FINDING-04 / P0 - CONFIRMED] Sensitive Behavioral Matrix Exfiltration**
   - *Source Evidence:* [interactions.controller.ts:67-70](file:///D:/GastroWise/KLTN-123-GastroWise-BE/src/interactions/interactions.controller.ts#L67-L70).
   - *Current Behavior:* `GET /interactions/matrix?limit=5000` is completely unauthenticated and public.
   - *Technical Impact:* Any external crawler or unauthorized client can export all user interaction vectors, IDs, and timestamps.

---

### C. Data Integrity & Algorithmic Flaws
6. **[FINDING-05 / P1 - CONFIRMED] AI Foody Rating Scale Normalization Flaw (The 5.4★ Anomaly)**
   - *Source Evidence:* `KLTN-123-GastroWise-AI/app/db/mongo.py:58` and `app/core/recommender.py:423-424`.
   - *Current Behavior:* `temp_df.rename(columns={'diemTrungBinh': 'rating'}, inplace=True)` without dividing by 2. MongoDB Atlas has 98/178 restaurants with Foody 10-point scale scores $> 5.0$ (e.g. `diemTrungBinh = 5.4`). `recommender.py` evaluates $5.4 \ge 4.7$ as true and displays `"⭐ Đánh giá xuất sắc (5.4★)"` on a 5-star maximum interface.
   - *Expected Behavior:* Normalization: `rating = round(r / 2.0, 1) if r > 5.0 else round(r, 1)`. A 5.4 Foody score correctly translates to 2.7★ without false excellence badges.

7. **[FINDING-09 / P1 - CONFIRMED] Database Split Procedure Lacks Operational Safeguards**
   - *Source Evidence:* `docs/architecture/DATABASE_OWNERSHIP.md:94-112` (original version).
   - *Current Behavior:* Originally proposed a 1-step raw MongoDB aggregation `$out` pipeline to split `gastrowise` into `gastro_core` and `gastro_planning`.
   - *Technical Impact:* `$out` drops existing indexes (including geospatial `2dsphere`) on target collections and offers zero atomicity, document count verification, or rollback procedures.

---

### D. Architectural Coupling & Boundaries
8. **[FINDING-06 / P1 - CONFIRMED] Cross-Domain Coupling in `ItinerariesService`**
   - *Source Evidence:* [itineraries.service.ts:88-93](file:///D:/GastroWise/KLTN-123-GastroWise-BE/src/itineraries/itineraries.service.ts#L88-L93).
   - *Current Behavior:* Directly injects `@InjectModel(Restaurant.name)`, `TasteDnaService`, and `InteractionsService`.
   - *Technical Impact:* Prevents database isolation between Catalog and Planning.

9. **[FINDING-08 / P1 - CONFIRMED] Architectural Contradiction on AI Database Access**
   - *Source Evidence:* `docs/architecture/SERVICE_BOUNDARIES.md` ("Zero Database Sharing") vs `DATABASE_OWNERSHIP.md` & `app/db/mongo.py:50` (FastAPI connects directly to MongoDB Atlas).
   - *Resolution:* Formally reconciled into **Interim State** (Phase 0–3: read-only via `gastrowise_ai_service`) vs **Target State** (Phase 4: Pure REST candidate ingestion).

---

### E. Code Quality & Test Environment
10. **[FINDING-10 / P1 - CONFIRMED] Mobile API Prefix Mismatch**
    - *Source Evidence:* `KLTN-123-GastroWise-Mobile/.env:6` (`.../api/v1`) vs `KLTN-123-GastroWise-BE/src/main.ts` (no global prefix).
11. **[FINDING-11 / P2 - CONFIRMED] OpenCV Dependency Coupling in NLU Test**
    - *Source Evidence:* `KLTN-123-GastroWise-AI/app/core/nlu_service.py:3` imports `vision_service.py` which requires `cv2`.
12. **[FINDING-12 / P2 - CONFIRMED] Historical Credential Exposure in `remediate-config.js`**
    - *Source Evidence:* `KLTN-123-GastroWise-BE/scripts/remediate-config.js` contains committed plaintext connection string of user `thienthien`.
13. **[FINDING-13 / P2 - CONFIRMED] Missing Test Module Mock Providers in Jest Suites**
    - *Source Evidence:* `restaurants.controller.spec.ts`, `restaurants.service.spec.ts`, `reviews.controller.spec.ts`, `reviews.service.spec.ts`.

---

## 3. COMPLIANCE & RISK VERDICT
All 13 findings have verified source code origins. The system must proceed with immediate remediation for P0 security and algorithmic defects, followed by structured architecture decoupling under strict change-control rules.

