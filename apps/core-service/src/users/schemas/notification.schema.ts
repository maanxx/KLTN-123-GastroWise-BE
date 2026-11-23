import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from './user.schema';

@Schema({ timestamps: true })
export class Notification extends Document {
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId: User | Types.ObjectId;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  message: string;

  @Prop({ default: 'SYSTEM' })
  type: string; // ITINERARY_REMINDER, WEATHER_RECOMMENDATION, SYSTEM

  // ADR-09: Decoupled scalar string reference instead of cross-DB Mongoose ref
  @Prop({ type: String, required: false })
  itineraryId?: string;

  @Prop({ default: false })
  isRead: boolean;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
