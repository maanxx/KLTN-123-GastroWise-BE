# Tài liệu Nghiệp vụ Backend (GastroWise)

Hệ thống Backend của GastroWise được xây dựng theo kiến trúc **Monolithic** với framework **NestJS** và cơ sở dữ liệu **MongoDB**.

## 1. Authentication (Xác thực & Phân quyền)
Module `Auth` quản lý việc xác thực người dùng và bảo mật hệ thống thông qua JWT (JSON Web Tokens) và Google OAuth2.
- **Đăng nhập bằng Google (`/auth/google`, `/auth/google/callback`)**: Hỗ trợ người dùng đăng nhập nhanh bằng tài khoản Google. Backend sẽ xác thực với Google và trả về JWT token cho frontend.
- **Đăng ký / Đăng nhập truyền thống (`/auth/register`, `/auth/login`)**: Người dùng đăng ký tài khoản với email/password. Khi đăng nhập thành công, hệ thống cấp Access Token và Refresh Token.
- **Đăng xuất (`/auth/logout`)**: Hủy bỏ token hiện tại.
- **Làm mới Token (`/auth/refresh`)**: Cấp lại Access Token mới dựa trên Refresh Token hợp lệ khi token cũ hết hạn.
- **Quản lý Hồ sơ cá nhân (`/auth/profile`)**: Lấy và cập nhật thông tin cá nhân của user đang đăng nhập.

## 2. Users (Quản lý Người dùng)
Module `Users` chủ yếu phục vụ các nghiệp vụ quản trị viên (Admin) quản lý thông tin tài khoản người dùng trên hệ thống.
- **CRUD Operations (`GET`, `POST`, `PATCH`, `DELETE` tại `/users`)**: Quản trị viên có thể xem danh sách, tạo mới, chỉnh sửa thông tin, hoặc xóa/khóa tài khoản người dùng trong hệ thống.

## 3. Restaurants (Quản lý và Khám phá Nhà hàng)
Module `Restaurants` là trọng tâm của hệ thống, cung cấp các tính năng từ cơ bản đến nâng cao.
- **CRUD Operations (`GET`, `POST`, `PATCH`, `DELETE` tại `/restaurants`)**: Lấy danh sách, chi tiết nhà hàng, thêm/sửa/xóa thông tin nhà hàng (thường dành cho Admin hoặc chủ nhà hàng).
- **Tìm kiếm bằng Hình ảnh (`/restaurants/search-by-image`)**: Cho phép người dùng tải lên một hình ảnh món ăn hoặc khung cảnh, hệ thống sẽ sử dụng AI/thị giác máy tính để phân tích và đề xuất nhà hàng phù hợp.
- **Chatbot AI / Gợi ý thông minh (`/restaurants/chat`)**: Endpoint giao tiếp với trợ lý ảo (có thể tích hợp LLM) để tư vấn, trả lời các câu hỏi về nhà hàng hoặc đưa ra gợi ý địa điểm ăn uống theo sở thích của người dùng qua đoạn chat.

## 4. Reviews (Đánh giá & Bình luận)
Module `Reviews` quản lý các phản hồi của thực khách.
- **Viết & Xem Đánh giá (`GET`, `POST` tại `/reviews`)**: Người dùng có thể để lại bình luận và điểm đánh giá cho nhà hàng. Hệ thống cho phép query danh sách đánh giá của một nhà hàng cụ thể.
- **Di chuyển/Phân tích Cảm xúc (`/reviews/migrate-sentiment`)**: Một batch job hoặc endpoint đặc biệt để tính toán, gán nhãn cảm xúc (tích cực, tiêu cực, trung lập) cho các đánh giá hiện có trong cơ sở dữ liệu dựa trên nội dung text, giúp tổng hợp điểm số khách quan hơn.
