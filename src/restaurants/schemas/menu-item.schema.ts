import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';

export type MenuItemDocument = HydratedDocument<MenuItem>;

@Schema({ collection: 'menu_items', timestamps: true })
export class MenuItem {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true })
  restaurantId: mongoose.Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop()
  description: string;

  @Prop({ required: true })
  price: number;

  @Prop()
  image: string;

  @Prop({ default: false })
  isVegetarian: boolean;

  @Prop()
  calories: number;

  @Prop({ type: [String], default: [] })
  tags: string[];
}

export const MenuItemSchema = SchemaFactory.createForClass(MenuItem);
