// src/taste-dna/taste-dna.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { TasteDnaProfile, TasteDnaDocument } from './schemas/taste-dna.schema';
import { UpdateTasteDnaDto } from './dto/update-taste-dna.dto';
import { TasteQuizDto } from './dto/taste-quiz.dto';

@Injectable()
export class TasteDnaService {
  private readonly logger = new Logger(TasteDnaService.name);

  constructor(
    @InjectModel(TasteDnaProfile.name)
    private readonly tasteDnaModel: Model<TasteDnaDocument>,
  ) {}

  /**
   * Lấy hồ sơ Taste DNA của người dùng. Nếu chưa có, tự động khởi tạo hồ sơ mặc định.
   */
  async getProfile(userId: string): Promise<TasteDnaDocument> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException(`User ID "${userId}" không hợp lệ.`);
    }

    let profile = await this.tasteDnaModel.findOne({ userId: new Types.ObjectId(userId) }).exec();

    if (!profile) {
      profile = new this.tasteDnaModel({
        userId: new Types.ObjectId(userId),
        spicy: 0.5,
        sweet: 0.5,
        sour: 0.5,
        salty: 0.5,
        umami: 0.5,
        bitter: 0.5,
        favoriteCuisines: ['Món Việt'],
        dietaryRestrictions: [],
        dislikedIngredients: [],
        budgetPreference: 'medium',
        confidenceScore: 0.3,
        interactionCount: 0,
      });
      await profile.save();
    }

    return profile;
  }

  /**
   * Cập nhật các giá trị khẩu vị thủ công từ thanh trượt radar chart trên mobile
   */
  async updateProfile(userId: string, dto: UpdateTasteDnaDto): Promise<TasteDnaDocument> {
    const profile = await this.getProfile(userId);

    if (dto.spicy !== undefined) profile.spicy = dto.spicy;
    if (dto.sweet !== undefined) profile.sweet = dto.sweet;
    if (dto.sour !== undefined) profile.sour = dto.sour;
    if (dto.salty !== undefined) profile.salty = dto.salty;
    if (dto.umami !== undefined) profile.umami = dto.umami;
    if (dto.bitter !== undefined) profile.bitter = dto.bitter;

    if (dto.favoriteCuisines !== undefined) profile.favoriteCuisines = dto.favoriteCuisines;
    if (dto.dietaryRestrictions !== undefined) profile.dietaryRestrictions = dto.dietaryRestrictions;
    if (dto.dislikedIngredients !== undefined) profile.dislikedIngredients = dto.dislikedIngredients;
    if (dto.budgetPreference !== undefined) profile.budgetPreference = dto.budgetPreference;

    // Tăng độ tin cậy khi người dùng chủ động tinh chỉnh
    profile.confidenceScore = Math.min(1.0, profile.confidenceScore + 0.1);

    return profile.save();
  }

  /**
   * Xử lý kết quả bảng khảo sát khẩu vị ban đầu (Onboarding Questionnaire)
   */
  async submitQuiz(userId: string, dto: TasteQuizDto): Promise<TasteDnaDocument> {
    const profile = await this.getProfile(userId);

    // Chuyển đổi mức độ cay sang thang điểm 0.0 - 1.0
    const spicyMap: Record<string, number> = {
      none: 0.1,
      mild: 0.35,
      medium: 0.65,
      hot: 0.85,
      extreme: 1.0,
    };
    profile.spicy = spicyMap[dto.spicyLevel] ?? 0.5;

    // Chuyển đổi mức độ hảo ngọt
    const sweetMap: Record<string, number> = {
      low: 0.25,
      moderate: 0.55,
      high: 0.85,
    };
    profile.sweet = sweetMap[dto.sweetTooth] ?? 0.5;

    // Chuyển đổi độ đậm đà / umami
    const umamiMap: Record<string, number> = {
      light: 0.3,
      balanced: 0.6,
      rich_umami: 0.9,
    };
    profile.umami = umamiMap[dto.savoryPreference] ?? 0.6;

    if (dto.cuisines && dto.cuisines.length > 0) {
      profile.favoriteCuisines = dto.cuisines;
    }
    if (dto.dietary) {
      profile.dietaryRestrictions = dto.dietary;
    }
    if (dto.budget) {
      profile.budgetPreference = dto.budget;
    }

    profile.confidenceScore = 0.55;
    return profile.save();
  }

  /**
   * Tự động điều chỉnh vector Taste DNA thông qua Exponential Moving Average (EMA)
   * sau mỗi lượt review hoặc hoàn thành lộ trình ẩm thực
   */
  async applyFeedbackEma(
    userId: string,
    targetTaste: { spicy?: number; sweet?: number; sour?: number; salty?: number; umami?: number; bitter?: number },
    weight: number = 0.15,
  ) {
    try {
      const profile = await this.getProfile(userId);
      const alpha = Math.max(0.05, Math.min(0.3, weight));

      if (targetTaste.spicy !== undefined) profile.spicy = (1 - alpha) * profile.spicy + alpha * targetTaste.spicy;
      if (targetTaste.sweet !== undefined) profile.sweet = (1 - alpha) * profile.sweet + alpha * targetTaste.sweet;
      if (targetTaste.sour !== undefined) profile.sour = (1 - alpha) * profile.sour + alpha * targetTaste.sour;
      if (targetTaste.salty !== undefined) profile.salty = (1 - alpha) * profile.salty + alpha * targetTaste.salty;
      if (targetTaste.umami !== undefined) profile.umami = (1 - alpha) * profile.umami + alpha * targetTaste.umami;
      if (targetTaste.bitter !== undefined) profile.bitter = (1 - alpha) * profile.bitter + alpha * targetTaste.bitter;

      profile.interactionCount += 1;
      profile.confidenceScore = Math.min(1.0, 0.4 + profile.interactionCount * 0.03);

      return profile.save();
    } catch (err: any) {
      this.logger.warn(`Không thể cập nhật EMA Taste DNA: ${err.message}`);
    }
  }
}

