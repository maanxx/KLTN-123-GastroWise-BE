const pool = require('../config/db');

exports.getStats = async (req, res) => {
  try {
    const userCount = await pool.query('SELECT COUNT(*) FROM users');
    const restaurantCount = await pool.query('SELECT COUNT(*) FROM restaurants');
    const itineraryCount = await pool.query('SELECT COUNT(*) FROM itineraries');
    const reviewCount = await pool.query('SELECT COUNT(*) FROM reviews');

    res.status(200).json({
      totalUsers: parseInt(userCount.rows[0].count),
      totalRestaurants: parseInt(restaurantCount.rows[0].count),
      totalItineraries: parseInt(itineraryCount.rows[0].count),
      totalReviews: parseInt(reviewCount.rows[0].count),
    });
  } catch (error) {
    console.error('Lỗi lấy thống kê Admin:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.getRestaurants = async (req, res) => {
  try {
    // Lấy tất cả nhà hàng, bao gồm trạng thái (pending, approved, rejected)
    const query = `
      SELECT id, name, address, cuisine, status, created_at
      FROM restaurants
      ORDER BY created_at DESC
    `;
    const { rows } = await pool.query(query);
    res.status(200).json(rows);
  } catch (error) {
    console.error('Lỗi lấy danh sách nhà hàng Admin:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.updateRestaurantStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Trạng thái không hợp lệ' });
    }

    const query = `
      UPDATE restaurants 
      SET status = $1 
      WHERE id = $2 
      RETURNING id, name, status
    `;
    const { rows } = await pool.query(query, [status, id]);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy nhà hàng' });
    }

    res.status(200).json(rows[0]);
  } catch (error) {
    console.error('Lỗi cập nhật trạng thái nhà hàng:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
};
