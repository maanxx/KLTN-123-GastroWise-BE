const express = require('express');
const router = express.Router();
const restaurantController = require('../controllers/restaurantController');

// GET /api/restaurants -> Lấy danh sách nhà hàng
router.get('/', restaurantController.getRestaurants);

// GET /api/restaurants/:id -> Lấy chi tiết nhà hàng
router.get('/:id', restaurantController.getRestaurantById);

module.exports = router;
