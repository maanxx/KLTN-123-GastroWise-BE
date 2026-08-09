# GastroWise Backend 🚀

Đây là mã nguồn Backend (Node.js + Express) của dự án **GastroWise - Hệ thống thông tin trải nghiệm ẩm thực thông minh**.

## 📌 Yêu cầu hệ thống (Prerequisites)
Trước khi chạy project, máy của bạn cần được cài đặt sẵn:
1. **Node.js**: Phiên bản v18.x trở lên.
2. **PostgreSQL**: Cơ sở dữ liệu quan hệ.
3. **PostGIS (QUAN TRỌNG)**: Vì dự án có sử dụng truy vấn không gian (tọa độ GPS) cho AI Planner, bạn BẮT BUỘC phải cài đặt thêm extension PostGIS cho PostgreSQL.

---

## 🛠️ Hướng dẫn Cài đặt & Chạy dự án (Dành cho Partner)

### Bước 1: Clone code và cài thư viện
Mở terminal tại thư mục dự án và chạy:
```bash
npm install
```

### Bước 2: Thiết lập CSDL (Database)
1. Mở công cụ quản trị Database (pgAdmin, DBeaver, hoặc psql).
2. Tạo một Database mới với tên tuỳ ý (Ví dụ: `gastrowise_db`).
3. Mở file `src/database/schema.sql`.
4. Copy toàn bộ nội dung trong file đó và **Run (Chạy Query)** vào Database vừa tạo để khởi tạo toàn bộ các bảng.
*(Lưu ý: Hai dòng đầu tiên trong file schema.sql là lệnh tạo extension PostGIS, hãy đảm bảo lệnh này chạy thành công mà không bị lỗi).*

### Bước 3: Cấu hình biến môi trường (.env)
Tạo một file mới tên là `.env` nằm ở **thư mục gốc** (ngang hàng với `package.json`).
Copy nội dung sau vào file `.env` và sửa lại thông tin `DB_...` cho khớp với máy của bạn:

```env
# Cổng chạy Server Backend
PORT=5000

# Thông tin kết nối PostgreSQL của máy bạn
DB_USER=postgres
DB_PASSWORD=123456       # Thay bằng mật khẩu pgAdmin của bạn
DB_HOST=localhost
DB_PORT=5432
DB_NAME=gastrowise_db    # Thay bằng tên DB bạn vừa tạo ở Bước 2

# Khoá bí mật để tạo JWT Token (Gõ bừa 1 chuỗi dài dài cũng được)
JWT_SECRET=GastroWiseSecretKeyKLTN2024!@#
JWT_EXPIRES_IN=30d
```

### Bước 4: Chạy Server
Sau khi cấu hình xong `.env`, hãy chạy lệnh:
```bash
npm run dev
```
Nếu Terminal hiện dòng chữ `🚀 Server đang chạy trên port 5000` và `✅ Kết nối Database thành công!`, xin chúc mừng, bạn đã setup thành công Backend!

---

## 💡 Lưu ý Thêm (Cấp quyền Admin)
Vì lý do bảo mật, bạn không thể tự đăng ký tài khoản Admin trên Web. 
Sau khi bạn đăng ký một tài khoản User bình thường trên Web, hãy mở pgAdmin, chạy lệnh SQL này để tự cấp quyền Admin cho tài khoản của bạn:
```sql
UPDATE users 
SET role = 'admin' 
WHERE email = 'email_cua_ban_vua_dang_ky@example.com';
```
Đăng xuất và đăng nhập lại trên Web để có quyền duyệt các quán ăn.
