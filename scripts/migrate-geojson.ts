/**
 * GastroWise - GeoJSON 2dsphere Migration Script
 * [TASK-P0-01] Normalizes lat/lon into location: { type: 'Point', coordinates: [lon, lat] }
 * and verifies/creates the 2dsphere spatial index on restaurants collection.
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/gastrowise';

async function runMigration() {
  console.log('------------------------------------------------------------');
  console.log('🚀 GASTROWISE MIGRATION: GeoJSON Point & 2dsphere Indexing');
  console.log('🔗 MongoDB URI:', MONGODB_URI.replace(/:([^:@]{3,})@/, ':***@'));
  console.log('------------------------------------------------------------');

  await mongoose.connect(MONGODB_URI);
  console.log('✅ Kết nối MongoDB thành công.');

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Không thể kết nối đến cơ sở dữ liệu MongoDB');
  }

  const collection = db.collection('restaurants');

  // 1. Kiểm tra tổng số nhà hàng
  const total = await collection.countDocuments();
  console.log(`📊 Tổng số nhà hàng trong catalog: ${total}`);

  // 2. Tìm các nhà hàng chưa có GeoJSON Point hợp lệ
  const pendingDocs = await collection.find({
    $or: [
      { 'location.coordinates': { $exists: false } },
      { 'location.coordinates': { $size: 0 } },
      { location: null },
    ],
    lat: { $exists: true, $ne: null },
    lon: { $exists: true, $ne: null },
  }).toArray();

  console.log(`🔎 Số nhà hàng cần chuẩn hóa tọa độ GeoJSON: ${pendingDocs.length}`);

  let updatedCount = 0;
  for (const doc of pendingDocs) {
    const lat = typeof doc.lat === 'string' ? parseFloat((doc.lat as string).replace(',', '.')) : Number(doc.lat);
    const lon = typeof doc.lon === 'string' ? parseFloat((doc.lon as string).replace(',', '.')) : Number(doc.lon);

    if (!isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0) {
      await collection.updateOne(
        { _id: doc._id },
        {
          $set: {
            location: {
              type: 'Point',
              coordinates: [lon, lat], // [longitude, latitude] chuẩn MongoDB
            },
          },
        },
      );
      updatedCount++;
    }
  }

  console.log(`✅ Đã chuyển đổi tọa độ GeoJSON thành công cho ${updatedCount} nhà hàng.`);

  // 3. Tạo index 2dsphere trên trường location
  console.log('⚙️ Đang kiểm tra và tạo 2dsphere index trên field `location`...');
  try {
    await collection.createIndex({ location: '2dsphere' }, { name: 'location_2dsphere', background: true });
    console.log('✅ Index `location_2dsphere` đã được tạo thành công.');
  } catch (idxErr: any) {
    console.warn('⚠️ Thông báo index:', idxErr.message);
  }

  // 4. Liệt kê các index hiện tại
  const indexes = await collection.indexes();
  console.log('📌 Danh sách indexes trên collection `restaurants`:');
  indexes.forEach((idx) => {
    console.log(`   - ${idx.name}: ${JSON.stringify(idx.key)}`);
  });

  await mongoose.disconnect();
  console.log('🎉 Quá trình chuẩn hóa hoàn tất.');
}

runMigration().catch((err) => {
  console.error('❌ Lỗi migration:', err);
  process.exit(1);
});

