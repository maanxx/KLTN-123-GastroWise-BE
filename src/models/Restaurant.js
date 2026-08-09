const pool = require('../config/db');

class Restaurant {
  static async findById(id) {
    const query = `
      SELECT 
        id, owner_id, name, address, cuisine, opening_hours, phone, website,
        avg_price, rating_avg, cover_image, status, created_at,
        ST_X(location::geometry) AS lng,
        ST_Y(location::geometry) AS lat
      FROM restaurants 
      WHERE id = $1
    `;
    const { rows } = await pool.query(query, [id]);
    return rows[0];
  }

  static async findNearby(lat, lng, radius = 5000, cuisine = null, search = null) {
    let values = [];
    let selectFields = `
      id, name, address, cuisine, opening_hours, phone, rating_avg, cover_image,
      ST_X(location::geometry) AS lng,
      ST_Y(location::geometry) AS lat
    `;
    let conditions = ["status = 'approved'"];

    if (lat && lng) {
      values.push(parseFloat(lng), parseFloat(lat));
      selectFields += `, ST_Distance(location::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_m`;
      conditions.push(`ST_DWithin(location::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, ${radius})`);
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
      query += ` ORDER BY ST_Distance(location::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) ASC LIMIT 50`;
    } else {
      query += ` ORDER BY rating_avg DESC LIMIT 50`;
    }

    const { rows } = await pool.query(query, values);
    return rows;
  }
}

module.exports = Restaurant;
