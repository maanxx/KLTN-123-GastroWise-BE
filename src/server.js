// Load biến môi trường từ file .env
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const authRoutes = require('./routes/auth');
const restaurantRoutes = require('./routes/restaurants');
const userRoutes = require('./routes/users');
const reviewRoutes = require('./routes/reviews');
const itineraryRoutes = require('./routes/itineraries');
const adminRoutes = require('./routes/admin');
const favoriteRoutes = require('./routes/favorites');
const notificationRoutes = require('./routes/notifications');
const menuRoutes = require('./routes/menus');

const app = express();

// Middleware
app.use(cors()); // Cho phép cross-origin requests
app.use(express.json()); // Parse JSON từ request body
app.use(morgan('dev')); // Ghi log request ra console

app.use('/api/auth', authRoutes);
app.use('/api/restaurants', restaurantRoutes);
app.use('/api/users', userRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/itineraries', itineraryRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/favorites', favoriteRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/explore', require('./routes/explore'));
app.use('/api/preferences', require('./routes/preferences'));
app.use('/api/recommendations', require('./routes/recommendations'));
app.use('/api/menus', menuRoutes);

app.get('/', (req, res) => {
  res.json({ message: "GastroWise API is running" });
});

// Lắng nghe cổng (Thêm '0.0.0.0' để Railway nhận dạng)
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server đang chạy trên cổng ${PORT}`);
});