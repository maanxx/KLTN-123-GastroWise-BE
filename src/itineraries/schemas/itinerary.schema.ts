import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Restaurant } from '../../restaurants/schemas/restaurant.schema';
import { User } from '../../users/schemas/user.schema';

@Schema()
export class ItineraryStop {
  @Prop()
  stop_id: string;

  @Prop({ type: Types.ObjectId, ref: 'Restaurant' })
  restaurant_id: Restaurant | Types.ObjectId;

  @Prop()
  order_index: number;

  @Prop()
  restaurant_name: string;

  @Prop()
  restaurant_lat: number;

  @Prop()
  restaurant_lng: number;
}

@Schema({ timestamps: true })
export class Itinerary extends Document {
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  user_id: User | Types.ObjectId;

  @Prop()
  prompt: string;

  @Prop()
  title: string;

  @Prop()
  start_time: string;

  @Prop()
  end_time: string;

  @Prop()
  budget: number;

  @Prop({ type: { type: String, enum: ['Point'], default: 'Point' }, coordinates: { type: [Number] } })
  start_location: { type: string, coordinates: number[] };

  @Prop({ default: 'generated' })
  status: string;

  @Prop({ type: [ItineraryStop], default: [] })
  stops: ItineraryStop[];

  @Prop()
  shareToken: string;

  @Prop({ default: false })
  reminderEnabled: boolean;

  @Prop({ default: '30_MIN' })
  reminderTime: string;

  @Prop({ default: 1.5 })
  co2SavedKg: number;

  @Prop({ default: Date.now })
  created_at: Date;

  // ─── Audit Trail Fields ───────────────────────────────────────────────────
  /** Admin / user nào đã xác nhận lộ trình */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  confirmedBy: User | Types.ObjectId | null;

  /** Thời điểm xác nhận */
  @Prop({ type: Date, default: null })
  confirmedAt: Date | null;

  /** Admin / user nào đã hủy lộ trình */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  cancelledBy: User | Types.ObjectId | null;

  /** Thời điểm hủy */
  @Prop({ type: Date, default: null })
  cancelledAt: Date | null;

  /** Admin nào đánh dấu hoàn thành */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  completedBy: User | Types.ObjectId | null;

  /** Thời điểm hoàn thành */
  @Prop({ type: Date, default: null })
  completedAt: Date | null;
}

export const ItinerarySchema = SchemaFactory.createForClass(Itinerary);
