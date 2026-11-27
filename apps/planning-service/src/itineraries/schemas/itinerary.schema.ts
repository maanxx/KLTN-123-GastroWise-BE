import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema()
export class ItineraryStop {
  @Prop()
  stop_id: string;

  // Snapshot Value Object Pattern: Store opaque string ID, not Mongoose cross-DB ref
  @Prop({ required: true, type: String })
  restaurant_id: string;

  @Prop()
  order_index: number;

  @Prop()
  restaurant_name: string;

  @Prop()
  restaurant_lat: number;

  @Prop()
  restaurant_lng: number;

  @Prop()
  restaurant_address?: string;

  @Prop()
  restaurant_rating?: number;

  @Prop()
  restaurant_image?: string;

  // --- Smart Route Optimization & TSPTW Attributes ---
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
  // Store user ID as scalar string
  @Prop({ required: true, type: String, index: true })
  user_id: string;

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

  @Prop({
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number] },
  })
  start_location: { type: string; coordinates: number[] };

  @Prop({
    default: 'generated',
    enum: ['generated', 'confirmed', 'completed', 'cancelled'],
  })
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

  // --- Metrics Tối ưu Lộ trình ---
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

  // ─── Audit Trail Fields (Decoupled String IDs) ──────────────────────────
  @Prop({ type: String, default: null })
  confirmedBy?: string | null;

  @Prop({ type: Date, default: null })
  confirmedAt?: Date | null;

  @Prop({ type: String, default: null })
  cancelledBy?: string | null;

  @Prop({ type: Date, default: null })
  cancelledAt?: Date | null;

  @Prop({ type: String, default: null })
  completedBy?: string | null;

  @Prop({ type: Date, default: null })
  completedAt?: Date | null;
}

export const ItinerarySchema = SchemaFactory.createForClass(Itinerary);

ItinerarySchema.index({ user_id: 1, created_at: -1 });
ItinerarySchema.index({ user_id: 1, createdAt: -1 });
