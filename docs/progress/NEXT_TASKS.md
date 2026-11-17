# GASTROWISE – NEXT TASKS & MILESTONE 1 ACTION PLAN
**Milestone tiếp theo:** Milestone 1 – Monorepo Foundation & API Contracts (Week 2)  
**Branch làm việc dự kiến:** `feat/milestone-1-foundation` trên repository `KLTN-123-GastroWise-BE`  
**Trạng thái:** SẴN SÀNG TRIỂN KHAI — CHỜ PHÊ DUYỆT TỪ NHÓM PHÁT TRIỂN  

---

## 1. MỤC TIÊU CỐT LÕI CỦA MILESTONE 1
1. Thiết lập cấu trúc Monorepo đa ứng dụng trong `KLTN-123-GastroWise-BE` gồm:
   - `apps/core-service/` (Core Culinary, Auth & Identity)
   - `apps/planning-service/` (Journey Planning & Route Optimization)
   - `libs/shared/` (Contracts, Enums, Interfaces, Pure Utilities)
2. Cấu hình `nest-cli.json` và `tsconfig.json` hỗ trợ build độc lập từng service:
   - `nest build core-service`
   - `nest build planning-service`
3. Khởi tạo `HealthModule` kiểm tra liveness & readiness check (`/health`) cho cả hai service.
4. Chuẩn hóa bộ file cấu hình môi trường mẫu (`.env.core.example`, `.env.planning.example`).
5. Dọn dẹp script chứa mật khẩu cũ đã commit (`scripts/remediate-config.js`).

---

## 2. DANH MỤC CÔNG VIỆC CHI TIẾT (TASK BREAKDOWN)

### Giai đoạn 1: Git Branching & Chuẩn bị môi trường
- [ ] **TASK-M1-01:** Tạo branch làm việc mới: `git checkout -b feat/milestone-1-foundation` trong `KLTN-123-GastroWise-BE`.
- [ ] **TASK-M1-02:** Xóa bỏ file `scripts/remediate-config.js` khỏi git tracking và thêm `scripts/remediate*.js` vào `.gitignore`.

### Giai đoạn 2: Cấu hình NestJS Monorepo đa ứng dụng
- [ ] **TASK-M1-03:** Cập nhật `nest-cli.json` từ cấu trúc standard sang monorepo structure:
  ```json
  {
    "collection": "@nestjs/schematics",
    "sourceRoot": "apps/core-service/src",
    "monorepo": true,
    "root": "apps/core-service",
    "compilerOptions": {
      "webpack": true,
      "tsConfigPath": "apps/core-service/tsconfig.app.json"
    },
    "projects": {
      "core-service": {
        "type": "application",
        "root": "apps/core-service",
        "entryFile": "main",
        "sourceRoot": "apps/core-service/src"
      },
      "planning-service": {
        "type": "application",
        "root": "apps/planning-service",
        "entryFile": "main",
        "sourceRoot": "apps/planning-service/src"
      },
      "shared": {
        "type": "library",
        "root": "libs/shared",
        "entryFile": "index",
        "sourceRoot": "libs/shared/src"
      }
    }
  }
  ```
- [ ] **TASK-M1-04:** Cập nhật đường dẫn path mapping trong `tsconfig.json` (`@shared/*` $\rightarrow$ `libs/shared/src/*`).

### Giai đoạn 3: Khởi tạo Thư viện Dùng chung (`libs/shared`)
- [ ] **TASK-M1-05:** Tạo `libs/shared/src/contracts/`:
  - `core.contract.ts`: Đặc tả DTO ứng viên nhà hàng (`RestaurantCandidateDTO`).
  - `planning.contract.ts`: Đặc tả DTO lịch trình và chặng dừng (`ItineraryDTO`, `ItineraryStopDTO`).
  - `ai.contract.ts`: Đặc tả DTO gọi AI (`RouteOptimizeRequestDTO`, `HybridRecommendRequestDTO`).
- [ ] **TASK-M1-06:** Tạo `libs/shared/src/enums/`:
  - `roles.enum.ts`: `Admin`, `Owner`, `User`.
  - `routing-mode.enum.ts`: `motorbike`, `car`, `walking`.
  - `itinerary-status.enum.ts`: `generated`, `confirmed`, `completed`, `cancelled`.
- [ ] **TASK-M1-07:** Tạo `libs/shared/src/utils/geo.utils.ts` (Hàm tính khoảng cách Haversine chuẩn hóa).

### Giai đoạn 4: Scaffold Core Service & Planning Service Foundations
- [ ] **TASK-M1-08:** Tạo cấu trúc khung `apps/core-service`:
  - `apps/core-service/src/main.ts` (Lắng nghe cổng `3001`).
  - `apps/core-service/src/core.module.ts`.
  - `apps/core-service/src/health/health.controller.ts` (`GET /health`).
- [ ] **TASK-M1-09:** Tạo cấu trúc khung `apps/planning-service`:
  - `apps/planning-service/src/main.ts` (Lắng nghe cổng `3003`).
  - `apps/planning-service/src/planning.module.ts`.
  - `apps/planning-service/src/health/health.controller.ts` (`GET /health`).

### Giai đoạn 5: Kiểm tra Build và Xác thực Độc lập
- [ ] **TASK-M1-10:** Chạy build độc lập: `npm run build core-service` $\rightarrow$ Thành công.
- [ ] **TASK-M1-11:** Chạy build độc lập: `npm run build planning-service` $\rightarrow$ Thành công.
- [ ] **TASK-M1-12:** Khởi chạy thử nghiệm cả 2 service và kiểm tra endpoint `/health` trả về `200 OK`.
- [ ] **TASK-M1-13:** Cập nhật 4 tài liệu bàn giao trong `docs/progress/` cho Milestone 1.

---

## 3. TIÊU CHÍ NGHIỆM THU MILESTONE 1 (ACCEPTANCE CRITERIA)
1. Cả `core-service` và `planning-service` có thể build riêng biệt mà không báo lỗi phụ thuộc vòng.
2. `libs/shared` chỉ chứa interfaces, contracts, enums và pure utils (không chứa Mongoose schema hay business logic).
3. Cả 2 service khởi động được độc lập trên 2 cổng khác nhau (3001 và 3003).
4. Mã nguồn cũ trong `src/` của monolith vẫn được bảo toàn nguyên vẹn cho đến khi chuyển đổi xong ở Milestone 2 và 3.
5. Không commit bất kỳ secret, password hay file `.env` thật nào lên Git.

