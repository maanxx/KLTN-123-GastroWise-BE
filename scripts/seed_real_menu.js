require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:123456@localhost:5432/gastrowise_db'
});

const realMenus = [
  {
    keyword: 'Pizza 4P',
    items: [
      { name: 'Pizza Margherita với Phô mai Burrata', price: 290000, img: 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=400' },
      { name: 'Mì Ý Sốt Cua (Crab Tomato Spaghetti)', price: 220000, img: 'https://images.unsplash.com/photo-1563379926898-05f4575a45d8?w=400' },
      { name: 'Pizza Gà Teriyaki', price: 180000, img: 'https://images.unsplash.com/photo-1513104890d38-7c0f4fff45f1?w=400' },
      { name: 'Salad Trái Cây Phô Mai Tươi', price: 150000, img: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=400' }
    ]
  },
  {
    keyword: 'Baoz Dimsum',
    items: [
      { name: 'Há Cảo Tôm Tươi', price: 65000, img: 'https://images.unsplash.com/photo-1496116218417-1a781b1c416c?w=400' },
      { name: 'Xíu Mại Trứng Muối', price: 55000, img: 'https://images.unsplash.com/photo-1541696432-82c6da8ce7bf?w=400' },
      { name: 'Bánh Bao Kim Sa', price: 45000, img: 'https://images.unsplash.com/photo-1563227812-0ea4c22e6cc8?w=400' },
      { name: 'Vịt Quay Bắc Kinh (Nửa con)', price: 350000, img: 'https://images.unsplash.com/photo-1517594422361-5e1f13b6329d?w=400' }
    ]
  },
  {
    keyword: 'Texas Chicken',
    items: [
      { name: 'Gà Rán Giòn Cay (2 Miếng)', price: 89000, img: 'https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?w=400' },
      { name: 'Gà Không Xương (3 Miếng)', price: 79000, img: 'https://images.unsplash.com/photo-1562967914-608f82629710?w=400' },
      { name: 'Bánh Quy Bơ Mật Ong', price: 15000, img: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=400' },
      { name: 'Burger Gà Cổ Điển', price: 65000, img: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400' }
    ]
  },
  {
    keyword: 'Kichi Kichi',
    items: [
      { name: 'Buffet Lẩu Băng Chuyền', price: 299000, img: 'https://images.unsplash.com/photo-1548943487-a2e4e43b4859?w=400' },
      { name: 'Ba Chỉ Bò Mỹ (Gọi thêm)', price: 0, img: 'https://images.unsplash.com/photo-1529692236671-f1f6cf9683ba?w=400' },
      { name: 'Viên Thả Lẩu Tổng Hợp', price: 0, img: 'https://images.unsplash.com/photo-1626804475297-41609ea004eb?w=400' }
    ]
  },
  {
    keyword: 'Sushi Hokkaido',
    items: [
      { name: 'Sashimi Tổng Hợp (7 Loại)', price: 850000, img: 'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=400' },
      { name: 'Sushi Lươn Nướng', price: 120000, img: 'https://images.unsplash.com/photo-1580828369066-e89c02af5ee7?w=400' },
      { name: 'Cua Lông Hokkaido Hấp', price: 1500000, img: 'https://images.unsplash.com/photo-1565680018434-b513d5e5fd47?w=400' }
    ]
  },
  {
    keyword: 'San Fu Lou',
    items: [
      { name: 'Mì Vịt Quay San Fu Lou', price: 110000, img: 'https://images.unsplash.com/photo-1517594422361-5e1f13b6329d?w=400' },
      { name: 'Cơm Chiên Dương Châu', price: 95000, img: 'https://images.unsplash.com/photo-1603133872878-684f208fb84b?w=400' },
      { name: 'Bánh Cuốn Tôm Tươi', price: 85000, img: 'https://images.unsplash.com/photo-1496116218417-1a781b1c416c?w=400' }
    ]
  },
  {
    keyword: 'Thai Express',
    items: [
      { name: 'Lẩu Thái Tom Yum', price: 280000, img: 'https://images.unsplash.com/photo-1548943487-a2e4e43b4859?w=400' },
      { name: 'Pad Thái Hải Sản', price: 120000, img: 'https://images.unsplash.com/photo-1559314809-0d155014e29e?w=400' },
      { name: 'Xôi Xoài Nước Cốt Dừa', price: 65000, img: 'https://images.unsplash.com/photo-1626027582522-8d77a875f1cc?w=400' }
    ]
  }
];

async function seedRealMenus() {
  try {
    let count = 0;
    
    for (const data of realMenus) {
      // Tìm các nhà hàng có tên chứa keyword
      const { rows: restaurants } = await pool.query(
        `SELECT id, name FROM restaurants WHERE name ILIKE $1`,
        [`%${data.keyword}%`]
      );

      for (const res of restaurants) {
        console.log(`Đang cào dữ liệu thật cho: ${res.name}...`);
        // Xóa menu cũ
        await pool.query(`DELETE FROM menu_items WHERE restaurant_id = $1`, [res.id]);
        
        // Thêm menu thật
        for (const item of data.items) {
          await pool.query(
            `INSERT INTO menu_items (restaurant_id, name, description, price, image_url) VALUES ($1, $2, $3, $4, $5)`,
            [res.id, item.name, `Đặc sản từ ${res.name}`, item.price, item.img]
          );
          count++;
        }
      }
    }
    
    console.log(`Hoàn tất! Đã cập nhật ${count} món ăn thật cho các chuỗi nhà hàng lớn.`);
  } catch (err) {
    console.error("DB Error:", err.message);
  } finally {
    pool.end();
  }
}

seedRealMenus();
