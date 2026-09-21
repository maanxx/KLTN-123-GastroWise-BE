import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';
import { Restaurant } from '../../restaurants/schemas/restaurant.schema';

@Schema({ timestamps: true })
export class FavoriteCollection extends Document {
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId: User | Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop()
  description: string;

  @Prop({ default: false })
  isPublic: boolean;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Restaurant' }], default: [] })
  restaurantIds: (Restaurant | Types.ObjectId)[];
}

export const FavoriteCollectionSchema = SchemaFactory.createForClass(FavoriteCollection);
