import { Controller, Get, Post, Body, UseGuards, Request } from '@nestjs/common';
import { FavoritesService } from './favorites.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('favorites')
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

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
