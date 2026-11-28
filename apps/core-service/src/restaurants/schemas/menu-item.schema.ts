import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';

export type MenuItemDocument = HydratedDocument<MenuItem>;

@Schema({ collection: 'menu_items', timestamps: true })
export class MenuItem {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Restaurant',
    required: true,
  })
  restaurantId: mongoose.Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop()
  description: string;

  @Prop({ required: true, min: 0 })
  price: number;

  @Prop()
  image: string;

  @Prop({ default: false })
  isVegetarian: boolean;

  @Prop({ min: 0 })
  calories: number;

  @Prop({ type: [String], default: [] })
  tags: string[];

  // --- Nghiệp vụ Quản trị Tình trạng Món ăn & Món đặc trưng ---
  @Prop({ default: true })
  isAvailable: boolean; // Còn món (true) / Tạm hết món (false)

  @Prop({ default: false })
  isFeatured: boolean; // Món đặc trưng (Chef's Choice)

  // --- M10.7 Controlled Ingestion Provenance & Deduplication ---
  @Prop({ required: false })
  externalSource?: string;

  @Prop({ required: false })
  externalSourceId?: string;

  @Prop({ required: false })
  ingestionBatchId?: string;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  sourceMetadata?: Record<string, unknown>;
}

export const MenuItemSchema = SchemaFactory.createForClass(MenuItem);

// [M10.8] Justified compound index for restaurant dish filtering, availability, and price sorting
// (also serves single-field `restaurantId` lookups via index prefix without duplicate index).
MenuItemSchema.index({ restaurantId: 1, isAvailable: 1, price: 1 });
MenuItemSchema.index({ tags: 1 });
MenuItemSchema.index({ isFeatured: -1, createdAt: -1 });
MenuItemSchema.index(
  { externalSource: 1, externalSourceId: 1 },
  {
    name: 'uniq_dish_external_source_id_partial',
    unique: true,
    partialFilterExpression: {
      externalSource: { $type: 'string' },
      externalSourceId: { $type: 'string' },
    },
  },
);
MenuItemSchema.index({ ingestionBatchId: 1 }, { sparse: true });
