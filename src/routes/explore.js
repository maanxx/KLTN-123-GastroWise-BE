const express = require('express');
const router = express.Router();
const exploreController = require('../controllers/exploreController');

// Public API, no auth required to explore restaurants
router.get('/', exploreController.searchAndFilter);

module.exports = router;
