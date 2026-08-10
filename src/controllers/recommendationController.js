const pool = require('../config/db');

exports.getRecommendations = async (req, res) => {
  try {
    const userId = req.user.id;
    const { lat, lng } = req.query; 

    let prefRows = [];
    if (userId) {
      const p = await pool.query('SELECT * FROM user_preferences WHERE user_id = $1', [userId]);
      prefRows = p.rows;
    }

    let query = `SELECT * FROM restaurants WHERE 1=1`;
    let params = [];
    let paramIndex = 1;
    let orderByParts = [];

    if (prefRows.length > 0) {
      const pref = prefRows[0];
      
      if (pref.max_budget) {
        query += ` AND avg_price <= $${paramIndex}`;
        params.push(pref.max_budget);
        paramIndex++;
      }

      if (pref.favorite_cuisines && pref.favorite_cuisines.length > 0) {
        const cuisineConditions = pref.favorite_cuisines.map((_, i) => `cuisine ILIKE $${paramIndex + i}`).join(' OR ');
        query += ` AND (${cuisineConditions})`;
        params.push(...pref.favorite_cuisines.map(c => `%${c}%`));
        paramIndex += pref.favorite_cuisines.length;
      }
    }

    if (lat && lng) {
      orderByParts.push(`ST_Distance(location, ST_SetSRID(ST_MakePoint($${paramIndex}, $${paramIndex+1}), 4326)) ASC`);
      params.push(lng, lat);
      paramIndex += 2;
    }

    orderByParts.push(`rating_avg DESC NULLS LAST`);

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 8;
    const offset = (page - 1) * limit;

    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
    const { rows: countRows } = await pool.query(countQuery, params);
    const total = parseInt(countRows[0].total);

    if (orderByParts.length > 0) {
      query += ` ORDER BY ` + orderByParts.join(', ');
    }
    
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const { rows } = await pool.query(query, params);
    
    res.status(200).json({
      data: rows,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Error in recommendations:', error);
    res.status(500).json({ message: 'Lỗi server', error: error.message });
  }
};
