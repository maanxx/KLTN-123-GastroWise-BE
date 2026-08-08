const pool = require('../config/db');

// Lấy danh sách nhà hàng (có hỗ trợ tìm kiếm quanh đây)
exports.getRestaurants = async (req, res) => {
  const { lat, lng, radius, cuisine, search } = req.query;

  try {
    let values = [];
    
    // Base fields cơ bản
    let selectFields = `
      id, name, address, cuisine, opening_hours, phone, rating_avg, cover_image,
      ST_X(location::geometry) AS lng,
      ST_Y(location::geometry) AS lat
    `;

    let conditions = ["status = 'approved'"];

    if (lat && lng) {
      const searchRadius = radius ? parseInt(radius) : 5000; // Mặc định 5000m
      
      // $1: lng, $2: lat
      values.push(parseFloat(lng), parseFloat(lat));
      
      // Tính khoảng cách bằng mét sử dụng geography cast
      selectFields += `, ST_Distance(location::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_m`;
      
      // Bán kính tính theo mét
      conditions.push(`ST_DWithin(location::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, ${searchRadius})`);
    }

    if (cuisine) {
      values.push(cuisine);
      conditions.push(`cuisine ILIKE $${values.length}`);
    }

    if (search) {
      values.push(`%${search}%`);
      conditions.push(`name ILIKE $${values.length}`);
    }

    let query = `SELECT ${selectFields} FROM restaurants WHERE ` + conditions.join(' AND ');

    if (lat && lng) {
      // Sắp xếp theo biểu thức PostGIS để tránh lỗi Alias của Postgres
      query += ` ORDER BY ST_Distance(location::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) ASC LIMIT 50`;
    } else {
      query += ` ORDER BY rating_avg DESC LIMIT 50`;
    }

    const result = await pool.query(query, values);
    return res.status(200).json(result.rows);

  } catch (error) {
    console.error('Lỗi khi lấy danh sách nhà hàng:', error.message);
    // Trả về JSON lỗi chi tiết để không bị sập Railway
    return res.status(500).json({ 
      message: 'Lỗi server khi lấy danh sách nhà hàng', 
      error: error.message 
    });
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

    return res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Lỗi khi lấy chi tiết nhà hàng:', error.message);
    return res.status(500).json({ 
      message: 'Lỗi server khi lấy chi tiết nhà hàng',
      error: error.message 
    });
  }
};