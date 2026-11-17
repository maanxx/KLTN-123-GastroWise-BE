# GASTROWISE – KNOWN ISSUES & DEFECT TRACKER
Bảng theo dõi toàn bộ các vấn đề kỹ thuật, lỗi kiến trúc, lỗi bảo mật và bất thường dữ liệu được phát hiện trong quá trình phát triển GastroWise.

---

## 1. BẢNG TỔNG HỢP VẤN ĐỀ KỸ THUẬT (DEFECT MATRIX)

| Issue ID | Tiêu đề vấn đề | Mức độ nghiêm trọng | Thành phần ảnh hưởng | Trạng thái | Milestone khắc phục dự kiến |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **ISSUE-01** | Lệch tiền tố URL gọi AI Microservice gây lỗi 404 Fallback | **CRITICAL** | `KLTN-123-GastroWise-BE`<br/>`KLTN-123-GastroWise-AI` | **OPEN** | Milestone 3 (Week 5) |
| **ISSUE-02** | Lỗi hiển thị "5.4★" Rating Badge do thiếu chuẩn hóa thang điểm 10 $\rightarrow$ 5 | **HIGH** | `KLTN-123-GastroWise-AI` | **OPEN** | Milestone 3 (Week 5) |
| **ISSUE-03** | Lỗ hổng Broken Access Control ở endpoint xóa và sửa Review | **CRITICAL** | `KLTN-123-GastroWise-BE` | **OPEN** | Milestone 2 (Week 3) |
| **ISSUE-04** | Lộ lọt dữ liệu ma trận hành vi người dùng tại `GET /interactions/matrix` | **HIGH** | `KLTN-123-GastroWise-BE` | **OPEN** | Milestone 2 (Week 3) |
| **ISSUE-05** | Khớp nối chặt cross-domain trong `ItinerariesService` | **HIGH** | `KLTN-123-GastroWise-BE` | **OPEN** | Milestone 2 (Week 4) |
| **ISSUE-06** | Lệch tiền tố cấu hình API Gateway trong Mobile App `.env` | **HIGH** | `KLTN-123-GastroWise-Mobile`<br/>`KLTN-123-GastroWise-BE` | **OPEN** | Milestone 4 (Week 6) |
| **ISSUE-07** | Lỗi import `cv2` trong `test_nlu_copilot.py` do phụ thuộc vòng | **MEDIUM** | `KLTN-123-GastroWise-AI` | **OPEN** | Milestone 3 (Week 5) |
| **ISSUE-08** | Lộ credential lịch sử `thienthien` trong file script đã commit | **HIGH** | `KLTN-123-GastroWise-BE`<br/>MongoDB Atlas | **OPEN** | Milestone 1 (Week 2) & DBA Action |

---

## 2. CHI TIẾT TỪNG VẤN ĐỀ VÀ PHƯƠNG ÁN KHẮC PHỤC

### ISSUE-01: Lệch tiền tố URL gọi AI Microservice gây lỗi 404 Fallback
- **Severity:** CRITICAL
- **Vị trí code:** 
  - [KLTN-123-GastroWise-BE/src/restaurants/restaurants.service.ts:448, 547, 969](file:///D:/GastroWise/KLTN-123-GastroWise-BE/src/restaurants/restaurants.service.ts#L448)
  - [KLTN-123-GastroWise-AI/app/api/v1/router.py:9-15](file:///D:/GastroWise/KLTN-123-GastroWise-AI/app/api/v1/router.py#L9-L15)
- **Hiện tượng:** Mọi request gọi AI đề xuất lai (Hybrid Recommendation), huấn luyện SVD tương tác (CF Train) và Copilot Chat đều nhận về mã lỗi HTTP 404. NestJS bắt ngoại lệ và tự động chuyển sang fallback sắp xếp database hoặc regex thô sơ.
- **Nguyên nhân:** NestJS hardcode gọi `${aiBaseUrl}/v1/recommendation/recommend/hybrid` và `${aiBaseUrl}/v1/copilot/message`, trong khi FastAPI mount các router này ở root `/recommend/hybrid` và `/copilot/message`.
- **Phương án khắc phục:** Chuẩn hóa đường dẫn gọi trong `restaurants.service.ts` khớp với endpoint thực tế của FastAPI.

---

### ISSUE-02: Lỗi hiển thị "5.4★" Rating Badge do thiếu chuẩn hóa thang điểm 10 $\rightarrow$ 5
- **Severity:** HIGH
- **Vị trí code:**
  - [KLTN-123-GastroWise-AI/app/db/mongo.py:58](file:///D:/GastroWise/KLTN-123-GastroWise-AI/app/db/mongo.py#L58)
  - [KLTN-123-GastroWise-AI/app/core/recommender.py:423-424](file:///D:/GastroWise/KLTN-123-GastroWise-AI/app/core/recommender.py#L423-L424)
- **Hiện tượng:** Thẻ gợi ý nhà hàng xuất hiện huy hiệu `"⭐ Đánh giá xuất sắc (5.4★)"` trên thang 5 sao tối đa.
- **Nguyên nhân:** MongoDB Atlas lưu điểm Foody theo thang 10. NestJS chia 2 (`raw / 2.0 = 2.7★`), nhưng FastAPI đổi tên cột `diemTrungBinh` thành `rating` mà không chia 2. `recommender.py` thấy $5.4 \ge 4.7$ nên in huy hiệu xuất sắc.
- **Phương án khắc phục:** Trong `app/db/mongo.py`, chuẩn hóa `rating = round(float(r) / 2.0, 1) if float(r) > 5.0 else float(r)`.

---

### ISSUE-03: Lỗ hổng Broken Access Control ở endpoint xóa và sửa Review
- **Severity:** CRITICAL
- **Vị trí code:** [KLTN-123-GastroWise-BE/src/reviews/reviews.controller.ts:48-61](file:///D:/GastroWise/KLTN-123-GastroWise-BE/src/reviews/reviews.controller.ts#L48-L61)
- **Hiện tượng:** Bất kỳ ai không cần đăng nhập cũng có thể gửi request `DELETE /reviews/:id` hoặc `PATCH /reviews/:id` để xóa/sửa review của người khác.
- **Nguyên nhân:** Thiếu `@UseGuards(JwtAuthGuard)` và không kiểm tra `review.userId === req.user.sub`.
- **Phương án khắc phục:** Thêm Guard xác thực và kiểm tra quyền sở hữu tác giả hoặc quyền admin.

---

### ISSUE-04: Lộ lọt dữ liệu ma trận hành vi người dùng tại `GET /interactions/matrix`
- **Severity:** HIGH
- **Vị trí code:** [KLTN-123-GastroWise-BE/src/interactions/interactions.controller.ts:67-70](file:///D:/GastroWise/KLTN-123-GastroWise-BE/src/interactions/interactions.controller.ts#L67-L70)
- **Hiện tượng:** Endpoint công khai không có guard cho phép tải về 5,000 log tương tác của người dùng.
- **Phương án khắc phục:** Thêm `@UseGuards(JwtAuthGuard, RolesGuard)` và `@Roles('admin')`.

---

### ISSUE-05: Khớp nối chặt cross-domain trong `ItinerariesService`
- **Severity:** HIGH
- **Vị trí code:** [KLTN-123-GastroWise-BE/src/itineraries/itineraries.service.ts:88-93](file:///D:/GastroWise/KLTN-123-GastroWise-BE/src/itineraries/itineraries.service.ts#L88-L93)
- **Hiện tượng:** Service lập lịch inject trực tiếp Mongoose Model của nhà hàng và Service của khẩu vị.
- **Phương án khắc phục:** Tách `ItinerariesService` sang `apps/planning-service` và thay thế việc query database nhà hàng bằng `CoreApiClient` (Anti-Corruption Layer qua REST).

