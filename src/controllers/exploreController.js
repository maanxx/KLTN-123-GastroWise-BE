const Restaurant = require('../models/Restaurant');
const pool = require('../config/db');

exports.searchAndFilter = async (req, res) => {
  try {
    const { 
      q,
      cuisine,
      minPrice, 
      maxPrice, 
      sortBy,
      lat,
      lng,
      radius
    } = req.query;

    let query = `SELECT * FROM restaurants WHERE 1=1`;
    const params = [];
    let paramIndex = 1;

    if (q) {
      query += ` AND name ILIKE $${paramIndex}`;
      params.push(`%${q}%`);
      paramIndex++;
    }

    if (cuisine) {
      query += ` AND cuisine ILIKE $${paramIndex}`;
      params.push(`%${cuisine}%`);
      paramIndex++;
    }

    if (minPrice) {
      query += ` AND avg_price >= $${paramIndex}`;
      params.push(minPrice);
      paramIndex++;
    }

    if (maxPrice) {
      query += ` AND avg_price <= $${paramIndex}`;
      params.push(maxPrice);
      paramIndex++;
    }

    if (lat && lng && radius) {
      query += ` AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($${paramIndex}, $${paramIndex+1}), 4326), $${paramIndex+2})`;
      params.push(lng, lat, radius);
      paramIndex += 3;
    }

    if (sortBy === 'rating') {
      query += ` ORDER BY rating_avg DESC NULLS LAST`;
    } else if (sortBy === 'price_asc') {
      query += ` ORDER BY avg_price ASC NULLS LAST`;
    } else if (sortBy === 'price_desc') {
      query += ` ORDER BY avg_price DESC NULLS LAST`;
    } else {
      query += ` ORDER BY created_at DESC`;
    }

    const { rows } = await pool.query(query, params);
    res.status(200).json(rows);

  } catch (error) {
    res.status(500).json({ message: 'Lỗi server' });
  }
};
