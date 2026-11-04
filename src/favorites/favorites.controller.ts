import { Controller, Get, Post, Body, UseGuards, Request, Query } from '@nestjs/common';
import { FavoritesService } from './favorites.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('favorites')
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  /**
   * Admin / Public: Top quán ăn được lưu yêu thích nhiều nhất
   * GET /favorites/top
   */
  @Get('top')
  async getTopFavorites(@Query('limit') limit?: string) {
    const lim = limit ? parseInt(limit, 10) : 5;
    return this.favoritesService.getTopFavoritedRestaurants(lim);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  async getUserFavorites(@Request() req) {
    const userId = req.user.sub || req.user._id || req.user.id;
    return this.favoritesService.getUserFavorites(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('toggle')
  async toggleFavorite(
    @Request() req,
    @Body('restaurant_id') restaurantId: string,
  ) {
    const userId = req.user.sub || req.user._id || req.user.id;
    return this.favoritesService.toggleFavorite(userId, restaurantId);
  }
}
