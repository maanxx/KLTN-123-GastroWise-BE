import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ContactDocument = Contact & Document;

export enum ContactTopic {
  FEEDBACK = 'FEEDBACK',
  MERCHANT = 'MERCHANT',
  COMPLAINT = 'COMPLAINT',
  OTHER = 'OTHER',
}

@Schema({ timestamps: true })
export class Contact {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  phone: string;

  @Prop({ required: true })
  email: string;

  @Prop({ required: true, enum: ContactTopic, default: ContactTopic.FEEDBACK })
  topic: string;

  @Prop({ required: true })
  message: string;

  @Prop({ default: 'Chờ phân tích' })
  aiClassification: string;

  @Prop({ default: 'CHỜ XỬ LÝ' })
  status: string;

  // ─── Audit Trail Fields ───────────────────────────────────────────────────
  /** Tên / email admin đã xử lý contact này */
  @Prop({ type: String, default: null })
  resolvedBy: string | null;

  /** Thời điểm bắt đầu xử lý (ĐANG XỬ LÝ) */
  @Prop({ type: Date, default: null })
  processingAt: Date | null;

  /** Thời điểm hoàn thành xử lý (ĐÃ GIẢI QUYẾT) */
  @Prop({ type: Date, default: null })
  resolvedAt: Date | null;
}

export const ContactSchema = SchemaFactory.createForClass(Contact);
