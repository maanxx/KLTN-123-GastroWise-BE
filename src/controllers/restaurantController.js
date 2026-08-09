const Restaurant = require('../models/Restaurant');

// Lấy danh sách nhà hàng (có hỗ trợ tìm kiếm quanh đây)
exports.getRestaurants = async (req, res) => {
  const { lat, lng, radius, cuisine, search } = req.query;

  try {
    const restaurants = await Restaurant.findNearby(lat, lng, radius, cuisine, search);
    return res.status(200).json(restaurants);

  } catch (error) {
    console.error('Lỗi khi lấy danh sách nhà hàng:', error.message);
    // Trả về JSON lỗi chi tiết để không bị sập Railway
    return res.status(500).json({ 
      message: 'Lỗi server khi lấy danh sách nhà hàng', 
      error: error.message 
    });
  }
};

// Lấy chi tiết nhà hàng theo ID
exports.getRestaurantById = async (req, res) => {
  const { id } = req.params;

  try {
    const restaurant = await Restaurant.findById(id);

    if (!restaurant) {
      return res.status(404).json({ message: 'Không tìm thấy nhà hàng' });
    }

    return res.status(200).json(restaurant);
  } catch (error) {
    console.error('Lỗi khi lấy chi tiết nhà hàng:', error.message);
    return res.status(500).json({ 
      message: 'Lỗi server khi lấy chi tiết nhà hàng',
      error: error.message 
    });
  }
};