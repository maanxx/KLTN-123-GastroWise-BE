# M9.3 — DTO & Schema Validation Test Report

- **Repository:** `maanxx/KLTN-123-GastroWise-BE`
- **Branch:** `feature/m9-3-dto-schema-integrity`
- **Execution Date:** `2026-11-26`
- **Companion Doc:** [`M9_3_DTO_SCHEMA_ALIGNMENT.md`](./M9_3_DTO_SCHEMA_ALIGNMENT.md)

---

## 1. Automated Test Coverage Executed

Executed `npm run test:microservices` (`jest libs/ apps/`):

| Suite | Scope Covered | Scenarios Verified | Status |
|---|---|---|---|
| `apps/core-service/src/reviews/dto-schema-integrity.spec.ts` | Global `ValidationPipe({ whitelist: true, transform: true })`, `CreateReviewDto`, `UpdateReviewDto`, `ReviewsService.create`, nested `BatchInteractionDto`, `CreateRestaurantDto`, `CreateMenuItemDto`, `CreateUserDto`, `UpdateUserDto`, `UpdateContactStatusDto`, `UpdateTasteDnaDto`, `GenerateItineraryDto`, `UpdateItineraryStatusDto`, and Mongoose schemas | 1. Valid 1–5 review accepted & unknown field stripped<br/>2. Missing required fields rejected (`400`)<br/>3. Invalid rating (`0`, `6`, `10`, `'five'`, `null`) rejected (`400`)<br/>4. Invalid `userId` / unresolvable `restaurantId` rejected (`400`)<br/>5. Nested invalid event in `BatchInteractionDto` rejected (`400`)<br/>6. Nullable `pinnedAt: null` supported; invalid dates/enums rejected<br/>7. Schema & DTO parity verified for `Review`, `MenuItem`, `Contact`, `Restaurant`, `Itinerary`<br/>8. Admin-FE compatibility preserved | **PASS** |
| `libs/shared/src/contracts/data-integrity.spec.ts` | Shared contracts + M9.3 `CreateReviewDto` (`@Max(5)`) & `CreateUserDto` (`@IsUrl()` on `picture`) assertions | Existing schema & DTO assertions updated cleanly for M9.3 fixes | **PASS** |
| Remaining 24 Existing Microservice Suites | `auth`, `users`, `restaurants`, `reviews`, `contacts`, `taste-dna`, `itineraries`, `migrations`, `acl`, `ai.contracts` | All existing controller/service/security tests green | **PASS** |

---

## 2. Build & Linting Results

- `npx eslint` on modified/created M9.3 source & test files: **0 errors, 0 warnings**
- `npm run build:shared`: **PASS**
- `npm run build:core`: **PASS**
- `npm run build:planning`: **PASS**
- `npx tsc -p tsconfig.build.json --noEmit`: **PASS**
