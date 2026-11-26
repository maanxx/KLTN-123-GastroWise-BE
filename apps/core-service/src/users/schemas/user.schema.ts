import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import * as bcrypt from 'bcrypt'; // 1. Import bcrypt
import { normalizeEmail } from '@shared/utils/email.util';

export type UserDocument = HydratedDocument<User>;

@Schema({
  // 2. Thêm timestamps và toJSON/toObject
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: function (doc, ret: any) {
      // Xóa password, tokens và secrets khỏi kết quả JSON trả về
      delete ret.password;
      delete ret.hashedRefreshToken;
      delete ret.twoFactorSecret;
      delete ret.resetOtp;
      delete ret.resetOtpExpiresAt;
      delete ret._id; // (Tùy chọn, nếu bạn dùng virtual 'id')
      delete ret.__v;
      return ret;
    },
  },
  toObject: {
    virtuals: true,
    transform: function (doc, ret: any) {
      delete ret.password;
      delete ret.hashedRefreshToken;
      delete ret.twoFactorSecret;
      delete ret.resetOtp;
      delete ret.resetOtpExpiresAt;
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class User {
  @Prop({ required: true, unique: true, trim: true })
  username: string;

  @Prop({
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  }) // Email luôn được chuẩn hóa lowercase + trim trước khi lưu
  email: string;

  @Prop({ required: true })
  password: string;

  @Prop({ required: false }) // Không bắt buộc
  picture?: string;

  // 3. Thêm trường lưu refresh token đã băm
  @Prop({ required: false, type: String, default: null })
  hashedRefreshToken?: string | null;

  @Prop({ required: false })
  firstName: string;

  @Prop({ required: false })
  lastName: string;

  @Prop({ required: false })
  phone?: string;

  @Prop({ required: false })
  company?: string;

  @Prop({ required: false })
  designation?: string; // Chức vụ

  @Prop({ required: false })
  bio?: string; // Tiểu sử

  @Prop({ required: true, default: 'user', enum: ['user', 'admin', 'owner'] })
  role: string;

  @Prop({ type: [String], default: [] })
  preferences: string[];

  @Prop({
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant' }],
    default: [],
  })
  savedRestaurants: mongoose.Types.ObjectId[];

  @Prop({ required: true, default: 'active', enum: ['active', 'banned'] })
  status: string;

  @Prop({ required: false })
  twoFactorSecret?: string;

  @Prop({ default: false })
  isTwoFactorEnabled?: boolean;

  @Prop({ required: false, type: String, default: null })
  resetOtp?: string | null;

  @Prop({ required: false, type: Date, default: null })
  resetOtpExpiresAt?: Date | null;
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.pre<UserDocument>('save', async function (next) {
  if (this.email) {
    this.email = normalizeEmail(this.email);
  }
  if (typeof this.username === 'string') {
    this.username = this.username.trim();
  }

  // Chỉ băm mật khẩu nếu nó vừa được thay đổi (hoặc là user mới)
  if (!this.isModified('password')) {
    return next();
  }

  // Băm mật khẩu
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});
