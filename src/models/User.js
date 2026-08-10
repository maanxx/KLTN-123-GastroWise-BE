const pool = require('../config/db');

class User {
  static async findByEmail(email) {
    const query = 'SELECT * FROM users WHERE email = $1';
    const { rows } = await pool.query(query, [email]);
    return rows[0];
  }

  static async findById(id) {
    const query = 'SELECT id, full_name, email, phone, avatar_url, role, created_at FROM users WHERE id = $1';
    const { rows } = await pool.query(query, [id]);
    return rows[0];
  }

  static async create(userData) {
    const { full_name, email, password_hash, phone } = userData;
    const query = `
      INSERT INTO users (full_name, email, password_hash, phone)
      VALUES ($1, $2, $3, $4)
      RETURNING id, full_name, email, phone, avatar_url, role, created_at
    `;
    const values = [full_name, email, password_hash, phone];
    const { rows } = await pool.query(query, values);
    return rows[0];
  }

  static async update(id, updateData) {
    const { full_name, phone, password_hash } = updateData;
    let query = 'UPDATE users SET full_name = $1, phone = $2';
    let values = [full_name, phone];
    let paramIndex = 3;
    
    if (password_hash) {
      query += `, password_hash = $${paramIndex}`;
      values.push(password_hash);
      paramIndex++;
    }
    
    query += ` WHERE id = $${paramIndex} RETURNING id, full_name, email, phone, avatar_url, role, created_at`;
    values.push(id);
    
    const { rows } = await pool.query(query, values);
    return rows[0];
  }
}

module.exports = User;
