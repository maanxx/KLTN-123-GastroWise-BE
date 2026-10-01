import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from './user.schema';

@Schema({ timestamps: true })
export class AuditLog extends Document {
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  adminId: User | Types.ObjectId;

  @Prop({ required: true })
  action: string; // ROLE_CHANGE, USER_LOCK, REVIEW_MODERATE, RESTAURANT_UPDATE

  @Prop()
  targetResource: string; // Name of modified resource

  @Prop({ type: Object })
  details: Record<string, any>;

  @Prop({ default: Date.now })
  createdAt: Date;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
