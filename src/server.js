// Load biến môi trường từ file .env
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const authRoutes = require('./routes/auth');
const restaurantRoutes = require('./routes/restaurants');

const app = express();

// Middleware
app.use(cors()); // Cho phép cross-origin requests
app.use(express.json()); // Parse JSON từ request body
app.use(morgan('dev')); // Ghi log request ra console

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/restaurants', restaurantRoutes);

// Route test nhanh
app.get('/', (req, res) => {
  res.json({ message: "GastroWise API is running" });
});

// Lắng nghe cổng
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server đang chạy trên cổng ${PORT}`);
});
