const User = require('../models/User');
const bcrypt = require('bcryptjs');

exports.getProfile = async (req, res) => {
  try {
    // req.user được set từ authMiddleware (chứa id)
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ message: 'Không tìm thấy người dùng' });
    }
    
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
    
    // Tạm thời viết lệnh Update trực tiếp ở đây hoặc có thể thêm vào Model
    // Vì User model chưa có hàm update, mình sẽ gọi pool query thẳng tạm thời
    const pool = require('../config/db');
    let query = 'UPDATE users SET full_name = $1, phone = $2';
    let values = [full_name, phone];
    let paramIndex = 3;
    
    if (password) {
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(password, salt);
      query += `, password_hash = $${paramIndex}`;
      values.push(hash);
    }
    
    query += ` WHERE id = $${password ? paramIndex + 1 : paramIndex} RETURNING id, full_name, email, phone`;
    values.push(userId);
    
    const result = await pool.query(query, values);
    
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Lỗi cập nhật profile:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
};
