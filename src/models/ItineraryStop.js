const pool = require('../config/db');

class ItineraryStop {
  static async create(data) {
    const { itinerary_id, restaurant_id, order_index, arrival_time, departure_time, distance_from_prev } = data;
    const query = `
      INSERT INTO itinerary_stops (itinerary_id, restaurant_id, order_index, arrival_time, departure_time, distance_from_prev)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const { rows } = await pool.query(query, [itinerary_id, restaurant_id, order_index, arrival_time, departure_time, distance_from_prev]);
    return rows[0];
  }
  
  static async bulkCreate(stops) {
    // TODO: Implement batch insert for performance when saving generated route
    // Tạm thời dùng vòng lặp cho prototype
    let results = [];
    for (const stop of stops) {
      results.push(await this.create(stop));
    }
    return results;
  }
}

module.exports = ItineraryStop;
