const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// POST /api/auth/register -> Đăng ký
router.post('/register', authController.register);

// POST /api/auth/login -> Đăng nhập
router.post('/login', authController.login);

module.exports = router;
