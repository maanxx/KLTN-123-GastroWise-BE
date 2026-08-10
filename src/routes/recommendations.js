const express = require('express');
const router = express.Router();
const recommendationController = require('../controllers/recommendationController');
const authMiddleware = require('../middlewares/authMiddleware');

router.use(authMiddleware);
router.get('/', recommendationController.getRecommendations);

module.exports = router;
