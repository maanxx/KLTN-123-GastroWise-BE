# GASTROWISE – IMPLEMENTATION ROADMAP & REMEDIATION PIPELINE

**Thesis:** Xây dựng hệ thống thông tin trải nghiệm ẩm thực thông minh (GastroWise)  
**Strategy:** Phased Incremental Remediation under Strict Quality Gates  
**Last Updated:** November 17, 2026  

---

## 1. REMEDIATION PRIORITY PIPELINE

```
┌────────────────────────────────────────────────────────────────────────┐
│                   IMPLEMENTATION PRIORITY PIPELINE                     │
├────────────────────────────────────────────────────────────────────────┤
│ STAGE 1: IMMEDIATE ISOLATED FIXES (Eligible for Immediate Execution)   │
│   ├── [P2] TASK-IMP-01: Remove remediate-config.js credential leak     │
│   ├── [P1] TASK-IMP-02: AI Rating Normalization (Fix 5.4★ Badge)       │
│   ├── [P1] TASK-IMP-03: Align predict-food default port to 5000        │
│   └── [P2] TASK-IMP-04: Decouple cv2 dependency from NLU Copilot test  │
│                                                                        │
│ STAGE 2: ACCESS CONTROL & SECURITY HARDENING (Requires ADR-08)         │
│   ├── [P0] TASK-IMP-05: Enforce JwtAuthGuard on POST /reviews          │
│   ├── [P0] TASK-IMP-06: Enforce Owner/Admin guard on DELETE & PATCH    │
│   └── [P0] TASK-IMP-07: Restrict GET /interactions/matrix to Admin     │
│                                                                        │
│ STAGE 3: AI SERVICE ROUTING & MUTUAL AUTH (Requires ADR-07)            │
│   ├── [P0] TASK-IMP-08: Resolve 404 URL Router Mismatch in FastAPI     │
│   └── [P0] TASK-IMP-09: Implement X-Internal-AI-Key Mutual Auth        │
│                                                                        │
│ STAGE 4: MONOREPO FOUNDATION (Week 2 / Milestone 1)                    │
│   ├── TASK-IMP-10: Branch feat/milestone-1-foundation                  │
│   ├── TASK-IMP-11: Monorepo configuration (apps/ and libs/shared)      │
│   └── TASK-IMP-12: Health checks (/health) on port 3001 & 3003         │
│                                                                        │
│ STAGE 5: PLANNING DECOUPLING & DATABASE SPLIT (Week 4 / Milestone 3)   │
│   ├── [P1] TASK-IMP-13: Decouple ItinerariesService with ACL           │
│   └── [P1] TASK-IMP-14: 4-Stage Database Split (mongodump -> $merge)   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. TASK SPECIFICATION MATRIX

| Task ID | Finding Ref | Priority | Target Repository | Scope of Change | Pre-requisite / Approval Gate |
| :--- | :---: | :---: | :--- | :--- | :--- |
| **TASK-IMP-01** | FINDING-12 | **P2** | `KLTN-123-GastroWise-BE` | Untrack `scripts/remediate-config.js`, update `.gitignore` | None (Eligible for immediate execution) |
| **TASK-IMP-02** | FINDING-05 | **P1** | `KLTN-123-GastroWise-AI` | Divide raw ratings $> 5.0$ by 2 in `mongo.py` | None (Eligible for immediate execution) |
| **TASK-IMP-03** | FINDING-07 | **P1** | `KLTN-123-GastroWise-BE` | Change fallback port from 8000 to 5000 in `restaurants.service.ts` | None (Eligible for immediate execution) |
| **TASK-IMP-04** | FINDING-11 | **P2** | `KLTN-123-GastroWise-AI` | Decouple `VIETNAMESE_FOOD_NUTRITION` into `nutrition_data.py` | None (Eligible for immediate execution) |
| **TASK-IMP-05** | FINDING-03 | **P0** | `KLTN-123-GastroWise-BE` | Add `JwtAuthGuard` on `POST /reviews` | Requires ADR-08 Approval |
| **TASK-IMP-06** | FINDING-03 | **P0** | `KLTN-123-GastroWise-BE` | Enforce owner/admin check on `DELETE` and `PATCH /reviews/:id` | Requires ADR-08 Approval |
| **TASK-IMP-07** | FINDING-04 | **P0** | `KLTN-123-GastroWise-BE` | Guard `GET /interactions/matrix` with `Roles('admin')` | Requires ADR-08 Approval |
| **TASK-IMP-08** | FINDING-01 | **P0** | `KLTN-123-GastroWise-AI` | Mount `/v1` router aliases in FastAPI | Requires ADR-07 Approval |
| **TASK-IMP-09** | FINDING-02 | **P0** | `BE` & `AI` | Implement `X-Internal-AI-Key` security dependency | Requires ADR-07 Approval |
| **TASK-IMP-10** | - | **Foundation**| `KLTN-123-GastroWise-BE` | Create branch `feat/milestone-1-foundation` | Milestone 1 Gate Approval |
| **TASK-IMP-11** | - | **Foundation**| `KLTN-123-GastroWise-BE` | Scaffold `apps/core-service`, `apps/planning-service`, `libs/shared` | Milestone 1 Gate Approval |
| **TASK-IMP-12** | - | **Foundation**| `KLTN-123-GastroWise-BE` | Health checks and independent builds | Milestone 1 Gate Approval |
| **TASK-IMP-13** | FINDING-06 | **P1** | `KLTN-123-GastroWise-BE` | Extract `ItinerariesService` into Planning Service | Milestone 3 Gate Approval |
| **TASK-IMP-14** | FINDING-09 | **P1** | MongoDB Atlas / BE | Execute 4-stage DB split with `mongodump` & parity check | Requires ADR-06 Approval |

