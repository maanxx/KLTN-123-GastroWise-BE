// src/restaurants/schemas/restaurant.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';

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
  @Prop() tags: string; 

  @Prop() lat: number;
  @Prop() lon: number;
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

  @Prop({ required: true, default: 'open', enum: ['open', 'closed', 'pending'] })
  status: string;

  // --- Nghiệp vụ Quản trị Nhà hàng (Admin & AI Badges) ---
  @Prop({ default: false })
  isVerified: boolean; // Quán ăn uy tín đã xác thực

  @Prop({ default: false })
  isFeatured: boolean; // Được AI Đề xuất ưu tiên (Featured)
}

export const RestaurantSchema = SchemaFactory.createForClass(Restaurant);
