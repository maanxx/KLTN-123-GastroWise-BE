import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';

export type UserInteractionDocument = HydratedDocument<UserInteraction>;

@Schema({ collection: 'user_interactions', timestamps: true })
export class UserInteraction {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  userId: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant' })
  restaurantId: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem' })
  menuItemId: mongoose.Types.ObjectId;

  @Prop({ required: true, enum: ['view', 'search', 'like', 'share', 'bookmark'] })
  actionType: string;

  @Prop()
  searchQuery: string;

  @Prop()
  metadata: string; // Có thể lưu JSON string nếu cần thêm dữ liệu phụ
}

export const UserInteractionSchema = SchemaFactory.createForClass(UserInteraction);
