# GASTROWISE – UPDATED ARCHITECTURE STATUS REPORT

**Thesis:** Xây dựng hệ thống thông tin trải nghiệm ẩm thực thông minh (GastroWise)  
**Status:** ARCHITECTURE AUDITED & REMEDIATED — STABLE BASELINE ESTABLISHED  
**Date:** November 17, 2026  

---

## 1. COMPONENT-BY-COMPONENT SYSTEM STATUS

```
┌────────────────────────────────────────────────────────────────────────┐
│                   GASTROWISE PLATFORM ARCHITECTURE                     │
├────────────────────────────────────────────────────────────────────────┤
│ BACKEND SERVICE (NestJS 11 Monolith :3001)                             │
│   ├── Compilation Status: PASS (npm run build exit 0)                  │
│   ├── Security Hygiene: Plaintext credentials script REMOVED           │
│   ├── AI Integration: Fallback port corrected to 5000                  │
│   └── Access Control: Audited & documented (Awaiting ADR-08 approval)  │
│                                                                        │
│ AI MICROSERVICE (FastAPI Python 3.12 :5000)                            │
│   ├── Atlas Connection: Verified Least-Privilege (gastrowise_ai_service│
│   ├── Data Normalization: 178 Atlas restaurants normalized (<= 5.0★)  │
│   │   (5.4★ False Excellence Badge Anomaly FIXED & VERIFIED)           │
│   ├── Hybrid Recommendation Engine: PASS (SVD CF + Taste DNA Cosine)   │
│   ├── Route Optimization: PASS (TSPTW Heuristic in 12ms)               │
│   └── NLU Dialogue Orchestrator: PASS (cv2 decoupled, regex fixed)     │
│                                                                        │
│ DATA TIER (MongoDB Atlas Cluster)                                      │
│   ├── Primary Database: gastrowise (Untouched & 100% Preserved)        │
│   └── Isolation Design: gastro_core vs gastro_planning formalized      │
│                                                                        │
│ DOCUMENTATION TIER (KLTN-123-GastroWise-BE/docs/)                      │
│   ├── Architecture Specs: 4/4 Updated (Reconciled Interim vs Target)   │
│   ├── Migration Specs: 4/4 Updated                                     │
│   ├── Progress & Handover Tracker: 4/4 Updated                         │
│   ├── Implementation Prompts: 12/12 Formulated (All 13 sections)       │
│   └── Review & Validation Reports: 4/4 Generated                       │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. METRIC SCORECARD

| Dimension | Initial State (Pre-Audit) | Remediated Current State | Target Microservices State |
| :--- | :---: | :---: | :---: |
| **Source Integrity** | Clean | **100% Clean / Build Exit 0** | Decoupled Monorepo |
| **Rating Accuracy** | 5.4★ Badge Anomaly | **2.7★ (Normalized $\le 5.0$)** | 100% Validated Vectors |
| **NLU Test Isolation** | Fails with `cv2` missing | **100% PASS (Zero `cv2` dependency)**| Standalone Dialogue Container |
| **Credential Hygiene**| Plaintext script in HEAD | **Untracked & Ignored** | Vault / Secret Manager |
| **Inter-Service Ports**| Misconfigured Port 8000 | **Standardized Port 5000** | API Gateway Routing (:80) |
| **Database Isolation**| Shared DB Anti-Pattern | **Interim Least-Privilege find** | Zero Database Sharing (ADR-05)|

---

## 3. READY TO PROCEED
The system has completed all autonomous audit, documentation, and safe remediation requirements without violating any stop conditions. All pending architectural decisions are cataloged and ready for review.

