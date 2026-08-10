require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:123456@localhost:5432/gastrowise_db'
});

async function run() {
  try {
    await pool.query(`ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS google_place_id VARCHAR(255);`);
    console.log("Added google_place_id column successfully");
  } catch (err) {
    console.error("DB Error:", err.message);
  } finally {
    pool.end();
  }
}
run();
