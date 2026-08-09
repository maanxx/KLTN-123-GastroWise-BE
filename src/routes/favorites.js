const express = require('express');
const router = express.Router();
const favoriteController = require('../controllers/favoriteController');
const authMiddleware = require('../middlewares/authMiddleware');

router.use(authMiddleware);

router.get('/', favoriteController.getUserFavorites);
router.post('/toggle', favoriteController.toggleFavorite);

module.exports = router;
