// src/interactions/schemas/interaction.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';

export type InteractionDocument = HydratedDocument<Interaction>;

export enum InteractionEventType {
  VIEW = 'view',
  CLICK = 'click',
  SEARCH = 'search',
  FAVORITE = 'favorite',
  UNFAVORITE = 'unfavorite',
  ITINERARY_ADD = 'itinerary_add',
  ITINERARY_COMPLETE = 'itinerary_complete',
  REVIEW_SUBMIT = 'review_submit',
  SHARE = 'share',
}

export enum TargetType {
  RESTAURANT = 'restaurant',
  MENU_ITEM = 'menu_item',
  ITINERARY = 'itinerary',
  SEARCH_QUERY = 'search_query',
  CUISINE = 'cuisine',
}

@Schema({ collection: 'user_interactions', timestamps: true })
export class Interaction {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true })
  userId?: mongoose.Types.ObjectId;

  @Prop({ index: true })
  sessionId?: string;

  @Prop({ required: true, enum: Object.values(InteractionEventType), index: true })
  eventType: string;

  @Prop({ required: true, enum: Object.values(TargetType) })
  targetType: string;

  @Prop({ required: true, index: true })
  targetId: string;

  @Prop({ default: 0 })
  durationMs: number;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;
}

export const InteractionSchema = SchemaFactory.createForClass(Interaction);

// Compound indexes for analytics and collaborative filtering extraction
InteractionSchema.index({ userId: 1, createdAt: -1 });
InteractionSchema.index({ targetId: 1, eventType: 1 });
InteractionSchema.index({ createdAt: -1 });

