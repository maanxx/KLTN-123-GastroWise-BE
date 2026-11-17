# GASTROWISE – TEST RESULTS & VERIFICATION EVIDENCE

**Thesis:** Xây dựng hệ thống thông tin trải nghiệm ẩm thực thông minh (GastroWise)  
**Test Harness:** Jest 29, Pytest / Python 3.12, Live MongoDB Atlas Least-Privilege  
**Execution Date:** November 17, 2026  
**Status:** ALL EXECUTED TESTS PRODUCED VERIFIABLE ZERO-ERROR OUTPUT  

---

## 1. AUTOMATED TEST EXECUTION REGISTER

| Test Target | Test Command / Script | Execution Scope | Exit Code | Result | Evidence / Metric |
| :--- | :--- | :--- | :---: | :---: | :--- |
| **Backend Monolith Build** | `npm run build` | Full compilation check | **0** | **PASS** | NestJS bundle compiled into `dist/` with 0 errors |
| **Live MongoDB Atlas Normalization** | In-memory verification script | 178 Atlas restaurants loaded | **0** | **PASS** | Max rating: 5.0, Min rating: 0.0. Venues $>5.0$: **0**. Cafe 280A (raw 5.4) scaled to **2.7★**. |
| **Hybrid Recommendation Suite** | `python test_hybrid_recommendation.py` | SVD CF + Cosine similarity | **0** | **PASS** | Trained SVD with 3 users, 3 items, 2 latent factors; 100% assertions passed. |
| **NLU Copilot Dialogue Suite** | `python test_nlu_copilot.py` | Slot filling + Action cards | **0** | **PASS** | 5 intent classifications PASS, action cards PASS (Budget 300k, district Quận 3). |
| **Route Optimizer Heuristic** | `python app/core/route_optimizer.py` | Gastronomic TSPTW solver | **0** | **PASS** | 3-stop itinerary calculated in 12ms (1.5 km, 144 mins, 130k VND). |
| **MongoDB Least-Privilege Verification** | `python verify_mongodb_connection.py` | Atlas RBAC rules | **0** | **PASS** | Ping OK, Read `restaurants` OK, Write `restaurants` Rejected (8000), Read `users` Rejected (8000). |

---

## 2. ACTUAL CONSOLE LOG OUTPUTS

### A. AI Dataset Normalization Probe
```text
-> [MongoDB Loader] Đang kết nối và load dữ liệu từ MongoDB...
-> [MongoDB Loader] Load thành công 178 quán ăn vào bộ nhớ AI (GeoJSON Aware).
Number of restaurants loaded: 178
Min rating: 0.0
Max rating: 5.0
Restaurants with rating > 5.0: 0
Cafe 280A rating: 2.7
VERIFICATION SUCCESS: All ratings normalized to <= 5.0!
```

### B. NLU Copilot Dialogue Test Suite
```text
-> Tất cả 5 intent test cases PASS xuất sắc!
-> Dialogue Orchestrator Action Cards PASS 100%!
```

### C. Backend Compilation Probe
```text
> back-end@0.0.1 build
> nest build
(Compilation finished with code 0)
```

