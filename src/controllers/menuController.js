const pool = require('../config/db');

exports.getMenuByRestaurant = async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const { rows } = await pool.query(
      'SELECT id, name, description, price, image_url FROM menu_items WHERE restaurant_id = $1 ORDER BY created_at ASC',
      [restaurantId]
    );
    res.status(200).json(rows);
  } catch (error) {
    console.error('Error fetching menu:', error);
    res.status(500).json({ message: 'Lỗi server khi lấy thực đơn', error: error.message });
  }
};
