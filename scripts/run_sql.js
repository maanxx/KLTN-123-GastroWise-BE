require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:123456@localhost:5432/gastrowise_db'
});

async function run() {
  try {
    const query = `
      CREATE TABLE IF NOT EXISTS user_preferences (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        dietary_options TEXT[],
        favorite_cuisines TEXT[],
        max_budget DECIMAL(12, 2) DEFAULT 500000,
        preferred_atmosphere TEXT[],
        max_distance INTEGER DEFAULT 10,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id)
      );
    `;
    await pool.query(query);
    console.log("Thành công: Đã tạo bảng user_preferences!");
  } catch(e) {
    console.error("Lỗi:", e.message);
  } finally {
    pool.end();
  }
}

run();
