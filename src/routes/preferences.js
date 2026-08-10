const express = require('express');
const router = express.Router();
const preferenceController = require('../controllers/preferenceController');
const authMiddleware = require('../middlewares/authMiddleware');

router.use(authMiddleware);

router.get('/', preferenceController.getPreferences);
router.post('/', preferenceController.upsertPreferences);

module.exports = router;
