const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const authMiddleware = require('../middlewares/authMiddleware');
const adminMiddleware = require('../middlewares/adminMiddleware');

// Tất cả API trong route này đều phải đi qua 2 lớp bảo vệ
router.use(authMiddleware, adminMiddleware);

// API Lấy số liệu thống kê
router.get('/stats', adminController.getStats);

// API Quản lý nhà hàng
router.get('/restaurants', adminController.getRestaurants);
router.patch('/restaurants/:id/status', adminController.updateRestaurantStatus);

module.exports = router;
