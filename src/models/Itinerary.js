const pool = require('../config/db');

class Itinerary {
  static async findByUserId(userId) {
    const query = `
      SELECT * FROM itineraries 
      WHERE user_id = $1 
      ORDER BY created_at DESC
    `;
    const { rows } = await pool.query(query, [userId]);
    return rows;
  }

  static async findById(id) {
    // Join với itinerary_stops và restaurants để lấy chi tiết lộ trình
    const query = `
      SELECT 
        i.*,
        json_agg(
          json_build_object(
            'stop_id', s.id,
            'restaurant_id', s.restaurant_id,
            'order_index', s.order_index,
            'restaurant_name', r.name,
            'restaurant_lat', ST_Y(r.location::geometry),
            'restaurant_lng', ST_X(r.location::geometry)
          ) ORDER BY s.order_index ASC
        ) as stops
      FROM itineraries i
      LEFT JOIN itinerary_stops s ON i.id = s.itinerary_id
      LEFT JOIN restaurants r ON s.restaurant_id = r.id
      WHERE i.id = $1
      GROUP BY i.id
    `;
    const { rows } = await pool.query(query, [id]);
    return rows[0];
  }

  static async create(data) {
    const { user_id, title, start_time, end_time, budget, start_lat, start_lng } = data;
    
    let locationVal = null;
    if (start_lat && start_lng) {
      locationVal = `ST_SetSRID(ST_MakePoint(${start_lng}, ${start_lat}), 4326)`;
    }

    const query = `
      INSERT INTO itineraries (user_id, title, start_time, end_time, budget, start_location)
      VALUES ($1, $2, $3, $4, $5, ${locationVal ? locationVal : 'NULL'})
      RETURNING *
    `;
    const { rows } = await pool.query(query, [user_id, title, start_time, end_time, budget]);
    return rows[0];
  }
}

module.exports = Itinerary;
