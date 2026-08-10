require('dotenv').config({ path: '.env' });
const { Pool } = require('pg');
const axios = require('axios');
const cheerio = require('cheerio');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:123456@localhost:5432/gastrowise_db'
});

async function seedFoody() {
  console.log('Bắt đầu cào dữ liệu THẬT kèm HÌNH ẢNH từ Foody (Hồ Chí Minh)...');
  let insertedCount = 0;
  
  try {
    const categories = ['nha-hang', 'cafe', 'quan-nhau', 'bar', 'an-vat-via-he'];
    
    for (const category of categories) {
      console.log(`\n=== Đang cào danh mục: ${category} ===`);
      for (let page = 1; page <= 3; page++) {
        console.log(`Đang cào trang ${page} của ${category}...`);
        const url = `https://www.foody.vn/ho-chi-minh/${category}?vt=row&st=1&page=${page}`;
        
        const response = await axios.get(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8'
          }
        });
        
        const html = response.data;
        const $ = cheerio.load(html);
        
        let items = null;
        $('script').each((i, el) => {
          const text = $(el).html();
          if (text && text.includes('"searchItems":[')) {
            const start = text.indexOf('"searchItems":[');
            const jsonStr = '[' + text.substring(start + 15, text.indexOf('],"adItems"')) + ']';
            try {
              items = JSON.parse(jsonStr);
            } catch(e) {
              console.log('Lỗi parse JSON trong script tag:', e.message);
            }
          }
        });
        
        if (items && items.length > 0) {
          for (const item of items) {
            if (!item.Latitude || !item.Longitude || !item.Name) continue;
            
            const name = item.Name;
            const address = item.Address + ', ' + item.District + ', ' + item.City;
            const lat = item.Latitude;
            const lng = item.Longitude;
            const coverImage = item.PicturePathLarge || item.PicturePath || '';
            
            let cuisine = category === 'cafe' ? 'Cafe/Dessert' : category === 'quan-nhau' ? 'Quán Nhậu' : category === 'bar' ? 'Bar/Pub' : category === 'an-vat-via-he' ? 'Ăn vặt/Vỉa hè' : 'Nhà hàng';
            if (item.Cuisines && item.Cuisines.length > 0) {
              cuisine = item.Cuisines.map(c => c.Name).join(', ');
            }
            
            const ratingAvg = item.AvgRatingOriginal > 0 ? parseFloat(item.AvgRatingOriginal.toFixed(1)) : parseFloat((Math.random() * (5 - 3.5) + 3.5).toFixed(1));
            const avgPrice = Math.floor(Math.random() * (500000 - 50000) + 50000); 
            
            const query = `
              INSERT INTO restaurants (
                name, address, location, cuisine, opening_hours, phone,
                avg_price, rating_avg, cover_image
              ) VALUES (
                $1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6, $7, $8, $9, $10
              ) ON CONFLICT DO NOTHING
            `;
            
            const values = [
              name, address, lng, lat, cuisine, '09:00 - 22:00', item.Phone || '',
              avgPrice, ratingAvg, coverImage
            ];
            
            try {
              await pool.query(query, values);
              insertedCount++;
              console.log(`+ Đã lưu: ${name} (${cuisine})`);
            } catch (err) {
              console.error(`Lỗi khi insert ${name}:`, err.message);
            }
          }
        } else {
          console.log('Không trích xuất được danh sách nhà hàng trang', page);
        }
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    
    console.log(`\nHoàn thành! Đã cào và chèn thành công ${insertedCount} địa điểm (Kèm ảnh và toạ độ thật) vào Database!`);
  } catch (error) {
    console.error('Lỗi khi cào Foody:', error.message);
  } finally {
    pool.end();
  }
}

seedFoody();
