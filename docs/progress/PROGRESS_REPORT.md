# GASTROWISE – MILESTONE HANDOVER & PROGRESS REPORT
**Project:** GastroWise (Khóa luận tốt nghiệp)  
**Milestone:** Milestone 0 – Source Code Audit & Microservices Architecture Design (Phase 0)  
**Date:** November 17, 2026  
**Author:** Senior Software Architect, Tech Lead & AI Coding Agent  
**Reviewers:** Developer 1, Developer 2, ChatGPT Architecture Reviewer  
**Status:** MILESTONE 0 COMPLETED — AWAITING TEAM APPROVAL  

---

## 1. MỤC TIÊU MILESTONE 0
- Tiến hành kiểm kê độc lập, toàn diện 5 repositories trong workspace (`KLTN-123-GastroWise-BE`, `KLTN-123-GastroWise-AI`, `KLTN-123-GastroWise-FE`, `KLTN-123-GastroWise-Admin-FE`, `KLTN-123-GastroWise-Mobile`).
- Xác thực phiên bản runtime, thư viện và framework thực tế.
- Phân tích ranh giới nghiệp vụ (DDD Bounded Contexts) để chuyển đổi từ Modular Monolith sang kiến trúc Microservices gồm 3 services độc lập: Core Service, Planning Service, AI Service và 1 API Gateway (Nginx).
- Lập ma trận phụ thuộc API nội bộ, ranh giới dữ liệu (Database per Service) và kế hoạch migration 8 tuần theo mô hình Strangler Fig Pattern.
- **Quy tắc tuyệt đối:** Không chỉnh sửa source code trong Phase 0; bảo vệ toàn vẹn working tree sạch (`working tree clean`).

---

## 2. CÁC FILE ĐÃ TẠO
Hệ thống 8 tài liệu kỹ thuật nền tảng đã được hoàn thiện trong thư mục `docs/`:
1. `docs/migration/SOURCE_AUDIT.md`: Kiểm kê 5 repos, phiên bản framework, kết quả build/type-check ban đầu.
2. `docs/migration/MODULE_OWNERSHIP.md`: Phân chia Bounded Contexts và quyền sở hữu dữ liệu giữa Core, Planning và AI.
3. `docs/migration/API_DEPENDENCIES.md`: Ma trận API nội bộ, request/response DTOs, timeout budgets và headers bảo mật.
4. `docs/migration/MIGRATION_PLAN.md`: Kế hoạch chuyển đổi 8 tuần chi tiết theo mô hình Strangler Pattern & phân công nhiệm vụ 2 thành viên.
5. `docs/architecture/CURRENT_ARCHITECTURE.md`: Phân tích thực trạng Monolith, các điểm nghẽn và khớp nối chặt (tight coupling).
6. `docs/architecture/TARGET_ARCHITECTURE.md`: Thiết kế kiến trúc Microservices mục tiêu (Clean Architecture, Sequence Diagrams).
7. `docs/architecture/SERVICE_BOUNDARIES.md`: Ranh giới dịch vụ, Anti-Corruption Layer (ACL), Circuit Breaker & Correlation ID.
8. `docs/architecture/DATABASE_OWNERSHIP.md`: Thiết kế Database per Service (`gastro_core` vs `gastro_planning`) & cơ chế snapshot dữ liệu.
9. `docs/progress/PROGRESS_REPORT.md`: Báo cáo bàn giao tiến độ Milestone 0.
10. `docs/progress/CHANGELOG.md`: Nhật ký thay đổi hệ thống.
11. `docs/progress/KNOWN_ISSUES.md`: Bảng theo dõi các lỗi và vấn đề kỹ thuật phát hiện.
12. `docs/progress/NEXT_TASKS.md`: Danh sách công việc chi tiết cho Milestone tiếp theo.

---

## 3. CÁC FILE ĐÃ SỬA
- **Không có file source code nào bị sửa** trong Milestone 0. Toàn bộ mã nguồn 5 repositories được giữ nguyên 100%.

---

## 4. CÁC MODULE ĐÃ HOÀN THÀNH
- Đã hoàn thành phân tích toàn bộ 10 modules trong Backend Monolith:
  - `AuthModule` $\rightarrow$ Core Service
  - `UsersModule` $\rightarrow$ Core Service
  - `RestaurantsModule` $\rightarrow$ Core Service
  - `ReviewsModule` $\rightarrow$ Core Service
  - `FavoritesModule` $\rightarrow$ Core Service
  - `TasteDnaModule` $\rightarrow$ Core Service
  - `InteractionsModule` $\rightarrow$ Core Service
  - `ContactsModule` $\rightarrow$ Core Service
  - `ItinerariesModule` $\rightarrow$ **Tách sang Planning Service**
- Đã phân tích toàn bộ các endpoint và mô hình AI trong `KLTN-123-GastroWise-AI`:
  - 4-Stage Hybrid Recommender (Taste DNA Cosine + SVD Collaborative Filtering)
  - Google OR-Tools TSPTW Route Optimizer & Gastronomic Progression Heuristic
  - ViSoBERT & Rule-based Sentiment Analysis
  - YOLOv11m Food Recognition & CLAHE Preprocessing
  - NLU Copilot Dialogue Engine

---

## 5. API ĐÃ TẠO HOẶC THAY ĐỔI
- Chưa có API mới nào được code trong Milestone 0 (Giai đoạn Audit & Design).
- Đã thiết kế và chuẩn hóa đặc tả cho 4 nhóm API:
  - Public Client API qua Gateway: `/api/v1/*`
  - Internal REST API giữa Planning và Core: `/internal/restaurants/candidates`, `/internal/restaurants/:id`, `/internal/taste-dna/:userId`
  - Internal REST API giữa Planning và AI: `/routes/optimize`
  - Internal REST API giữa Core và AI: `/recommend/hybrid`, `/cf/train`, `/analyze-sentiment`, `/predict-food`, `/copilot/message`

---

## 6. BUILD RESULTS
Đã thực thi kiểm tra build và type-check trực tiếp trên host:
- `KLTN-123-GastroWise-BE` (`npm run build`): **EXIT 0 (PASS)**
- `KLTN-123-GastroWise-FE` (`npm run type-check`): **EXIT 0 (PASS)**
- `KLTN-123-GastroWise-Admin-FE` (`tsc --noEmit`): **EXIT 0 (PASS)**
- `KLTN-123-GastroWise-Mobile` (`tsc --noEmit`): **EXIT 0 (PASS)**
- `KLTN-123-GastroWise-AI` (Python Module Import Verification): **EXIT 0 (PASS)**

---

## 7. TEST RESULTS
- MongoDB Least-Privilege Verification Script (`verify_mongodb_connection.py`): **PASSED** (Xác thực user `gastrowise_ai_service`, ping OK, find_one OK, write probe rejected code 8000, unauthorized users collection rejected code 8000).
- Hybrid Recommendation Python Regression Test (`test_hybrid_recommendation.py`): **PASSED** (100% test case thuật toán SVD và Taste DNA vượt qua).
- Route Optimizer Python Heuristic Test (`route_optimizer.py`): **PASSED** (Khởi tạo lộ trình 3 điểm dừng trong 12ms).
- Jest Unit Tests Backend (`npm test`): 10 Suites PASSED, 4 Suites FAILED do thiếu mock providers trong RootTestModule cũ (đã ghi nhận trong Known Issues).

---

## 8. KNOWN ISSUES (CÁC VẤN ĐỀ ĐANG TỒN TẠI)
Chi tiết tại `docs/progress/KNOWN_ISSUES.md`:
1. **Lệch URL Router giữa Backend và AI Service (404 Fallback):** NestJS gọi `${aiBaseUrl}/v1/recommendation/recommend/hybrid` trong khi FastAPI router không có prefix `/v1`.
2. **Lỗi hiển thị "5.4★" Rating Badge trên thang 5 sao:** Dữ liệu Foody thang 10 trong MongoDB Atlas không được chia 2 khi load vào DataFrame của AI.
3. **Lỗ hổng Broken Access Control ở Reviews & Matrix Export:** Thiếu `JwtAuthGuard` ở `DELETE /reviews/:id`, `PATCH /reviews/:id` và `GET /interactions/matrix`.
4. **Khớp nối chặt trong `ItinerariesService`:** Inject trực tiếp `RestaurantModel`, `TasteDnaService` và `InteractionsService`.
5. **Mobile API URL Mismatch:** `.env` Mobile có `/api/v1` nhưng NestJS `main.ts` chưa gọi `app.setGlobalPrefix('api/v1')`.
6. **Lỗi import `cv2` trong `test_nlu_copilot.py`:** `nlu_service.py` import từ `vision_service.py` gây lỗi thiếu thư viện computer vision.

---

## 9. SECURITY CONCERNS (MỐI QUAN TÂM BẢO MẬT)
1. **Lộ credential lịch sử:** User cũ `thienthien` từng bị commit trong git history commit `175c94e` của AI và file `scripts/remediate-config.js` của BE $\rightarrow$ Cần DBA xóa/rotate user này trên MongoDB Atlas Console.
2. **Thiếu Mutual Service Authentication:** FastAPI hiện tại chưa kiểm tra `X-Internal-AI-Key`. Bất kỳ ai gọi port 5000 đều có thể chạy AI inference $\rightarrow$ Cần bổ sung `verify_internal_key`.
3. **Thiếu giới hạn tải file ảnh:** `POST /restaurants/search-by-image` chưa có limit 5MB và whitelist MIME type.

---

## 10. ROLLBACK CONSIDERATIONS (CƠ CHẾ ROLLBACK)
- Vì Milestone 0 chỉ tạo tài liệu kỹ thuật trong `docs/`, mã nguồn 5 repositories chưa bị thay đổi $\rightarrow$ Rủi ro kỹ thuật hiện tại bằng `0`.
- Đối với các milestone tiếp theo:
  - Mỗi milestone được thực hiện trên branch riêng (ví dụ: `feat/milestone-1-foundation`).
  - Database gốc `gastrowise` được bảo lưu nguyên vẹn, không thao tác trực tiếp mà copy sang `gastro_core` và `gastro_planning`.
  - Mọi bước tách service đều có khả năng chuyển ngược traffic về Monolith qua API Gateway.

---

## 11. CÁC QUYẾT ĐỊNH KIẾN TRÚC ĐÃ THỐNG NHẤT (ADR)
1. **ADR-01: Kiến trúc Microservices 3 Services + 1 Gateway:**
   - Quyết định: Chia hệ thống thành **Core Service** (Identity & Catalog), **Planning Service** (Tour Planning & Timetables), **AI Service** (ML & Optimization) và **API Gateway (Nginx)**. Không chia nhỏ thành quá nhiều microservices vụn vặt.
2. **ADR-02: Database per Service:**
   - Quyết định: Phân chia thành `gastro_core` và `gastro_planning` trên cùng MongoDB Atlas cluster trong giai đoạn đồ án để tối ưu chi phí và tài nguyên.
3. **ADR-03: Snapshot Value Pattern cho Itinerary Stops:**
   - Quyết định: `ItineraryStop` lưu bản sao dữ liệu (`restaurant_name`, `lat`, `lng`, `cost`) thay vì dùng Mongoose populate cross-database.
4. **ADR-04: Anti-Corruption Layer (ACL) qua REST:**
   - Quyết định: Planning Service giao tiếp với Core Service qua HTTP REST API nội bộ có xác thực `X-Internal-Service-Key`, không chia sẻ code model.

---

## 12. ĐỀ XUẤT MILESTONE TIẾP THEO (MILESTONE 1)
- **Tên milestone:** Milestone 1 – Monorepo Foundation & API Contracts (Week 2).
- **Branch làm việc dự kiến:** `feat/milestone-1-foundation` trên repository `KLTN-123-GastroWise-BE`.
- **Mục tiêu:**
  1. Cấu hình `nest-cli.json` đa ứng dụng (`apps/core-service`, `apps/planning-service`).
  2. Tạo thư viện dùng chung `libs/shared` (chỉ chứa interfaces, contracts DTO, enums và geo utils).
  3. Cấu hình HealthModule (`/health`) cho từng service.
  4. Chuẩn bị file môi trường mẫu (`.env.core.example`, `.env.planning.example`).
  5. Đảm bảo cả hai ứng dụng build và khởi động độc lập trên port 3001 và 3003.
- **Trạng thái:** Dừng lại, bàn giao tài liệu và chờ xác nhận phê duyệt từ nhóm trước khi tạo branch code.

