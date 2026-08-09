const express = require('express');
const router = express.Router();
const itineraryController = require('../controllers/itineraryController');
const authMiddleware = require('../middlewares/authMiddleware');

// Tất cả các API Lộ trình đều yêu cầu đăng nhập
router.use(authMiddleware);

// Lấy danh sách lộ trình của user
router.get('/', itineraryController.getUserItineraries);

// Tạo lộ trình mới (AI Planner)
router.post('/generate', itineraryController.generateItinerary);

// Xem chi tiết một lộ trình
router.get('/:id', itineraryController.getItineraryById);

module.exports = router;
