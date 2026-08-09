const pool = require('../config/db');

exports.toggleFavorite = async (req, res) => {
  try {
    const { restaurant_id } = req.body;
    const user_id = req.user.id;

    if (!restaurant_id) {
      return res.status(400).json({ message: 'Thiếu thông tin restaurant_id' });
    }

    // Kiểm tra xem đã favorite chưa
    const checkQuery = 'SELECT * FROM favorites WHERE user_id = $1 AND restaurant_id = $2';
    const { rows } = await pool.query(checkQuery, [user_id, restaurant_id]);

    if (rows.length > 0) {
      // Đã favorite -> Hủy favorite (Unlike)
      const deleteQuery = 'DELETE FROM favorites WHERE user_id = $1 AND restaurant_id = $2';
      await pool.query(deleteQuery, [user_id, restaurant_id]);
      return res.status(200).json({ message: 'Đã bỏ yêu thích', isFavorite: false });
    } else {
      // Chưa favorite -> Thêm vào favorite (Like)
      const insertQuery = 'INSERT INTO favorites (user_id, restaurant_id) VALUES ($1, $2)';
      await pool.query(insertQuery, [user_id, restaurant_id]);
      return res.status(200).json({ message: 'Đã thêm vào yêu thích', isFavorite: true });
    }
  } catch (error) {
    console.error('Lỗi khi toggle favorite:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.getUserFavorites = async (req, res) => {
  try {
    const user_id = req.user.id;
    const query = `
      SELECT r.* 
      FROM restaurants r
      JOIN favorites f ON r.id = f.restaurant_id
      WHERE f.user_id = $1
      ORDER BY f.created_at DESC
    `;
    const { rows } = await pool.query(query, [user_id]);
    res.status(200).json(rows);
  } catch (error) {
    console.error('Lỗi lấy danh sách yêu thích:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
};
