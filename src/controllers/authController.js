const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Xử lý đăng ký tài khoản mới
exports.register = async (req, res) => {
  const { full_name, email, password, phone } = req.body;

  try {
    // Kiểm tra xem email đã tồn tại chưa
    const existingUser = await User.findByEmail(email);
    
    if (existingUser) {
      return res.status(409).json({ message: 'Email đã tồn tại' });
    }

    // Hash mật khẩu
    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);

    // Lưu vào cơ sở dữ liệu qua Model
    const user = await User.create({
      full_name,
      email,
      password_hash,
      phone
    });

    // Tạo JWT token
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' } // Hết hạn sau 7 ngày
    );

    // Trả về thông tin user và token
    res.status(201).json({ user, token });
  } catch (error) {
    console.error('Lỗi khi đăng ký:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

// Xử lý đăng nhập
exports.login = async (req, res) => {
  const { email, password } = req.body;

  try {
    // Tìm user theo email
    const user = await User.findByEmail(email);

    if (!user) {
      return res.status(401).json({ message: 'Email hoặc mật khẩu không đúng' });
    }

    // So sánh mật khẩu bằng bcrypt
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Email hoặc mật khẩu không đúng' });
    }

    // Tạo JWT token
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Loại bỏ trường password_hash trước khi trả về
    delete user.password_hash;

    // Trả về thông tin user và token
    res.status(200).json({ user, token });
  } catch (error) {
    console.error('Lỗi khi đăng nhập:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
};
