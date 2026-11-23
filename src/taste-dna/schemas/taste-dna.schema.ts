// src/taste-dna/schemas/taste-dna.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';

export type TasteDnaDocument = HydratedDocument<TasteDnaProfile>;

@Schema({ collection: 'taste_dna_profiles', timestamps: true })
export class TasteDnaProfile {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true,
  })
  userId: mongoose.Types.ObjectId;

  // --- Normalized 6-D Taste Vector [0.0 - 1.0] ---
  @Prop({ default: 0.5, min: 0.0, max: 1.0 })
  spicy: number;

  @Prop({ default: 0.5, min: 0.0, max: 1.0 })
  sweet: number;

  @Prop({ default: 0.5, min: 0.0, max: 1.0 })
  sour: number;

  @Prop({ default: 0.5, min: 0.0, max: 1.0 })
  salty: number;

  @Prop({ default: 0.5, min: 0.0, max: 1.0 })
  umami: number;

  @Prop({ default: 0.5, min: 0.0, max: 1.0 })
  bitter: number;

  // --- Qualitative Dietary & Culinary Preferences ---
  @Prop({ type: [String], default: [] })
  favoriteCuisines: string[];

  @Prop({ type: [String], default: [] })
  dietaryRestrictions: string[];

  @Prop({ type: [String], default: [] })
  dislikedIngredients: string[];

  @Prop({ default: 'medium', enum: ['budget', 'medium', 'fine_dining'] })
  budgetPreference: string;

  // --- Profile Maturity & Meta ---
  @Prop({ default: 0.3, min: 0.0, max: 1.0 })
  confidenceScore: number;

  @Prop({ default: 0 })
  interactionCount: number;
}

export const TasteDnaSchema = SchemaFactory.createForClass(TasteDnaProfile);
