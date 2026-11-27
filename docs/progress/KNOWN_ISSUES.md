# GASTROWISE – KNOWN ISSUES & DEFECT TRACKER
Bảng theo dõi toàn bộ các vấn đề kỹ thuật, lỗi kiến trúc, lỗ hổng bảo mật và bất thường dữ liệu được phát hiện trong quá trình kiểm toán source code và review kiến trúc.

---

## 1. BẢNG TỔNG HỢP VẤN ĐỀ KỸ THUẬT (DEFECT MATRIX - PHÂN LOẠI P0/P1/P2)

| Issue ID | Tiêu đề vấn đề | Mức độ | Phân loại | Thành phần ảnh hưởng | Trạng thái | Kế hoạch xử lý |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **ISSUE-01** | Lệch tiền tố URL gọi AI Microservice gây lỗi 404 Fallback | **P0** | Bug Core | `KLTN-123-GastroWise-BE`<br/>`KLTN-123-GastroWise-AI` | **RESOLVED IN MICROSERVICES** | Dual-mount routes in AI + corrected Core URLs |
| **ISSUE-02** | Lỗ hổng Broken Access Control ở endpoint xóa/sửa Review (`DELETE`/`PATCH`) | **P0** | Security | `KLTN-123-GastroWise-BE` | **RESOLVED IN MICROSERVICES** | Enforced JwtAuthGuard + owner/admin verification |
| **ISSUE-03** | Thiếu xác thực Mutual Service Auth ở AI Service (`X-Internal-AI-Key`) | **P0** | Security | `KLTN-123-GastroWise-AI`<br/>`KLTN-123-GastroWise-BE` | **RESOLVED IN MICROSERVICES** | Added X-Internal-AI-Key dependency and ACL client |
| **ISSUE-04** | Lộ lọt dữ liệu ma trận hành vi người dùng tại `GET /interactions/matrix` | **P0** | Security | `KLTN-123-GastroWise-BE` | **RESOLVED IN MICROSERVICES** | Protected with @Roles('admin') |
| **ISSUE-05** | Khớp nối chặt cross-domain trong `ItinerariesService` (DB Coupling) | **P1** | Architecture | `KLTN-123-GastroWise-BE` | **RESOLVED IN MICROSERVICES** | Extracted to planning-service with CoreApiClient ACL |
| **ISSUE-06** | Lỗi hiển thị "5.4★" Rating Badge do thiếu chuẩn hóa thang điểm 10 $\rightarrow$ 5 | **P1** | Data/Algo | `KLTN-123-GastroWise-AI` | **OPEN** | Milestone 4 (Week 5) |
| **ISSUE-07** | Quy trình migration database `$out` thiếu backup, validation & rollback | **P1** | Database | `docs/architecture` | **RESOLVED IN DOCS** | Đã chuẩn hóa quy trình 4 bước |
| **ISSUE-08** | Mâu thuẫn quyền truy cập database của AI (Interim vs Target State) | **P1** | Architecture | `docs/architecture` | **RESOLVED IN DOCS** | Phân định rõ Interim vs Target |
| **ISSUE-09** | Lệch default port gọi `/predict-food` (Port 8000 thay vì 5000) | **P1** | Config | `KLTN-123-GastroWise-BE` | **RESOLVED IN M2.3.1** | Đã chuẩn hóa port 5000 + gắn X-Internal-AI-Key |
| **ISSUE-10** | Lệch tiền tố API Gateway trong Mobile App `.env` | **P1** | Integration | `KLTN-123-GastroWise-Mobile` | **OPEN** | Milestone 6 (Week 6) - Cần trỏ port 8080 |
| **ISSUE-11** | Lỗi import `cv2` trong `test_nlu_copilot.py` do phụ thuộc vòng | **P2** | Code Quality | `KLTN-123-GastroWise-AI` | **OPEN** | Milestone 4 (Week 5) |
| **ISSUE-12** | Lộ credential lịch sử `thienthien` trong file script đã commit | **P2** | Security | `KLTN-123-GastroWise-BE` | **OPEN (HISTORICAL COMMIT)** | Commit f6bc66fc; Xóa user trên Atlas; không rewrite git |

---

## 2. CHI TIẾT TỪNG VẤN ĐỀ & PHƯƠNG ÁN KHẮC PHỤC

### ISSUE-01: Lệch tiền tố URL gọi AI Microservice gây lỗi 404 Fallback [P0]
- **Severity:** P0 (Chặn toàn bộ tính năng AI thực tế)
- **Vị trí code:** 
  - [KLTN-123-GastroWise-BE/src/restaurants/restaurants.service.ts:448, 547, 969](file:///D:/GastroWise/KLTN-123-GastroWise-BE/src/restaurants/restaurants.service.ts#L448)
  - [KLTN-123-GastroWise-AI/app/api/v1/router.py:9-15](file:///D:/GastroWise/KLTN-123-GastroWise-AI/app/api/v1/router.py#L9-L15)
- **Hiện tượng:** Mọi request gọi AI đề xuất lai (Hybrid Recommendation), huấn luyện SVD tương tác (CF Train) và Copilot Chat đều nhận về mã lỗi HTTP 404. NestJS bắt ngoại lệ và tự động chuyển sang fallback sắp xếp database hoặc regex thô sơ.
- **Nguyên nhân:** NestJS hardcode gọi `${aiBaseUrl}/v1/recommendation/recommend/hybrid` và `${aiBaseUrl}/v1/copilot/message`, trong khi FastAPI mount các router này ở root `/recommend/hybrid` và `/copilot/message`.
- **Phương án đề xuất:** Chuẩn hóa FastAPI router hỗ trợ dual-compatibility (cả `/v1/recommendation/*` và `/recommend/*`) và đồng bộ cấu hình endpoint trong Core Service.

---

### ISSUE-02: Lỗ hổng Broken Access Control ở endpoint Reviews [P0]
- **Severity:** P0 (Lỗ hổng bảo mật nghiêm trọng - OWASP API1 & API5)
- **Vị trí code:** [KLTN-123-GastroWise-BE/src/reviews/reviews.controller.ts:19-58](file:///D:/GastroWise/KLTN-123-GastroWise-BE/src/reviews/reviews.controller.ts#L19-L58)
- **Hiện tượng:** 
  - `POST /reviews`: Thiếu `JwtAuthGuard`. Cho phép mạo danh bất kỳ `userId` nào để đăng đánh giá giả mạo.
  - `DELETE /reviews/:id`: Thiếu `JwtAuthGuard`, thiếu kiểm tra quyền sở hữu. Bất kỳ ai không đăng nhập cũng có thể gửi request xóa sạch review trong hệ thống.
  - `PATCH /reviews/:id`: Nhận `dto: any`, không có Guard và ValidationPipe. Bất kỳ ai cũng có thể sửa nội dung và điểm của review.
  - `POST /reviews/migrate-sentiment`: Không có role check Admin.
- **Phương án đề xuất:** 
  - Gắn `@UseGuards(JwtAuthGuard)` trên `POST`, `DELETE`, `PATCH`.
  - Kiểm tra `review.userId.toString() === req.user.id` hoặc `req.user.role === 'admin'`.
  - Gắn `@Roles(Role.Admin)` và `@UseGuards(RolesGuard)` trên `/reviews/migrate-sentiment`.

---

### ISSUE-03: Thiếu Mutual Authentication ở AI Service (`X-Internal-AI-Key`) [P0]
- **Severity:** P0 (Lỗ hổng bảo mật dịch vụ nội bộ)
- **Vị trí code:** 
  - [KLTN-123-GastroWise-AI/main.py:22-29](file:///D:/GastroWise/KLTN-123-GastroWise-AI/main.py#L22-L29)
  - [KLTN-123-GastroWise-BE/src/restaurants/restaurants.service.ts:448](file:///D:/GastroWise/KLTN-123-GastroWise-BE/src/restaurants/restaurants.service.ts#L448)
- **Hiện tượng:** FastAPI mở `allow_origins=["*"]` và kiểm tra 0 authorization headers. Backend gọi HTTP sang AI mà không gửi bất kỳ token nào. Bất kỳ client nào trên mạng nội bộ hoặc internet (nếu expose port 5000) đều có thể kích hoạt các thuật toán AI tính toán nặng.
- **Phương án đề xuất:**
  - Bổ sung header dependency `Security(verify_internal_key)` trong FastAPI.
  - Cấu hình NestJS HTTP Client tự động chèn header `X-Internal-AI-Key: <SECRET>` qua interceptor.

---

### ISSUE-04: Lộ lọt dữ liệu ma trận hành vi người dùng tại `GET /interactions/matrix` [P0]
- **Severity:** P0 (Nhạy cảm dữ liệu - OWASP API3)
- **Vị trí code:** [KLTN-123-GastroWise-BE/src/interactions/interactions.controller.ts:67-70](file:///D:/GastroWise/KLTN-123-GastroWise-BE/src/interactions/interactions.controller.ts#L67-L70)
- **Hiện tượng:** Endpoint công khai không có guard cho phép tải về 5,000 log tương tác của người dùng.
- **Phương án đề xuất:** Chuyển sang endpoint nội bộ `/internal/interactions/matrix` hoặc bảo vệ bằng `Roles(Role.Admin)` và `X-Internal-Service-Key`.

---

### ISSUE-05: Khớp nối chặt cross-domain trong `ItinerariesService` [P1]
- **Severity:** P1 (Vi phạm kiến trúc Microservices)
- **Vị trí code:** [KLTN-123-GastroWise-BE/src/itineraries/itineraries.service.ts:88-93](file:///D:/GastroWise/KLTN-123-GastroWise-BE/src/itineraries/itineraries.service.ts#L88-L93)
- **Hiện tượng:** Service lập lịch inject trực tiếp Mongoose Model của nhà hàng và Service của khẩu vị.
- **Phương án đề xuất:** Tách `ItinerariesService` sang `apps/planning-service` và thay thế việc query database nhà hàng bằng `CoreApiClient` (Anti-Corruption Layer qua REST).

---

### ISSUE-06: Lỗi hiển thị "5.4★" Rating Badge do thiếu chuẩn hóa thang điểm 10 $\rightarrow$ 5 [P1]
- **Severity:** P1 (Chất lượng dữ liệu và thuật toán)
- **Vị trí code:**
  - [KLTN-123-GastroWise-AI/app/db/mongo.py:58](file:///D:/GastroWise/KLTN-123-GastroWise-AI/app/db/mongo.py#L58)
  - [KLTN-123-GastroWise-AI/app/core/recommender.py:423-424](file:///D:/GastroWise/KLTN-123-GastroWise-AI/app/core/recommender.py#L423-L424)
- **Hiện tượng:** Thẻ gợi ý nhà hàng xuất hiện huy hiệu `"⭐ Đánh giá xuất sắc (5.4★)"` trên thang 5 sao tối đa.
- **Nguyên nhân:** MongoDB Atlas lưu điểm Foody theo thang 10. NestJS chia 2 (`raw / 2.0 = 2.7★`), nhưng FastAPI đổi tên cột `diemTrungBinh` thành `rating` mà không chia 2. `recommender.py` thấy $5.4 \ge 4.7$ nên in huy hiệu xuất sắc cho nhà hàng chỉ đạt 2.7 sao thực tế.
- **Phương án đề xuất:** Trong `app/db/mongo.py`, chuẩn hóa `rating = round(float(r) / 2.0, 1) if float(r) > 5.0 else float(r)`.

---

### ISSUE-07 & ISSUE-08: Database Migration Risk & DB Ownership Inconsistency [P1]
- **Severity:** P1 (Rủi ro vận hành dữ liệu & Mâu thuẫn tài liệu)
- **Hiện tượng:** `$out` migration cũ thiếu backup/rollback; tài liệu có xung đột giữa Zero Database Sharing và AI read access.
- **Trạng thái:** **ĐÃ GIẢI QUYẾT TRONG TÀI LIỆU KIẾN TRÚC**. Đã cập nhật `DATABASE_OWNERSHIP.md` với quy trình 4 giai đoạn (Backup $\rightarrow$ Migration qua `$merge` $\rightarrow$ Parity Check $\rightarrow$ Rollback) và phân định rõ Interim State vs Target State.

---

### ISSUE-09: Lệch default port gọi `/predict-food` [P1]
- **Severity:** P1 (Config defect)
- **Vị trí code:** `apps/core-service/src/restaurants/restaurants.service.ts:277`
- **Trạng thái:** **RESOLVED IN M2.3.1**
- **Minh chứng:** Đã kiểm tra source code: fallback URL là `http://127.0.0.1:5000` (không còn port 8000). Đồng thời trong Milestone 2.3.1 đã bổ sung header bắt buộc `'X-Internal-AI-Key': this.internalAiKey` tại các hàm `searchByImage`, `getWeatherRecommendation` và `findAll` semantic search.

---

### ISSUE-10: Lệch tiền tố API Gateway trong Mobile App `.env` [P1]
- **Severity:** P1 (Integration defect)
- **Vị trí code:** `KLTN-123-GastroWise-Mobile/.env`
- **Trạng thái:** **OPEN (Kế hoạch Milestone 6 Mobile Integration)**
- **Minh chứng:** File `.env` của Mobile đang cấu hình `EXPO_PUBLIC_API_URL=http://10.161.30.252:3001/api/v1` (trỏ trực tiếp vào Core Service port 3001). Cần cập nhật sang cổng API Gateway `http://<ip>:8080/api/v1` trong Milestone 6 để mobile app có thể gọi được cả Planning Service (lập lịch `/api/v1/itineraries/*`).

---

### ISSUE-11: Lỗi import `cv2` trong `test_nlu_copilot.py` [P2]
- **Severity:** P2 (Độc lập module kiểm thử)
- **Vị trí code:** `app/core/nlu_service.py:3`
- **Hiện tượng:** `nlu_service.py` import `VIETNAMESE_FOOD_NUTRITION` từ `vision_service.py` (file này import `cv2`), khiến unit test NLU bị crash nếu môi trường chưa cài `opencv-python`.
- **Phương án đề xuất:** Tách bảng dinh dưỡng sang `app/core/nutrition_data.py`.

---

### ISSUE-12: Lộ credential lịch sử `thienthien` trong file script đã commit [P2]
- **Severity:** P2 (Bảo mật tài khoản cũ)
- **Vị trí code:** `KLTN-123-GastroWise-BE/scripts/remediate-config.js` (commit `f6bc66fcad7014578be117a0306539b618b747b0`)
- **Trạng thái:** **OPEN (HISTORICAL COMMIT)**
- **Minh chứng:** File `scripts/remediate-config.js` đã được xóa khỏi working tree trong commit `4b8ab800`, hiện không còn xuất hiện trong cây thư mục hiện tại. Tuy nhiên vẫn tồn tại trong lịch sử commit `f6bc66fc`.
- **Phương án đề xuất:** Tuân thủ nguyên tắc an toàn Git, KHÔNG force-push hoặc rewrite git history. Đề xuất DBA xoay vòng / thu hồi (revoke/delete) trực tiếp user database này trên MongoDB Atlas.

---

## 3. M9.7.1 RECONCILIATION STATUS (2026-11-27)

- **Cross-repo / Infra issues still OPEN (`ISSUE-06`, `ISSUE-10`, `ISSUE-11`, `ISSUE-12`):** Preserved above without deletion.
- **Database & Infrastructure Blockers (`docs/database/M8_8_BLOCKER_REGISTER.md`):**
  - `BLK-01`..`BLK-09`: Code/Docker implementation completed in `M9.1`–`M9.5` and verified locally via unit/build checks (Note: `KLTN-123-GastroWise-AI` M9.4 patch remains unpushed externally).
  - `BLK-10`: Backup scripts, CI workflows, and `/health/ready` probes implemented and locally shellcheck/unit-tested in `M9.6`–`M9.6.1`; cloud secrets, Atlas tier (`BLK-10a`), and S3 Object Lock (`BLK-10b`) remain unverified on live infrastructure.
  - `BLK-11`: **UNRESOLVED / BLOCKED** — requires authorized isolated staging Atlas snapshot audit.
- **New M9.7.0 Backend Findings:**
  - `F-M2` (P1): `scripts/migrations/cli.ts` lacks an explicit `mongodb+srv://` / Atlas production guard.
  - `L-01` (P2): Silent `catch {}` blocks (`no-empty` ESLint errors) at `apps/core-service/src/restaurants/restaurants.service.ts` lines 614 and 1192.
