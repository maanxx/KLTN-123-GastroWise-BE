# GASTROWISE — NEXT TASKS & VERIFICATION ROADMAP

**Branch:** `refactor/microservices-backend`  
**Current Phase Completed:** Phases 1–8 (Services Extraction, ACL, Gateway, DevOps, Security Hardening)  
**Next Phase:** Phase 9–10 (Staging Verification & Production Migration Gate)  

---

## 1. PENDING STAGING VERIFICATION TASKS

- [ ] **Dual-Run Staging Verification:**
  - Spin up `docker-compose up --build -d` in staging environment.
  - Verify Nginx Gateway health check: `curl http://localhost:8080/health`.
  - Verify Core Service health check: `curl http://localhost:3001/health`.
  - Verify Planning Service health check: `curl http://localhost:3003/health`.
- [ ] **Frontend Client Sanity Testing:**
  - Run Customer Web (`KLTN-123-GastroWise-FE`) against Gateway (`http://localhost:8080`).
  - Run Admin Web (`KLTN-123-GastroWise-Admin-FE`) against Gateway (`http://localhost:8080`).
  - Run Mobile App (`KLTN-123-GastroWise-Mobile`) with `EXPO_PUBLIC_API_URL=http://<ip>:8080/api/v1`.
- [ ] **Staging Database Partitioning Execution:**
  - Run `ts-node scripts/db-split-dryrun.ts` against staging MongoDB cluster.
  - Create `gastro_core` and `gastro_planning` databases via `$merge` pipeline.
  - Validate collection document count parity.

---

## 2. PRE-MERGE CHECKLIST BEFORE MERGING `refactor/microservices-backend` INTO `develop`

1. Human code review approval from team leads.
2. Verified that zero production credentials exist in Git history.
3. Confirmation that all 6 microservices unit test suites pass (`npm run test:microservices`).
4. Staging end-to-end integration test passes across Mobile $\rightarrow$ Gateway $\rightarrow$ Services.
