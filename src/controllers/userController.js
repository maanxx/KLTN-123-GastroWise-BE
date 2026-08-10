const User = require('../models/User');
const bcrypt = require('bcryptjs');
const redisClient = require('../config/redis');

exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const cacheKey = `user_profile:${userId}`;
    
    // Check Redis cache first
    const cachedProfile = await redisClient.get(cacheKey);
    if (cachedProfile) {
      return res.status(200).json(JSON.parse(cachedProfile));
    }

    // req.user được set từ authMiddleware (chứa id)
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ message: 'Không tìm thấy người dùng' });
    }
    
    // Save to Redis cache for 1 hour (3600 seconds)
    await redisClient.setEx(cacheKey, 3600, JSON.stringify(user));

    res.status(200).json(user);
  } catch (error) {
    console.error('Lỗi lấy profile:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const { full_name, phone, password } = req.body;
    const userId = req.user.id;
    
    let password_hash = null;
    if (password) {
      const salt = await bcrypt.genSalt(10);
      password_hash = await bcrypt.hash(password, salt);
    }
    
    const updatedUser = await User.update(userId, { full_name, phone, password_hash });
    
    // Invalidate Redis cache after update
    await redisClient.del(`user_profile:${userId}`);
    
    res.status(200).json(updatedUser);
  } catch (error) {
    console.error('Lỗi cập nhật profile:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
};
