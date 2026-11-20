# GASTROWISE — NEXT TASKS & VERIFICATION ROADMAP

**Branch:** `refactor/microservices-backend`  
**Current Phase Completed:** Milestone 1 & Milestone 1.1 (Security Review Conditions Resolved)  
**Next Phase:** Milestone 2 (Data Flow & Domain Boundary Optimization) — *Awaiting Human Review*  

---

## 1. COMPLETED IN MILESTONE 1 & 1.1
- [x] Removed all insecure default secrets from `docker-compose.yml`, `auth.service.ts`, `core-api.client.ts`, `ai-api.client.ts`.
- [x] Hardened mutual service authentication with constant-time verification and missing server configuration checks.
- [x] Structured error differentiation in `CoreApiClient` (401/403, 503/timeout/refused, 500, 404).
- [x] Eliminated silent fallback in `AiApiClient` on authentication failure.
- [x] Standardized JWT validation (`issuer: 'gastrowise-auth'`, `audience: 'gastrowise-api'`).
- [x] Fixed DTO whitelist stripping in `CreateReviewDto` and entrypoint ValidationPipe.
- [x] Added 22 security unit tests (`security.spec.ts`, `jwt.strategy.spec.ts`, `internal-auth.guard.spec.ts`).
- [x] Completed Independent Verification Review: PASS WITH CONDITIONS (`MILESTONE_1_VERIFICATION_REVIEW.md`).
- [x] **Milestone 1.1:** Resolved Condition 1 (rethrow `UnauthorizedException` in `ItinerariesService`).
- [x] **Milestone 1.1:** Resolved Condition 2 (constructor fail-fast check in `RestaurantsService` and `ReviewsService` header injection).
- [x] Documented results in `docs/security/MILESTONE_1_1_CONDITIONS_RESOLUTION.md`.

---

## 2. PENDING TASKS FOR MILESTONE 2 (UPON APPROVAL)
- [ ] Evaluate secret rotation mechanisms (dual-key or versioning headers).
- [ ] Implement token-bucket rate limiting on internal provider endpoints.
- [ ] Refine domain boundary data caching in Planning Service ACL.
- [ ] Staging dual-run verification against MongoDB staging cluster.

---

## 2. PRE-MERGE CHECKLIST BEFORE MERGING `refactor/microservices-backend` INTO `develop`

1. Human code review approval from team leads.
2. Verified that zero production credentials exist in Git history.
3. Confirmation that all 6 microservices unit test suites pass (`npm run test:microservices`).
4. Staging end-to-end integration test passes across Mobile $\rightarrow$ Gateway $\rightarrow$ Services.
