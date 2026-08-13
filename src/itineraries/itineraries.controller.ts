import { Controller, Post, Body, UseGuards, Get, Param, Request } from '@nestjs/common';
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

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async getItineraryById(@Request() req, @Param('id') id: string) {
    const userId = req.user.userId;
    return this.itinerariesService.getItineraryById(id, userId);
  }
}
