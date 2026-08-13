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
  created_at: Date;
}

export const ItinerarySchema = SchemaFactory.createForClass(Itinerary);
