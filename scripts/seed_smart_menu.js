require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:123456@localhost:5432/gastrowise_db'
});

const menuDictionary = {
  'Món Việt': [
    { name: 'Phở Bò Tái Nạm', price: 55000, img: 'https://images.unsplash.com/photo-1582878826629-29b7ad1cdc43?w=400' },
    { name: 'Bún Chả Hà Nội', price: 60000, img: 'https://images.unsplash.com/photo-1636208638118-208a5cb0cbff?w=400' },
    { name: 'Gỏi Cuốn (3 Cuốn)', price: 30000, img: 'https://images.unsplash.com/photo-1626027582522-8d77a875f1cc?w=400' },
    { name: 'Trà Đá', price: 5000, img: null },
  ],
  'Món Nhật': [
    { name: 'Sushi Cá Hồi (Sashimi)', price: 120000, img: 'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=400' },
    { name: 'Mì Ramen Tonkotsu', price: 150000, img: 'https://images.unsplash.com/photo-1557872943-16a5ac26437e?w=400' },
    { name: 'Cơm Lươn Nhật', price: 180000, img: 'https://images.unsplash.com/photo-1580828369066-e89c02af5ee7?w=400' },
    { name: 'Matcha Lạnh', price: 40000, img: null },
  ],
  'Món Hàn': [
    { name: 'Thịt Nướng BBQ Hàn Quốc', price: 250000, img: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=400' },
    { name: 'Cơm Trộn Bibimbap', price: 85000, img: 'https://images.unsplash.com/photo-1553163147-622ab57be1c7?w=400' },
    { name: 'Canh Kim Chi', price: 75000, img: 'https://images.unsplash.com/photo-1638848777093-a9dcb69c7379?w=400' },
    { name: 'Rượu Soju', price: 60000, img: 'https://images.unsplash.com/photo-1563223771-477c7c251416?w=400' },
  ],
  'Cafe/Dessert': [
    { name: 'Cà Phê Sữa Đá', price: 35000, img: 'https://images.unsplash.com/photo-1596541223130-5d31a73fb6c6?w=400' },
    { name: 'Trà Sữa Trân Châu', price: 45000, img: 'https://images.unsplash.com/photo-1558857563-b37102e951bf?w=400' },
    { name: 'Bánh Ngọt Tiramisu', price: 55000, img: 'https://images.unsplash.com/photo-1571115177098-24c42d640fc9?w=400' },
  ],
  'Món Tây': [
    { name: 'Steak Bò Úc', price: 350000, img: 'https://images.unsplash.com/photo-1600891964092-4316c288032e?w=400' },
    { name: 'Mì Ý Hải Sản', price: 150000, img: 'https://images.unsplash.com/photo-1563379926898-05f4575a45d8?w=400' },
    { name: 'Pizza Margherita', price: 180000, img: 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=400' },
  ],
  'Món Chay': [
    { name: 'Lẩu Nấm Chay', price: 150000, img: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=400' },
    { name: 'Cơm Sen', price: 75000, img: 'https://images.unsplash.com/photo-1615486171448-4fb6067b5e4f?w=400' },
    { name: 'Gỏi Ngó Sen', price: 55000, img: 'https://images.unsplash.com/photo-1582878826629-29b7ad1cdc43?w=400' },
  ]
};

async function seedSmartMenu() {
  try {
    const { rows: restaurants } = await pool.query('SELECT id, cuisine, name FROM restaurants');
    console.log(`Starting smart seed for ${restaurants.length} restaurants...`);
    let count = 0;

    for (const res of restaurants) {
      // Xác định loại ẩm thực
      const cuisineStr = res.cuisine || '';
      const name = res.name.toLowerCase();
      let category = 'Món Việt'; // Default

      if (cuisineStr.includes('Nhật') || name.includes('sushi')) category = 'Món Nhật';
      else if (cuisineStr.includes('Hàn') || name.includes('bbq')) category = 'Món Hàn';
      else if (cuisineStr.includes('Âu') || cuisineStr.includes('Mỹ') || name.includes('pizza') || name.includes('steak')) category = 'Món Tây';
      else if (cuisineStr.includes('Cafe') || cuisineStr.includes('Trà sữa') || name.includes('coffee')) category = 'Cafe/Dessert';
      else if (cuisineStr.includes('Chay') || name.includes('chay')) category = 'Món Chay';

      // Skip Phá Lấu Đồng Diều (we already inserted real data for it)
      if (name.includes('phá lấu đồng diều')) continue;

      const items = menuDictionary[category];

      // Delete old generic items
      await pool.query(`DELETE FROM menu_items WHERE restaurant_id = $1`, [res.id]);

      // Insert smart items
      for (const item of items) {
        await pool.query(
          `INSERT INTO menu_items (restaurant_id, name, description, price, image_url) VALUES ($1, $2, $3, $4, $5)`,
          [res.id, item.name, `Món ${item.name} đặc biệt của ${res.name}`, item.price, item.img]
        );
        count++;
      }
    }
    console.log(`Successfully inserted ${count} smart menu items!`);
  } catch (err) {
    console.error("DB Error:", err.message);
  } finally {
    pool.end();
  }
}

seedSmartMenu();
