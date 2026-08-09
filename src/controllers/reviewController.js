const Review = require('../models/Review');

exports.getReviewsByRestaurant = async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const reviews = await Review.findByRestaurantId(restaurantId);
    res.status(200).json(reviews);
  } catch (error) {
    console.error('Lỗi lấy đánh giá:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.createReview = async (req, res) => {
  try {
    const { restaurant_id, rating, comment } = req.body;
    const user_id = req.user.id;
    
    const review = await Review.create({ user_id, restaurant_id, rating, comment });
    res.status(201).json(review);
  } catch (error) {
    // 23505 là mã lỗi unique violation trong PostgreSQL (đã review rồi)
    if (error.code === '23505') {
      return res.status(400).json({ message: 'Bạn đã đánh giá nhà hàng này rồi' });
    }
    console.error('Lỗi tạo đánh giá:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
};
