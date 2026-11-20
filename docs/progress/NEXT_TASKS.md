# GASTROWISE — NEXT TASKS & VERIFICATION ROADMAP

**Branch:** `refactor/microservices-backend`  
**Current Phase Completed:** Milestone 2.2 (Docker Orchestration & Network Validation Audit)  
**Next Phase:** Milestone 2.3 (Runtime & Health Check Validation with Isolated Local Database)  

---

## 1. COMPLETED IN MILESTONES 1, 1.1, 2.1 & 2.2
- [x] **Milestone 1:** Removed all insecure default secrets, hardened mutual auth guard, standardized JWT validation.
- [x] **Milestone 1.1:** Resolved Condition 1 (`UnauthorizedException` rethrown in `ItinerariesService`) and Condition 2 (`RestaurantsService` constructor fail-fast).
- [x] **Milestone 2.1:** Verified independent builds for Core Service, Planning Service, Shared Library, and AI Service (100% PASS).
- [x] **Milestone 2.2:** Validated Docker Compose topology, resolved missing AI Dockerfile, added `.dockerignore` files, and executed strict safety stop before live container startup.

---

## 2. PENDING TASKS FOR MILESTONE 2.3 (UPON DOCKER DAEMON & LOCAL DB ACTIVATION)
- [ ] Launch Docker Desktop daemon in Windows session.
- [ ] Ensure local isolated MongoDB container/endpoint is configured (never connect to remote cloud Atlas cluster).
- [ ] Execute `docker compose up -d` in isolated staging environment.
- [ ] Perform live HTTP health checks across Gateway (:8080), Core (:3001), Planning (:3003), and AI (:5000).
- [ ] Verify inter-service DNS resolution and mutual authentication over Docker bridge network.

---

## 2. PRE-MERGE CHECKLIST BEFORE MERGING `refactor/microservices-backend` INTO `develop`

1. Human code review approval from team leads.
2. Verified that zero production credentials exist in Git history.
3. Confirmation that all 6 microservices unit test suites pass (`npm run test:microservices`).
4. Staging end-to-end integration test passes across Mobile $\rightarrow$ Gateway $\rightarrow$ Services.
