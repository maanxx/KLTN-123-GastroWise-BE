const Review = require('../models/Review');
const Restaurant = require('../models/Restaurant');
const googlePlaces = require('../services/googlePlaces');
const pool = require('../config/db'); 

exports.getReviewsByRestaurant = async (req, res) => {
  try {
    const { restaurantId } = req.params;
    
    const localReviews = await Review.findByRestaurantId(restaurantId);
    
    let googleReviews = [];
    try {
      const restaurant = await Restaurant.findById(restaurantId);
      if (restaurant) {
        let placeId = restaurant.google_place_id;
        
        if (!placeId) {
          placeId = await googlePlaces.findPlaceId(restaurant.name, restaurant.address);
          if (placeId) {
            await pool.query('UPDATE restaurants SET google_place_id = $1 WHERE id = $2', [placeId, restaurantId]);
          }
        }
        
        if (placeId) {
          const rawGoogleReviews = await googlePlaces.getPlaceReviews(placeId);
          googleReviews = rawGoogleReviews.map(gr => ({
            id: `google-${gr.time}`,
            full_name: gr.author_name,
            avatar_url: gr.profile_photo_url,
            rating: gr.rating,
            comment: gr.text,
            created_at: new Date(gr.time * 1000).toISOString(),
            is_google: true 
          }));
        }
      }
    } catch (gErr) {
      console.error('Lỗi khi lấy Google Reviews:', gErr.message);
    }

    const allReviews = [...googleReviews, ...localReviews];
    res.status(200).json(allReviews);
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
    if (error.code === '23505') {
      return res.status(400).json({ message: 'Bạn đã đánh giá nhà hàng này rồi' });
    }
    console.error('Lỗi tạo đánh giá:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
};
