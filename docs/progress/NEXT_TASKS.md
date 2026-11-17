# GASTROWISE – NEXT TASKS & REMEDIATION ACTION PLAN
**Milestone tiếp theo:** Milestone 1 – Monorepo Foundation & API Contracts (Week 2)  
**Branch làm việc dự kiến:** `feat/milestone-1-foundation` trên repository `KLTN-123-GastroWise-BE`  
**Trạng thái:** TÀI LIỆU KIẾN TRÚC ĐÃ HIỆU CHỈNH — CHỜ REVIEW TRƯỚC KHI CODE  

---

## 1. MỤC TIÊU CỐT LÕI CỦA MILESTONE 1 (WEEK 2)
1. Thiết lập cấu trúc Monorepo đa ứng dụng trong `KLTN-123-GastroWise-BE` gồm:
   - `apps/core-service/` (Core Culinary, Auth & Identity)
   - `apps/planning-service/` (Journey Planning & Route Optimization)
   - `libs/shared/` (Contracts, Enums, Interfaces, Pure Utilities)
2. Cấu hình `nest-cli.json` và `tsconfig.json` hỗ trợ build độc lập từng service:
   - `nest build core-service`
   - `nest build planning-service`
3. Khởi tạo `HealthModule` kiểm tra liveness & readiness check (`/health`) cho cả hai service.
4. Chuẩn hóa bộ file cấu hình môi trường mẫu (`.env.core.example`, `.env.planning.example`).
5. Dọn dẹp script chứa mật khẩu cũ đã commit (`scripts/remediate-config.js`) [P2].

---

## 2. LỘ TRÌNH REMEDIATION CÁC LỖ HỔNG & PHÁT HIỆN KIẾN TRÚC THEO ƯU TIÊN

```
┌────────────────────────────────────────────────────────────────────────┐
│                   THỨ TỰ ƯU TIÊN XỬ LÝ (PRIORITY PIPELINE)            │
├────────────────────────────────────────────────────────────────────────┤
│ [MILESTONE 1 - Week 2] Foundation & Monorepo Scaffolding               │
│   ├── TASK-M1-01: Tạo branch feat/milestone-1-foundation               │
│   ├── TASK-M1-02: [P2] Xóa scripts/remediate-config.js                 │
│   └── TASK-M1-03: Cấu hình Monorepo (apps/, libs/shared)               │
│                                                                        │
│ [MILESTONE 2 - Week 3] Core Service Hardening & Access Control Fix     │
│   ├── TASK-M2-01: [P0] Vá Broken Access Control trên Reviews           │
│   │               (Gắn JwtAuthGuard trên POST, DELETE, PATCH)          │
│   ├── TASK-M2-02: [P0] Khóa ma trận tương tác GET /interactions/matrix │
│   │               (Yêu cầu Roles(Role.Admin) hoặc Internal Key)        │
│   └── TASK-M2-03: [P1] Sửa default port predict-food về 5000           │
│                                                                        │
│ [MILESTONE 3 - Week 4] Planning Decoupling & DB Split with Rollback    │
│   ├── TASK-M3-01: [P1] Tách Itineraries sang Planning Service (ACL)    │
│   └── TASK-M3-02: [P1] Thực thi 4 giai đoạn Database Split             │
│                   (Backup mongodump -> $merge -> Parity Check)         │
│                                                                        │
│ [MILESTONE 4 - Week 5] AI Service Remediation & Mutual Auth            │
│   ├── TASK-M4-01: [P0] Sửa 404 URL Prefix Mismatch ở FastAPI router    │
│   ├── TASK-M4-02: [P0] Triển khai X-Internal-AI-Key Mutual Auth        │
│   ├── TASK-M4-03: [P1] Chuẩn hóa điểm Foody thang 10 -> 5 (Fix 5.4★)   │
│   └── TASK-M4-04: [P2] Tách nutrition_data.py loại bỏ phụ thuộc cv2    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. DANH MỤC CÔNG VIỆC CHI TIẾT MILESTONE 1 (WEEK 2)

### Giai đoạn 1: Git Branching & Chuẩn bị môi trường
- [ ] **TASK-M1-01:** Tạo branch làm việc mới: `git checkout -b feat/milestone-1-foundation` trong `KLTN-123-GastroWise-BE`.
- [ ] **TASK-M1-02 [P2]:** Xóa bỏ file `scripts/remediate-config.js` khỏi git tracking và thêm `scripts/remediate*.js` vào `.gitignore`.

### Giai đoạn 2: Cấu hình NestJS Monorepo đa ứng dụng
- [ ] **TASK-M1-03:** Cập nhật `nest-cli.json` từ cấu trúc standard sang monorepo structure:
  - Khai báo project `core-service` với root `apps/core-service`
  - Khai báo project `planning-service` với root `apps/planning-service`
  - Khai báo library `shared` với root `libs/shared`
- [ ] **TASK-M1-04:** Cập nhật `tsconfig.json` ở root khai báo path mapping:
  ```json
  "paths": {
    "@shared/*": ["libs/shared/src/*"]
  }
  ```

### Giai đoạn 3: Xây dựng thư viện dùng chung `libs/shared`
- [ ] **TASK-M1-05:** Tạo `libs/shared/src/contracts/`:
  - `core.contract.ts`: Khai báo DTOs `RestaurantCandidateDTO`, `TasteDnaProfileDTO`.
  - `planning.contract.ts`: Khai báo DTOs `ItineraryStopSnapshotDTO`, `RouteOptimizeRequestDTO`.
  - `ai.contract.ts`: Khai báo DTOs `HybridRecommendDTO`, `SentimentAnalysisDTO`.
- [ ] **TASK-M1-06:** Tạo `libs/shared/src/enums/`:
  - `roles.enum.ts` (`Role = { USER, OWNER, ADMIN }`).
  - `routing-mode.enum.ts` (`WALK, MOTORBIKE, CAR`).
  - `itinerary-status.enum.ts` (`DRAFT, CONFIRMED, COMPLETED, CANCELLED`).
- [ ] **TASK-M1-07:** Tạo `libs/shared/src/utils/geo.utils.ts` (Pure math Haversine distance calculator).

### Giai đoạn 4: Khởi tạo Scaffolding cho 2 Services
- [ ] **TASK-M1-08:** Khởi tạo thư mục và file cơ sở cho `apps/core-service/`:
  - `apps/core-service/tsconfig.app.json`
  - `apps/core-service/src/main.ts` (Khởi chạy trên PORT 3001)
  - `apps/core-service/src/core.module.ts`
  - `apps/core-service/src/health/health.controller.ts` (`GET /health`)
- [ ] **TASK-M1-09:** Khởi tạo thư mục và file cơ sở cho `apps/planning-service/`:
  - `apps/planning-service/tsconfig.app.json`
  - `apps/planning-service/src/main.ts` (Khởi chạy trên PORT 3003)
  - `apps/planning-service/src/planning.module.ts`
  - `apps/planning-service/src/health/health.controller.ts` (`GET /health`)
- [ ] **TASK-M1-10:** Soạn thảo bộ file cấu hình môi trường mẫu:
  - `apps/core-service/.env.example` (PORT=3001, MONGODB_URI=.../gastro_core, INTERNAL_SERVICE_SECRET=...)
  - `apps/planning-service/.env.example` (PORT=3003, MONGODB_URI=.../gastro_planning, CORE_SERVICE_URL=http://127.0.0.1:3001, AI_SERVICE_URL=http://127.0.0.1:5000)

### Giai đoạn 5: Build & Smoke Test Verification
- [ ] **TASK-M1-11:** Chạy build độc lập cả hai ứng dụng:
  - `npm run build core-service`
  - `npm run build planning-service`
- [ ] **TASK-M1-12:** Chạy kiểm tra liveness check độc lập trên port 3001 và 3003:
  - `curl http://127.0.0.1:3001/health` $\rightarrow$ 200 OK
  - `curl http://127.0.0.1:3003/health` $\rightarrow$ 200 OK
- [ ] **TASK-M1-13:** Bàn giao tài liệu tiến độ Milestone 1 theo quy chuẩn Handover Protocol.
