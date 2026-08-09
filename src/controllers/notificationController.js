const pool = require('../config/db');

exports.getUserNotifications = async (req, res) => {
  try {
    const user_id = req.user.id;
    const query = `
      SELECT * FROM notifications 
      WHERE user_id = $1 
      ORDER BY created_at DESC 
      LIMIT 20
    `;
    const { rows } = await pool.query(query, [user_id]);
    res.status(200).json(rows);
  } catch (error) {
    console.error('Lỗi lấy thông báo:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.user.id;
    
    // Nếu id là 'all', đánh dấu tất cả
    if (id === 'all') {
      await pool.query('UPDATE notifications SET is_read = TRUE WHERE user_id = $1', [user_id]);
    } else {
      await pool.query('UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2', [id, user_id]);
    }
    
    res.status(200).json({ message: 'Đã đánh dấu đã đọc' });
  } catch (error) {
    console.error('Lỗi cập nhật trạng thái thông báo:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
};
