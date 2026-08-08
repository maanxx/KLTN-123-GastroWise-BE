const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

// Xử lý đăng ký tài khoản mới
exports.register = async (req, res) => {
  const { full_name, email, password, phone } = req.body;

  try {
    // Kiểm tra xem email đã tồn tại chưa
    const checkEmailQuery = 'SELECT id FROM users WHERE email = $1';
    const checkEmailResult = await pool.query(checkEmailQuery, [email]);
    
    if (checkEmailResult.rows.length > 0) {
      return res.status(409).json({ message: 'Email đã tồn tại' });
    }

    // Hash mật khẩu
    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);

    // Lưu vào cơ sở dữ liệu, role mặc định là 'user'
    const insertUserQuery = `
      INSERT INTO users (full_name, email, password_hash, phone)
      VALUES ($1, $2, $3, $4)
      RETURNING id, full_name, email, phone, avatar_url, role, created_at
    `;
    const insertValues = [full_name, email, password_hash, phone];
    const userResult = await pool.query(insertUserQuery, insertValues);
    const user = userResult.rows[0];

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
    const findUserQuery = 'SELECT * FROM users WHERE email = $1';
    const userResult = await pool.query(findUserQuery, [email]);

    if (userResult.rows.length === 0) {
      return res.status(401).json({ message: 'Email hoặc mật khẩu không đúng' });
    }

    const user = userResult.rows[0];

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
