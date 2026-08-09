const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const authMiddleware = require('../middlewares/authMiddleware');

// Lấy danh sách đánh giá của 1 nhà hàng (Public)
router.get('/restaurant/:restaurantId', reviewController.getReviewsByRestaurant);

// Viết đánh giá (Yêu cầu đăng nhập)
router.post('/', authMiddleware, reviewController.createReview);

module.exports = router;
