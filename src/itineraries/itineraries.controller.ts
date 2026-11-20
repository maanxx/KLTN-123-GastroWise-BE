import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  Param,
  Request,
  Patch,
  Delete,
} from '@nestjs/common';
import { ItinerariesService } from './itineraries.service';
import { GenerateItineraryDto } from './dto/generate-itinerary.dto';
import { ReorderStopsDto } from './dto/reorder-stops.dto';
import { AddStopDto } from './dto/add-stop.dto';
import { RecalculateItineraryDto } from './dto/recalculate-itinerary.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('itineraries')
export class ItinerariesController {
  constructor(private readonly itinerariesService: ItinerariesService) {}

  @UseGuards(JwtAuthGuard)
  @Post('generate')
  async generateItinerary(
    @Request() req,
    @Body() generateItineraryDto: GenerateItineraryDto,
  ) {
    const userId = req.user.userId || req.user.sub;
    return this.itinerariesService.generateItinerary(
      userId,
      generateItineraryDto,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  async getItineraries(@Request() req) {
    const userId = req.user.userId || req.user.sub;
    return this.itinerariesService.getItinerariesByUser(userId);
  }

  /**
   * [TASK-SEC-02] Admin: Lấy tất cả lộ trình của toàn hệ thống (Bảo vệ bằng RolesGuard)
   * GET /itineraries/all
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get('all')
  async getAllItineraries() {
    return this.itinerariesService.getAllItineraries();
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async getItineraryById(@Request() req, @Param('id') id: string) {
    const userId = req.user.userId || req.user.sub;
    return this.itinerariesService.getItineraryById(id, userId);
  }

  /**
   * [TASK-BIZ-02-06] Thay đổi thứ tự các chặng dừng trong lộ trình
   * PATCH /itineraries/:id/reorder
   */
  @UseGuards(JwtAuthGuard)
  @Patch(':id/reorder')
  async reorderStops(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: ReorderStopsDto,
  ) {
    const actorId = req.user.userId || req.user.sub;
    const actorRole = req.user.role || 'user';
    return this.itinerariesService.reorderStops(
      id,
      dto.stop_ids,
      actorId,
      actorRole,
    );
  }

  /**
   * [TASK-BIZ-02-06] Thêm một nhà hàng mới vào lộ trình và tính lại lộ trình
   * POST /itineraries/:id/stops
   */
  @UseGuards(JwtAuthGuard)
  @Post(':id/stops')
  async addStop(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: AddStopDto,
  ) {
    const actorId = req.user.userId || req.user.sub;
    const actorRole = req.user.role || 'user';
    return this.itinerariesService.addStop(id, dto, actorId, actorRole);
  }

  /**
   * [TASK-BIZ-02-06] Xóa một điểm dừng và tính lại lộ trình
   * DELETE /itineraries/:id/stops/:stopId
   */
  @UseGuards(JwtAuthGuard)
  @Delete(':id/stops/:stopId')
  async removeStop(
    @Request() req,
    @Param('id') id: string,
    @Param('stopId') stopId: string,
  ) {
    const actorId = req.user.userId || req.user.sub;
    const actorRole = req.user.role || 'user';
    return this.itinerariesService.removeStop(id, stopId, actorId, actorRole);
  }

  /**
   * [TASK-BIZ-02-06] Tối ưu hóa / tính toán lại lộ trình khi thay đổi ngân sách, giờ khởi hành, phương tiện
   * POST /itineraries/:id/recalculate
   */
  @UseGuards(JwtAuthGuard)
  @Post(':id/recalculate')
  async recalculateItinerary(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: RecalculateItineraryDto,
  ) {
    const actorId = req.user.userId || req.user.sub;
    const actorRole = req.user.role || 'user';
    return this.itinerariesService.recalculateItinerary(
      id,
      dto,
      actorId,
      actorRole,
    );
  }

  /**
   * [TASK-SEC-02] Admin / User: cập nhật status + kiểm tra quyền sở hữu (ownership)
   * PATCH /itineraries/:id
   * Body: { status: 'confirmed' | 'cancelled' | 'completed' }
   */
  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async updateStatus(
    @Request() req,
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    const actorId = req.user.userId || req.user.sub;
    const actorRole = req.user.role || 'user';
    return this.itinerariesService.updateStatus(
      id,
      body.status,
      actorId,
      actorRole,
    );
  }

  /**
   * [TASK-SEC-02] Admin / User: xóa lộ trình + kiểm tra quyền sở hữu (ownership)
   * DELETE /itineraries/:id
   */
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async remove(@Request() req, @Param('id') id: string) {
    const actorId = req.user.userId || req.user.sub;
    const actorRole = req.user.role || 'user';
    return this.itinerariesService.remove(id, actorId, actorRole);
  }
}
