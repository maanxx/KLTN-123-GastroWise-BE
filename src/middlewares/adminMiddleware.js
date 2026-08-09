// Middleware này PHẢI chạy sau authMiddleware
const adminMiddleware = (req, res, next) => {
  // req.user được gán từ authMiddleware
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ 
      message: 'Truy cập bị từ chối. Chỉ Quản trị viên (Admin) mới có quyền thực hiện thao tác này.' 
    });
  }
  next();
};

module.exports = adminMiddleware;
