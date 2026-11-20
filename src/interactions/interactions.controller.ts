// src/interactions/interactions.controller.ts
import {
  Controller,
  Post,
  Get,
  Body,
  Request,
  UseGuards,
  Query,
} from '@nestjs/common';
import { InteractionsService } from './interactions.service';
import { CreateInteractionDto } from './dto/create-interaction.dto';
import { BatchInteractionDto } from './dto/batch-interaction.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('interactions')
export class InteractionsController {
  constructor(private readonly interactionsService: InteractionsService) {}

  /**
   * [Phase 2 - TASK-P0-02] Ghi nhận một tương tác hành vi (View, Click, Favorite, Dwell Time)
   * POST /interactions
   */
  @Post()
  async recordEvent(@Request() req: any, @Body() dto: CreateInteractionDto) {
    const userId = req.user?.sub || req.user?._id || req.user?.id;
    return this.interactionsService.recordEvent(userId, dto);
  }

  /**
   * [Phase 2 - TASK-P0-02] Ghi nhận hàng loạt tương tác (Batch flush từ Mobile analytics)
   * POST /interactions/batch
   */
  @Post('batch')
  async recordBatch(@Request() req: any, @Body() dto: BatchInteractionDto) {
    const userId = req.user?.sub || req.user?._id || req.user?.id;
    return this.interactionsService.recordBatch(userId, dto);
  }

  /**
   * Xem lịch sử tương tác của người dùng hiện tại
   * GET /interactions/me
   */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMyInteractions(@Request() req: any, @Query('limit') limit?: number) {
    const userId = req.user.sub || req.user._id || req.user.id;
    return this.interactionsService.getUserInteractions(userId, limit);
  }

  /**
   * Thống kê các mục được tương tác nhiều nhất
   * GET /interactions/popular?targetType=restaurant&limit=10
   */
  @Get('popular')
  async getPopular(
    @Query('targetType') targetType?: string,
    @Query('limit') limit?: number,
  ) {
    return this.interactionsService.getPopularTargets(targetType, limit);
  }

  /**
   * Export dữ liệu ma trận tương tác cho AI Microservice huấn luyện Collaborative Filtering
   * GET /interactions/matrix?limit=5000
   */
  @Get('matrix')
  async getMatrixExport(@Query('limit') limit?: number) {
    return this.interactionsService.getMatrixExport(
      limit ? Number(limit) : 5000,
    );
  }
}
