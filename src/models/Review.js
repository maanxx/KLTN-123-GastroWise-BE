const pool = require('../config/db');

class Review {
  static async findByRestaurantId(restaurantId) {
    const query = `
      SELECT r.id, r.rating, r.comment, r.created_at, u.full_name, u.avatar_url
      FROM reviews r
      JOIN users u ON r.user_id = u.id
      WHERE r.restaurant_id = $1
      ORDER BY r.created_at DESC
    `;
    const { rows } = await pool.query(query, [restaurantId]);
    return rows;
  }

  static async create(data) {
    const { user_id, restaurant_id, rating, comment } = data;
    const query = `
      INSERT INTO reviews (user_id, restaurant_id, rating, comment)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    const { rows } = await pool.query(query, [user_id, restaurant_id, rating, comment]);
    
    // TODO: Có thể trigger tính lại rating_avg cho bảng restaurants ở đây
    
    return rows[0];
  }
}

module.exports = Review;
