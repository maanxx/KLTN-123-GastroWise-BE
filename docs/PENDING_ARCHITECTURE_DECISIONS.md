# GASTROWISE – PENDING ARCHITECTURE DECISIONS REGISTER (ADR)

**Thesis:** Xây dựng hệ thống thông tin trải nghiệm ẩm thực thông minh (GastroWise)  
**Status:** AWAITING TEAM APPROVAL BEFORE IMPLEMENTATION  
**Last Updated:** November 17, 2026  

---

## DECISION-01 (ADR-05): AI Database Access Evolution (Interim vs Target State)

### Context:
`SERVICE_BOUNDARIES.md` mandates "Zero Database Sharing", but AI Service currently connects directly to MongoDB Atlas on startup to load 178 restaurant records for TF-IDF and SVD training.

### Options:
- **Option A (Instant Cutoff):** Immediately remove all MongoDB access from AI. Force Core Service to stream all 178 venues over REST during startup.  
  *Downside:* High HTTP payload during development, blocks AI service if Core is booting.
- **Option B (Two-Stage Evolution - RECOMMENDED):**
  - **Interim State (Phase 0–3):** AI retains isolated, read-only `find` access to `restaurants` collection via least-privilege user `gastrowise_ai_service`.
  - **Target State (Phase 4 / Production):** Deprecate direct connection; Core Service streams candidate snapshots during inference requests (`candidates: [...]`).
- **Approval Status:** **PENDING TEAM CONFIRMATION**

---

## DECISION-02 (ADR-06): Database Migration 4-Stage Strategy with Rollback Drill

### Context:
Splitting `gastrowise` into `gastro_core` and `gastro_planning` using raw `$out` aggregation poses risks of index loss and data drift.

### Options:
- **Option A (Raw `$out`):** Quick 1-step script. *Rejected due to risk of dropping indexes and lack of verification.*
- **Option B (4-Stage Pipeline with Parity Check - RECOMMENDED):**
  1. Pre-Migration Backup (`mongodump` archive with timestamp).
  2. Execution via controlled `$merge` pipeline.
  3. Post-Migration Parity Check (`countDocuments()` parity assertion) & geospatial index reconstruction.
  4. Instantaneous Rollback Drill (re-pointing to untouched `gastrowise` in $< 2$ minutes).
- **Approval Status:** **PENDING TEAM CONFIRMATION**

---

## DECISION-03 (ADR-07): AI Endpoint Contract Alignment Strategy

### Context:
Backend calls `${aiBaseUrl}/v1/recommendation/recommend/hybrid`, while FastAPI listens at `/recommend/hybrid`.

### Options:
- **Option A (Refactor Backend Calls):** Change Backend code to call `/recommend/hybrid`.  
  *Downside:* Inconsistent with public versioning standard (`/v1`).
- **Option B (Dual-Compatibility on FastAPI Router - RECOMMENDED):** Update FastAPI router to mount both canonical `/v1/recommendation/...` and legacy `/recommend/...` aliases.  
  *Benefit:* Zero breaking changes for existing consumers; fully conforms to enterprise REST versioning standards.
- **Approval Status:** **PENDING TEAM CONFIRMATION**

---

## DECISION-04 (ADR-08): Review & Interaction Access Control Policy

### Context:
`DELETE /reviews/:id` and `PATCH /reviews/:id` lack authentication and ownership checks. `GET /interactions/matrix` exposes all interaction logs.

### Options:
- **Option A (Owner or Admin Pattern - RECOMMENDED):**
  - `POST /reviews`: Extract `userId` from verified JWT.
  - `DELETE /reviews/:id` & `PATCH /reviews/:id`: Enforce `review.userId === req.user.id || req.user.role === 'admin'`.
  - `GET /interactions/matrix`: Enforce `@Roles('admin')` OR internal service secret header.
- **Approval Status:** **PENDING TEAM CONFIRMATION**

