# GASTROWISE – CHANGELOG & AUDIT TRAIL
Tất cả các thay đổi kiến trúc, mã nguồn, tài liệu và quyết định kỹ thuật của dự án GastroWise được ghi nhận tại đây theo thứ tự thời gian.

---

## [Milestone 0: Phase 0] - 2026-11-17

### Added (Tạo mới tài liệu kiến trúc & migration)
- `docs/migration/SOURCE_AUDIT.md`: Báo cáo kiểm kê toàn diện 5 repositories, phiên bản framework, build/type-check.
- `docs/migration/MODULE_OWNERSHIP.md`: Bảng đặc tả ranh giới Bounded Contexts (DDD) và quyền sở hữu dữ liệu Core, Planning, AI.
- `docs/migration/API_DEPENDENCIES.md`: Ma trận API liên service, request/response DTOs, timeout budgets và security headers.
- `docs/migration/MIGRATION_PLAN.md`: Kế hoạch chuyển đổi 8 tuần chi tiết theo mô hình Strangler Pattern & phân công nhiệm vụ 2 thành viên.
- `docs/architecture/CURRENT_ARCHITECTURE.md`: Phân tích thực trạng kiến trúc Monolith, các điểm nghẽn và khớp nối chặt (tight coupling).
- `docs/architecture/TARGET_ARCHITECTURE.md`: Thiết kế kiến trúc Microservices mục tiêu (Clean Architecture, Sequence Diagrams).
- `docs/architecture/SERVICE_BOUNDARIES.md`: Ranh giới dịch vụ, Anti-Corruption Layer (ACL), Circuit Breaker & Correlation ID.
- `docs/architecture/DATABASE_OWNERSHIP.md`: Thiết kế Database per Service (`gastro_core` vs `gastro_planning`) & cơ chế snapshot dữ liệu.
- `docs/progress/PROGRESS_REPORT.md`: Báo cáo bàn giao tiến độ Milestone 0.
- `docs/progress/CHANGELOG.md`: Khởi tạo Changelog theo dõi tiến độ.
- `docs/progress/KNOWN_ISSUES.md`: Bảng theo dõi các lỗi kỹ thuật và bảo mật phát hiện trong audit.
- `docs/progress/NEXT_TASKS.md`: Danh mục công việc chi tiết chuẩn bị cho Milestone 1.

### Verified (Xác thực kỹ thuật thực tế)
- Xác thực 5 repositories đều đang ở branch `main`, trạng thái đồng bộ và working tree sạch (`working tree clean`).
- Xác thực build thành công Backend NestJS (`npm run build`: Exit code 0).
- Xác thực type-check thành công Customer Web (`npm run type-check`: Exit code 0).
- Xác thực type-check thành công Admin Web (`tsc --noEmit`: Exit code 0).
- Xác thực type-check thành công Mobile App (`tsc --noEmit`: Exit code 0).
- Xác thực import thành công AI Microservice core modules và schemas (Exit code 0).
- Xác thực MongoDB Atlas least-privilege user `gastrowise_ai_service` qua script Python (ping OK, read OK, write rejected code 8000, unauthorized users rejected code 8000).

### Security & Architecture Discrepancies Noted
- Ghi nhận lỗi lệch URL endpoint giữa NestJS và FastAPI (`/v1/recommendation/*` vs `/recommend/*`).
- Ghi nhận lỗi dữ liệu hiển thị "5.4★" rating do chưa chuẩn hóa thang điểm 10 của Foody sang thang điểm 5 trong AI Microservice.
- Ghi nhận lỗ hổng Broken Access Control ở endpoint xóa review và export matrix tương tác.
- Ghi nhận khớp nối chặt trong `ItinerariesService` inject trực tiếp `RestaurantModel`.

