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
}

export const ContactSchema = SchemaFactory.createForClass(Contact);
