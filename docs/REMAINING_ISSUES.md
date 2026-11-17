# GASTROWISE – REMAINING ISSUES & APPROVAL BLOCKERS REGISTER

**Thesis:** Xây dựng hệ thống thông tin trải nghiệm ẩm thực thông minh (GastroWise)  
**Status:** REMAINING ISSUES TRACKED — STOPPED FOR HUMAN REVIEW AS REQUIRED BY STOP CONDITIONS  
**Last Updated:** November 17, 2026  

---

## 1. ISSUES PENDING ARCHITECTURAL APPROVAL (PAUSED UNDER STOP CONDITIONS)

The following high-priority issues were intentionally paused and NOT implemented in Phase 4 because they trigger **STOP CONDITION 1 ("An API contract must change")** or **STOP CONDITION 2 ("An authentication or authorization design is ambiguous")**:

| Issue ID | Severity | Description | Stop Condition Triggered | Required Action / Decision |
| :--- | :---: | :--- | :--- | :--- |
| **ISSUE-01** | **P0** | AI Route Prefix Mismatch (`/v1/...` vs `/...`) | **API Contract Modification:** Mounting `/v1/...` in FastAPI changes URL endpoints. | Approve **ADR-07** (Mount dual-compatible routes in FastAPI). |
| **ISSUE-02** | **P0** | Missing Mutual Service Authentication (`X-Internal-AI-Key`) | **Security Inter-Service Policy:** Adding header enforcement rejects unauthenticated internal calls. | Approve **ADR-07** (Enforce `X-Internal-AI-Key` across BE and AI). |
| **ISSUE-03** | **P0** | Broken Object Level Authorization on Reviews (`DELETE`, `PATCH`, `POST`) | **API Access Control Change:** Adding `JwtAuthGuard` converts previously open endpoints to require Bearer JWT. | Approve **ADR-08** (Enforce Owner/Admin JWT authorization). |
| **ISSUE-04** | **P0** | Sensitive Data Exposure on `GET /interactions/matrix` | **API Authorization Change:** Restricts public matrix dump to Admin role. | Approve **ADR-08** (Restrict endpoint with `Roles('admin')`). |

---

## 2. ISSUES SCHEDULED FOR SUBSEQUENT MILESTONES

| Issue ID | Severity | Description | Scheduled Milestone | Dependency |
| :--- | :---: | :--- | :---: | :--- |
| **ISSUE-05** | **P1** | Cross-Domain Coupling in `ItinerariesService` | Milestone 3 (Week 4) | Requires Monorepo foundation setup (Milestone 1). |
| **ISSUE-06** | **P1** | 4-Stage Database Migration Execution | Milestone 3 (Week 4) | Requires Planning Service extraction and ADR-06 approval. |
| **ISSUE-07** | **P1** | Mobile API Prefix Alignment | Milestone 6 (Week 6) | Requires Nginx API Gateway deployment. |
| **ISSUE-08** | **P2** | 4 Failing Jest Spec Mock Providers | Milestone 2 (Week 3) | Test module provider configuration update. |
| **ISSUE-09** | **P2** | Historical Atlas User `thienthien` Deletion | Immediate DBA Action | Manual operation on MongoDB Atlas Console. |

---

## 3. KNOWN RISKS & MITIGATION
1. **AI Route Mismatch Risk:** Until ADR-07 is approved and applied, hybrid recommendations in live running backend will continue to fall back to MongoDB database sort.
2. **Review Tampering Risk:** Until ADR-08 is approved and applied, `DELETE /reviews/:id` remains callable without token. Recommended to approve and apply immediately in Milestone 2.

