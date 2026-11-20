// src/taste-dna/taste-dna.controller.ts
import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  UseGuards,
  Request,
  Param,
} from '@nestjs/common';
import { TasteDnaService } from './taste-dna.service';
import { UpdateTasteDnaDto } from './dto/update-taste-dna.dto';
import { TasteQuizDto } from './dto/taste-quiz.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('taste-dna')
export class TasteDnaController {
  constructor(private readonly tasteDnaService: TasteDnaService) {}

  /**
   * [Phase 2 - TASK-P1-01] Lấy hồ sơ Taste DNA 6-D của người dùng hiện tại
   * GET /taste-dna/me
   */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMyProfile(@Request() req: any) {
    const userId = req.user.sub || req.user._id || req.user.id;
    return this.tasteDnaService.getProfile(userId);
  }

  /**
   * [Phase 2 - TASK-P1-01] Cập nhật các thông số Taste DNA (kéo slider radar chart)
   * PATCH /taste-dna/me
   */
  @UseGuards(JwtAuthGuard)
  @Patch('me')
  async updateMyProfile(@Request() req: any, @Body() dto: UpdateTasteDnaDto) {
    const userId = req.user.sub || req.user._id || req.user.id;
    return this.tasteDnaService.updateProfile(userId, dto);
  }

  /**
   * [Phase 2 - TASK-P1-01] Gửi kết quả khảo sát khẩu vị ban đầu (Onboarding Questionnaire)
   * POST /taste-dna/quiz
   */
  @UseGuards(JwtAuthGuard)
  @Post('quiz')
  async submitQuiz(@Request() req: any, @Body() dto: TasteQuizDto) {
    const userId = req.user.sub || req.user._id || req.user.id;
    return this.tasteDnaService.submitQuiz(userId, dto);
  }

  /**
   * Lấy vector Taste DNA thuần số học cho AI Microservice tính Cosine Similarity
   * GET /taste-dna/vector/:userId
   */
  @Get('vector/:userId')
  async getUserTasteVector(@Param('userId') userId: string) {
    const profile = await this.tasteDnaService.getProfile(userId);
    return {
      userId: profile.userId,
      vector: [
        profile.spicy,
        profile.sweet,
        profile.sour,
        profile.salty,
        profile.umami,
        profile.bitter,
      ],
      favoriteCuisines: profile.favoriteCuisines,
      dietaryRestrictions: profile.dietaryRestrictions,
      budgetPreference: profile.budgetPreference,
      confidenceScore: profile.confidenceScore,
    };
  }
}
