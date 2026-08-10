require('dotenv').config();
const pool = require('./src/config/db');

const areas = [
  'Quận 1',
  'Quận 3',
  'Quận 5',
  'Quận 10',
  'Quận Bình Thạnh',
  'Quận Phú Nhuận',
  'Quận Tân Bình'
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchFromOverpass(areaName) {
  const query = `
    [out:json][timeout:25];
    area["name"="Thành phố Hồ Chí Minh"]->.city;
    area["name"="${areaName}"](area.city)->.searchArea;
    (
      nwr["amenity"~"restaurant|cafe|fast_food"](area.searchArea);
    );
    out center;
  `;

  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'GastroWise-KLTN-App/1.0'
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Overpass API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  return data.elements || [];
}

async function seed() {
  console.log('Bắt đầu quá trình seed dữ liệu từ OpenStreetMap...');
  let totalInserted = 0;

  for (const area of areas) {
    console.log(`\nĐang lấy dữ liệu cho khu vực: ${area}...`);
    try {
      const elements = await fetchFromOverpass(area);
      console.log(`Tìm thấy ${elements.length} địa điểm tại ${area}.`);

      let insertedInArea = 0;

      for (const el of elements) {
        const tags = el.tags || {};
        const name = tags.name;
        
        // Bỏ qua nếu không có tên
        if (!name) continue;

        const osm_id = el.id;
        // Lấy tọa độ từ node (lat/lon) hoặc center cho way/relation
        const lat = el.lat || el.center?.lat;
        const lon = el.lon || el.center?.lon;

        if (!lat || !lon) continue;

        const housenumber = tags['addr:housenumber'] || '';
        const street = tags['addr:street'] || '';
        const address = [housenumber, street].filter(Boolean).join(' ') || null;
        
        const cuisine = tags.cuisine || null;
        const opening_hours = tags.opening_hours || null;
        const phone = tags.phone || tags['contact:phone'] || null;
        const website = tags.website || tags['contact:website'] || null;

        const insertQuery = `
          INSERT INTO restaurants (name, address, location, osm_id, cuisine, opening_hours, phone, website)
          VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6, $7, $8, $9)
          ON CONFLICT (osm_id) DO NOTHING
        `;

        // PostGIS ST_MakePoint nhận tham số theo thứ tự: longitude, latitude
        const values = [
          name, address, lon, lat, osm_id, cuisine, opening_hours, phone, website
        ];

        const res = await pool.query(insertQuery, values);
        if (res.rowCount > 0) {
          insertedInArea++;
          totalInserted++;
        }
      }

      console.log(`Đã insert ${insertedInArea} địa điểm mới cho ${area}.`);

    } catch (error) {
      console.error(`Lỗi khi xử lý khu vực ${area}:`, error.message);
    }

    // Delay 2 giây để tránh rate limit
    console.log('Đợi 2 giây trước khi tiếp tục...');
    await sleep(2000);
  }

  console.log(`\nHoàn tất! Tổng cộng đã insert ${totalInserted} nhà hàng mới vào database.`);
  process.exit(0);
}

seed();
