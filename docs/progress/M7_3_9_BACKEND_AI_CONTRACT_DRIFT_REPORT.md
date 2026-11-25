# M7.3.9 — Backend AI Contract Drift Remediation Report

- **Repository:** `maanxx/KLTN-123-GastroWise-BE`
- **Branch:** `fix/m7-3-ai-contract-drift` (branched from `fix/m2.3-backend-integration-security` `43d1acd`, preserving all M2.2/M2.3 security & integration commits ahead of `main` `abf7b74`)
- **Final Verdict:** **`PASS — BACKEND CONTRACT DRIFT RESOLVED`**

---

## 1. Root Cause of Each Issue

### Issue BE-01 — Stale TypeScript AI DTO Contracts (`libs/shared/src/contracts/ai.contracts.ts`)
- **Root Cause:** Early TypeScript DTOs in `libs/shared/src/contracts/ai.contracts.ts` (`HybridRecommendationRequest`, `HybridRecommendationResponse`, `SentimentAnalysisRequest`, `SentimentAnalysisResponse`, `CopilotMessageRequest`, `CopilotMessageResponse`) drifted from actual FastAPI Pydantic schemas (`app/schemas/recommendation.py`, `app/schemas/sentiment.py`, `app/schemas/copilot.py`), using legacy field names (`top_k`, `current_location`, `taste_dna`, `recommendations`/`restaurant_id`, `text`, `user_id`/`history`/`context`/`slots`) while runtime Core callers sent FastAPI's actual fields directly as untyped objects.

### Issue BE-02 — `order_index` Double Offset (`AiApiClient` & `ItinerariesService`)
- **Root Cause:**
  - FastAPI `/routes/optimize` returns **1-based** `order_index` (`1, 2, 3, ...`), and `AiApiClient.optimizeRoute` passed `1, 2, 3` through untouched (verified by `security.spec.ts`), whereas `AiApiClient.solveGreedyHeuristic` initialized `let order = 0` (`0, 1, 2, ...`).
  - `ItinerariesService.generateItinerary` (`apps/planning-service/src/itineraries/itineraries.service.ts`) blindly added `+ 1` (`order_index: s.order_index + 1`), causing AI-optimized stops to become **`2, 3, 4`** while heuristic stops were `1, 2, 3`.

### Issue BE-03 — `ReviewsService` Missing Fail-Fast `INTERNAL_AI_KEY` Configuration (`apps/core-service/src/reviews/reviews.service.ts`)
- **Root Cause:** Unlike `RestaurantsService` and `AiApiClient` (which fail fast in their constructors if `INTERNAL_AI_KEY` is unset and always send `X-Internal-AI-Key`), `ReviewsService.analyzeSentiment` conditionally attached `X-Internal-AI-Key` only when `process.env.INTERNAL_AI_KEY` existed. If unset, it sent unauthenticated HTTP requests to AI (`401`) and silently masked auth failures behind rule-based sentiment fallback.

---

## 2. Files Modified / Added

| File | Purpose |
|---|---|
| `libs/shared/src/contracts/ai.contracts.ts` | Synchronized `HybridRecommendationRequest/Response/Item`, `SentimentAnalysisRequest/Response`, `CopilotMessageRequest/Response`, and `CandidateStopItem`/`RouteOptimize*` optionality/defaults with FastAPI OpenAPI `3.1.0` |
| `libs/shared/src/contracts/ai.contracts.spec.ts` | Added compile & instantiation tests verifying synchronized shared AI contracts |
| `apps/planning-service/src/acl/ai-api.client.ts` | Standardized canonical 1-based `order_index` (`1, 2, 3...`) across both AI solver (normalizing any 0-based payloads) and `solveGreedyHeuristic` (`let order = 1`) |
| `apps/planning-service/src/itineraries/itineraries.service.ts` | Removed unconditional `s.order_index + 1` double offset; array-level zero-based check prevents shifting already 1-based stops |
| `apps/planning-service/src/acl/security.spec.ts` | Added multi-stop AI solver vs greedy fallback `[1, 2, 3]` and empty stops `[]` regression tests |
| `apps/planning-service/src/itineraries/itineraries.service.spec.ts` | Added BE-02 regression tests for first stop (`1`), middle stop (`2`), last stop (`3`), heuristic fallback `[1, 2]`, and empty candidate pool (`[]`) |
| `apps/core-service/src/reviews/reviews.service.ts` | Enforced constructor fail-fast check for `INTERNAL_AI_KEY`, mandatory `X-Internal-AI-Key` header, and explicit `401`/`403` rejection without leaking secrets while keeping network-offline rule-based fallback |
| `apps/core-service/src/reviews/reviews.service.spec.ts` | Added tests for missing/whitespace `INTERNAL_AI_KEY`, valid header attachment, `401`/`403` error propagation, and network-offline fallback |

---

## 3. Before / After `order_index` Behavior

| Path | Before (Buggy) | After (Canonical 1-Based) |
|---|---|---|
| Real AI Solver (`[1, 2, 3]`) $\rightarrow$ `AiApiClient` $\rightarrow$ `ItinerariesService` | **`[2, 3, 4]`** | **`[1, 2, 3]`** |
| `AiApiClient.solveGreedyHeuristic` (`3` stops) | `[0, 1, 2]` (raw) $\rightarrow$ `[1, 2, 3]` | **`[1, 2, 3]`** everywhere |
| `ItinerariesService.recalculateTimetableAndMetrics` | `[1, 2, 3]` | **`[1, 2, 3]`** |
| Legacy 0-based Mock (`[0, 1, 2]`) $\rightarrow$ `ItinerariesService` | `[1, 2, 3]` | **`[1, 2, 3]`** |
| Empty Itinerary (`[]`) | `[]` | **`[]`** |

---

## 4. Regression Tests & Build Results

Executed after final edits:
- **Microservices Jest Suite:**
  ```bash
  npm run test:microservices
  ```
  **Result:** **22/22 test suites passed, 113/113 tests passed** (`1.351s`), including:
  - `libs/shared/src/contracts/ai.contracts.spec.ts`
  - `apps/planning-service/src/acl/security.spec.ts`
  - `apps/planning-service/src/itineraries/itineraries.service.spec.ts`
  - `apps/core-service/src/reviews/reviews.service.spec.ts`
  - `apps/core-service/src/restaurants/restaurants.service.spec.ts`
  - `apps/core-service/src/restaurants/restaurants.recommendation.spec.ts`
- **Shared & Service TypeScript Builds:**
  ```bash
  npm run build:shared && npm run build:all
  ```
  **Result:** Exit `0` (`shared`, `core-service`, and `planning-service` compiled cleanly with zero TypeScript errors).

---

## 5. API Compatibility Results & Remaining Limitations

- **Backward Compatibility:** All existing callers (`RestaurantsService`, `AiApiClient`, `ReviewsService`, `ItinerariesService`) and controller response DTOs remain compatible with zero breaking changes to mobile or frontend endpoints.
- **No AI or Mobile Changes Required:** All three issues resided solely in Backend/Planning; FastAPI OpenAPI contracts in `KLTN-123-GastroWise-AI` (`M7.3`) required zero modification.
- **Remaining Limitations:**
  - Tests use mocked `HttpService` and Mongoose models in offline Jest; full multi-container Docker Compose live verification (`Core` + `Planning` + `AI` + `mongo-test`) remains scheduled for M8 CI integration.
  - Note on branch ancestry: `fix/m7-3-ai-contract-drift` targets merge after `fix/m2.3-backend-integration-security` (`43d1acd`), which holds M2.2/M2.3 microservices security work ahead of `main` (`abf7b74`).
