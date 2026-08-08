// Cấu hình kết nối cơ sở dữ liệu PostgreSQL
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.connect((err, client, release) => {
  if (err) {
    console.error('Lỗi kết nối database:', err.stack);
  } else {
    console.log('Đã kết nối thành công tới cơ sở dữ liệu PostgreSQL.');
    release(); // Giải phóng client
  }
});

module.exports = pool;
