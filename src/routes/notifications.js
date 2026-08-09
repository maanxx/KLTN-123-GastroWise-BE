const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const authMiddleware = require('../middlewares/authMiddleware');

router.use(authMiddleware);

router.get('/', notificationController.getUserNotifications);
router.patch('/:id/read', notificationController.markAsRead);

module.exports = router;
