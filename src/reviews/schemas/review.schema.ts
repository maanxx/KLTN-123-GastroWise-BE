import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';

export type ReviewDocument = HydratedDocument<Review>;

@Schema({ collection: 'reviews', timestamps: true }) 
export class Review {
  @Prop()
  tenQuan: string;

  // Đây là trường quan trọng để liên kết với Nhà hàng
  @Prop({ index: true }) 
  urlGoc: string;

  @Prop()
  diemReview: number;

  @Prop()
  noiDung: string;

  @Prop()
  aiSentimentLabel: string; // Ví dụ: 'LABEL_2' (Tích cực)

  @Prop()
  aiSentimentScore: number;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  userId: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true })
  restaurantId: mongoose.Types.ObjectId;

  @Prop({ type: [String], default: [] })
  images: string[];

  @Prop({ default: 0 })
  likes: number;
}

export const ReviewSchema = SchemaFactory.createForClass(Review);