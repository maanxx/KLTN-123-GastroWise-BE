const pool = require('../config/db');

// Lấy danh sách nhà hàng (có hỗ trợ tìm kiếm quanh đây)
exports.getRestaurants = async (req, res) => {
  const { lat, lng, radius, cuisine, search } = req.query;

  try {
    let query = '';
    let values = [];

    // Base fields cần lấy
    let selectFields = `
      id, name, address, cuisine, opening_hours, phone, rating_avg, cover_image,
      ST_X(location::geometry) AS lng,
      ST_Y(location::geometry) AS lat
    `;

    // Khởi tạo điều kiện WHERE cơ bản
    let conditions = ["status = 'approved'"];

    if (lat && lng) {
      // Nếu có tọa độ, dùng PostGIS để lọc theo bán kính và tính khoảng cách
      const searchRadius = radius ? parseInt(radius) : 5000; // Mặc định 5000m
      
      // Thêm trường distance_m (khoảng cách tính bằng mét)
      selectFields += `, ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)) AS distance_m`;
      values.push(lng, lat); // $1, $2
      
      // Lọc các quán trong bán kính searchRadius
      conditions.push(`ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326), ${searchRadius})`);
    }

    // Xử lý filter cuisine (optional)
    if (cuisine) {
      values.push(cuisine);
      conditions.push(`cuisine ILIKE $${values.length}`);
    }

    // Xử lý search theo tên (optional)
    if (search) {
      values.push(`%${search}%`);
      conditions.push(`name ILIKE $${values.length}`);
    }

    // Lắp ráp câu query
    query = `SELECT ${selectFields} FROM restaurants`;
    
    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(' AND ');
    }

    // Sắp xếp
    if (lat && lng) {
      // Nếu tìm quanh đây, sắp xếp theo khoảng cách gần nhất
      query += ` ORDER BY distance_m ASC`;
    } else {
      // Mặc định sắp xếp theo đánh giá giảm dần
      query += ` ORDER BY rating_avg DESC LIMIT 50`;
    }

    const result = await pool.query(query, values);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Lỗi khi lấy danh sách nhà hàng:', error);
    res.status(500).json({ message: 'Lỗi server khi lấy danh sách nhà hàng' });
  }
};

// Lấy chi tiết nhà hàng theo ID
exports.getRestaurantById = async (req, res) => {
  const { id } = req.params;

  try {
    const query = `
      SELECT 
        id, owner_id, name, address, cuisine, opening_hours, phone, website,
        avg_price, rating_avg, cover_image, status, created_at,
        ST_X(location::geometry) AS lng,
        ST_Y(location::geometry) AS lat
      FROM restaurants 
      WHERE id = $1
    `;
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy nhà hàng' });
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Lỗi khi lấy chi tiết nhà hàng:', error);
    res.status(500).json({ message: 'Lỗi server khi lấy chi tiết nhà hàng' });
  }
};
