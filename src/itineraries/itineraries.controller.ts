import { Controller, Post, Body, UseGuards, Get, Param, Request, Patch, Delete } from '@nestjs/common';
import { ItinerariesService } from './itineraries.service';
import { GenerateItineraryDto } from './dto/generate-itinerary.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('itineraries')
export class ItinerariesController {
  constructor(private readonly itinerariesService: ItinerariesService) {}

  @UseGuards(JwtAuthGuard)
  @Post('generate')
  async generateItinerary(@Request() req, @Body() generateItineraryDto: GenerateItineraryDto) {
    const userId = req.user.userId;
    return this.itinerariesService.generateItinerary(userId, generateItineraryDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  async getItineraries(@Request() req) {
    const userId = req.user.userId;
    return this.itinerariesService.getItinerariesByUser(userId);
  }

  /**
   * Admin: Lấy tất cả lộ trình của toàn hệ thống
   * GET /itineraries/all
   */
  @Get('all')
  async getAllItineraries() {
    return this.itinerariesService.getAllItineraries();
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async getItineraryById(@Request() req, @Param('id') id: string) {
    const userId = req.user.userId;
    return this.itinerariesService.getItineraryById(id, userId);
  }

  /**
   * Admin: cập nhật status + ghi audit trail tự động
   * PATCH /itineraries/:id
   * Body: { status: 'confirmed' | 'cancelled' | 'completed', actorId?: string }
   */
  @Patch(':id')
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string; actorId?: string },
  ) {
    return this.itinerariesService.updateStatus(id, body.status, body.actorId);
  }

  /**
   * Admin: xóa lộ trình
   * DELETE /itineraries/:id
   */
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.itinerariesService.remove(id);
  }
}
