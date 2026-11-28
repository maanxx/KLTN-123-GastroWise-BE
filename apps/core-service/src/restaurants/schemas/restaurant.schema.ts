// src/restaurants/schemas/restaurant.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { isValidGeoJsonPoint } from '@shared/utils/geo.utils';
import { formatRestaurantTagsString } from '@shared/utils/restaurant-normalizer.util';

export type RestaurantDocument = HydratedDocument<Restaurant>;

@Schema({ collection: 'restaurants', timestamps: true })
export class Restaurant {
  @Prop() tenQuan: string;
  @Prop({ index: true }) // Thêm index để tìm kiếm nhanh hơn
  cityId: string;
  @Prop() diemTrungBinh: number;
  @Prop() diaChi: string;
  @Prop() gioMoCua: string;
  @Prop() giaCa: string;
  @Prop({
    type: mongoose.Schema.Types.Mixed,
    default: '',
    set: (val: unknown) => formatRestaurantTagsString(val),
    get: (val: unknown) => formatRestaurantTagsString(val),
  })
  tags: string;

  @Prop({ min: -90, max: 90, required: false }) lat?: number;
  @Prop({ min: -180, max: 180, required: false }) lon?: number;

  // --- GeoJSON 2dsphere Location Support (M9.5: Null when un-geocoded; never defaults to Q1) ---
  @Prop({
    type: new mongoose.Schema(
      {
        type: {
          type: String,
          enum: ['Point'],
          required: true,
        },
        coordinates: {
          type: [Number], // [longitude, latitude]
          required: true,
        },
      },
      { _id: false },
    ),
    required: false,
    default: null,
    validate: {
      validator: (val: any) =>
        val === null || val === undefined || isValidGeoJsonPoint(val),
      message:
        'location must be null or a valid GeoJSON Point with [longitude, latitude] in valid WGS84 range and non-[0,0]',
    },
  })
  location?: {
    type: 'Point';
    coordinates: [number, number]; // [longitude, latitude]
  } | null;

  @Prop() diemKhongGian: number;
  @Prop() diemViTri: number;
  @Prop() diemChatLuong: number;
  @Prop() diemPhucVu: number;
  @Prop() diemGiaCa: number;
  @Prop() avatarUrl: string;
  @Prop() urlGoc: string;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User' })
  ownerId?: mongoose.Types.ObjectId;

  @Prop({ index: true })
  slug?: string;

  @Prop() description?: string;
  @Prop() contactPhone?: string;

  @Prop({ default: 0 })
  reviewsCount: number;

  @Prop({
    required: true,
    default: 'open',
    enum: ['open', 'closed', 'pending'],
  })
  status: string;

  // --- Nghiệp vụ Quản trị Nhà hàng (Admin & AI Badges) ---
  @Prop({ default: false })
  isVerified: boolean; // Quán ăn uy tín đã xác thực

  @Prop({ default: false })
  isFeatured: boolean; // Được AI Đề xuất ưu tiên (Featured)
}

export const RestaurantSchema = SchemaFactory.createForClass(Restaurant);

// Đăng ký 2dsphere Index để tìm kiếm địa không gian ($geoNear, $near, $geoWithin)
RestaurantSchema.index({ location: '2dsphere' });

// [TASK-PERF-01] Compound index for status filtering and rating sorting
RestaurantSchema.index({ status: 1, diemTrungBinh: -1 });

// [TASK-PERF-01] Text index for full-text search across restaurant name and tags
RestaurantSchema.index({ tenQuan: 'text', tags: 'text' });
