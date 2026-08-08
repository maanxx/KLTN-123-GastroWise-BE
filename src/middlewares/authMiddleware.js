const jwt = require('jsonwebtoken');

// Middleware xác thực JWT token
const authMiddleware = (req, res, next) => {
  // Lấy token từ header Authorization: Bearer <token>
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Không có token hoặc token không hợp lệ' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // Xác thực token bằng secret key
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Gắn thông tin user giải mã được vào request
    req.user = decoded;
    next();
  } catch (error) {
    console.error('Lỗi xác thực token:', error);
    return res.status(401).json({ message: 'Token không hợp lệ hoặc đã hết hạn' });
  }
};

module.exports = authMiddleware;
