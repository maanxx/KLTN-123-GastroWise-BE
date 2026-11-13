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

  // --- [Phase 2 - TASK-P3-01] Smart Route Optimization & TSPTW Attributes ---
  @Prop({ default: 'main', enum: ['starter', 'main', 'dessert', 'cafe'] })
  meal_type?: string;

  @Prop()
  arrival_time?: string; // Ví dụ: "11:30"

  @Prop()
  departure_time?: string; // Ví dụ: "12:30"

  @Prop({ default: 45 })
  dining_duration_mins?: number;

  @Prop({ default: 15 })
  transit_time_mins?: number;

  @Prop({ default: 1.5 })
  distance_to_next_km?: number;

  @Prop({ default: 50000 })
  estimated_cost?: number;

  @Prop()
  tags?: string;
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

  // --- [Phase 2 - TASK-P3-01 & TASK-BIZ-02] Metrics Tối ưu Lộ trình ---
  @Prop({ default: 5.2 })
  total_distance_km?: number;

  @Prop({ default: 150 })
  total_duration_mins?: number;

  @Prop({ default: 150000 })
  total_cost?: number;

  @Prop({ default: 100000 })
  remaining_budget?: number;

  @Prop({ default: 3 })
  desired_stops?: number;

  @Prop({ default: 'motorbike', enum: ['motorbike', 'car', 'walking'] })
  routing_mode?: string;

  @Prop({ default: 'OR-Tools TSPTW' })
  optimizedBy?: string;

  @Prop({ default: Date.now })
  created_at: Date;

  // ─── Audit Trail Fields ───────────────────────────────────────────────────
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  confirmedBy: User | Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  confirmedAt: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  cancelledBy: User | Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  cancelledAt: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  completedBy: User | Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  completedAt: Date | null;
}

export const ItinerarySchema = SchemaFactory.createForClass(Itinerary);

// [TASK-PERF-01] Compound indexes for efficient user itinerary retrieval
ItinerarySchema.index({ user_id: 1, created_at: -1 });
ItinerarySchema.index({ user_id: 1, createdAt: -1 });
