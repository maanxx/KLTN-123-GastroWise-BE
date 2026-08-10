const express = require('express');
const router = express.Router();
const menuController = require('../controllers/menuController');

router.get('/restaurant/:restaurantId', menuController.getMenuByRestaurant);

module.exports = router;
