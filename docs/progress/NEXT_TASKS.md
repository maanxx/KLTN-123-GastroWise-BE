# GASTROWISE — NEXT TASKS & VERIFICATION ROADMAP

**Branch:** `fix/m2.3-backend-integration-security`  
**Current Phase Completed:** Milestone 2.3 & 2.3.1 (Security Hardening, Planning-AI Integration & Deep Code Review)  
**Next Phase:** Sprint 3 (Atlas Database Splitting, Mobile Gateway Alignment & Frontend E2E)  

---

## 1. COMPLETED MILESTONES
- [x] **Milestone 1:** Removed all insecure default secrets, hardened mutual auth guard, standardized JWT validation.
- [x] **Milestone 1.1:** Resolved Condition 1 (`UnauthorizedException` rethrown in `ItinerariesService`) and Condition 2 (`RestaurantsService` constructor fail-fast).
- [x] **Milestone 2.1:** Verified independent builds for Core Service, Planning Service, Shared Library, and AI Service (100% PASS).
- [x] **Milestone 2.2:** Validated Docker Compose topology, isolated test databases, and identified 5 security/integration findings.
- [x] **Milestone 2.3:** Implemented User IDOR protection (`SafeUserResponseDto`), Contacts RBAC, Nginx CORS allowlist, AI fail-closed auth, Planning $\rightarrow$ AI canonical contract alignment, and circuit breaker fail-closed policy.
- [x] **Milestone 2.3.1 (Deep Code Review & Audit):** Resolved missing `X-Internal-AI-Key` across Core Service endpoints (`/predict-food`, `/weather-recommend`, `/recommend`), updated and verified all 14 unit test suites in Core Service (64/64 pass) and Planning Service (31/31 pass), reconciled known issues ISSUE-09, ISSUE-10, ISSUE-12.

---

## 2. PENDING TASKS FOR SPRINT 3
- [ ] Review and merge PR for branch `fix/m2.3-backend-integration-security`.
- [ ] Milestone 4: AI Recommender rating badge normalization ($10 \rightarrow 5$ stars) and vision model optimizations.
- [ ] Milestone 5: Database splitting on MongoDB Atlas during scheduled maintenance (`scripts/db-split-dryrun.ts`).
- [ ] Milestone 6: Mobile app integration: update `EXPO_PUBLIC_API_URL` to point to API Gateway port 8080.
- [ ] Revoke / delete legacy historical database user `thienthien` directly on MongoDB Atlas console.
