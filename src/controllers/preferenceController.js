const pool = require('../config/db');

exports.getPreferences = async (req, res) => {
  try {
    const userId = req.user.id;
    const { rows } = await pool.query('SELECT * FROM user_preferences WHERE user_id = $1', [userId]);
    
    if (rows.length === 0) {
      return res.status(200).json(null);
    }
    res.status(200).json(rows[0]);
  } catch (error) {
    res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.upsertPreferences = async (req, res) => {
  try {
    const userId = req.user.id;
    const { dietary_options, favorite_cuisines, max_budget, preferred_atmosphere, max_distance } = req.body;

    const query = `
      INSERT INTO user_preferences 
      (user_id, dietary_options, favorite_cuisines, max_budget, preferred_atmosphere, max_distance) 
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_id) 
      DO UPDATE SET 
        dietary_options = EXCLUDED.dietary_options,
        favorite_cuisines = EXCLUDED.favorite_cuisines,
        max_budget = EXCLUDED.max_budget,
        preferred_atmosphere = EXCLUDED.preferred_atmosphere,
        max_distance = EXCLUDED.max_distance,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;
    
    const values = [
      userId, 
      dietary_options || [], 
      favorite_cuisines || [], 
      max_budget || 500000, 
      preferred_atmosphere || [], 
      max_distance || 10
    ];
    
    const { rows } = await pool.query(query, values);
    res.status(200).json(rows[0]);
  } catch (error) {
    res.status(500).json({ message: 'Lỗi server' });
  }
};
