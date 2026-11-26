// src/restaurants/restaurants.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Req,
  UseInterceptors,
  UploadedFile,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RestaurantsService } from './restaurants.service';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { ChatRestaurantDto } from './dto/chat-restaurant.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('restaurants')
export class RestaurantsController {
  constructor(private readonly restaurantsService: RestaurantsService) {}

  /**
   * [TASK-SEC-02] Thêm quán mới (Yêu cầu quyền Admin hoặc Owner)
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'owner')
  @Post()
  create(@Body() createRestaurantDto: CreateRestaurantDto) {
    return this.restaurantsService.create(createRestaurantDto);
  }

  // API Tìm kiếm bằng hình ảnh (Công khai cho người dùng khám phá)
  @Post('search-by-image')
  @UseInterceptors(FileInterceptor('file'))
  async searchByImage(@UploadedFile() file: Express.Multer.File) {
    return this.restaurantsService.searchByImage(file);
  }

  /**
   * [Phase 2 - TASK-P0-01] GeoJSON 2dsphere Nearby Search
   * GET /restaurants/nearby?lat=10.7769&lon=106.7009&radiusKm=5&limit=20
   */
  @Get('nearby')
  findNearby(
    @Query('lat') lat: number,
    @Query('lon') lon: number,
    @Query('lng') lng: number,
    @Query('radiusKm') radiusKm: number,
    @Query('limit') limit: number,
    @Query('tags') tags?: string,
    @Query('search') search?: string,
  ) {
    const effectiveLon = lon !== undefined && lon !== null ? lon : lng;
    return this.restaurantsService.findNearby(
      Number(lat) || 10.7769,
      Number(effectiveLon) || 106.7009,
      Number(radiusKm) || 5,
      Number(limit) || 20,
      tags,
      search,
    );
  }

  @Get()
  findAll(
    @Query('page') page: number,
    @Query('limit') limit: number,
    @Query('sortBy') sortBy: string,
    @Query('order') order: string,
    @Query('rating') rating: string,
    @Query('openNow') openNow: string,
    @Query('userLat') userLat: string,
    @Query('userLon') userLon: string,
    @Query('search') search: string,
    @Query('city') city: string,
    @Query('tags') tags: string,
  ) {
    return this.restaurantsService.findAll(
      page,
      limit,
      sortBy,
      order,
      rating,
      openNow,
      userLat,
      userLon,
      search,
      city,
      tags,
    );
  }

  @Get('menu/all')
  getAllMenuItems(
    @Query('search') search?: string,
    @Query('restaurantId') restaurantId?: string,
  ) {
    return this.restaurantsService.getAllMenuItems(search, restaurantId);
  }

  @Get(':id/menu')
  getMenu(@Param('id') id: string) {
    return this.restaurantsService.getMenu(id);
  }

  /**
   * [TASK-SEC-02] Thêm món ăn vào thực đơn quán (Admin hoặc Owner)
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'owner')
  @Post(':id/menu')
  createMenuItem(@Param('id') id: string, @Body() dto: CreateMenuItemDto) {
    return this.restaurantsService.createMenuItem(id, dto);
  }

  /**
   * [TASK-SEC-02] Sửa món ăn trong thực đơn (Admin hoặc Owner)
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'owner')
  @Patch('menu/:menuId')
  updateMenuItem(
    @Param('menuId') menuId: string,
    @Body() dto: UpdateMenuItemDto,
  ) {
    return this.restaurantsService.updateMenuItem(menuId, dto);
  }

  /**
   * [TASK-SEC-02] Xóa món ăn khỏi thực đơn (Admin hoặc Owner)
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'owner')
  @Delete('menu/:menuId')
  deleteMenuItem(@Param('menuId') menuId: string) {
    return this.restaurantsService.deleteMenuItem(menuId);
  }

  @Get('weather-recommend')
  getWeatherRecommendation(
    @Query('lat') lat?: string,
    @Query('lon') lon?: string,
  ) {
    return this.restaurantsService.getWeatherRecommendation(lat, lon);
  }

  /**
   * [TASK-P2-01 & TASK-P2-02] Gợi ý nhà hàng thông minh đa tầng kết hợp Taste DNA,
   * Collaborative Filtering, Thời tiết & Khoảng cách GPS.
   * GET /restaurants/recommended?lat=10.7769&lon=106.7009&limit=10
   */
  @Get('recommended')
  getPersonalizedRecommendations(
    @Req() req: any,
    @Query('lat') lat?: string,
    @Query('lon') lon?: string,
    @Query('lng') lng?: string,
    @Query('maxPrice') maxPrice?: number,
    @Query('limit') limit?: number,
  ) {
    let userId = req.user?.sub || req.user?._id || req.user?.id;
    if (!userId && req.headers?.authorization) {
      try {
        const token = req.headers.authorization.split(' ')[1];
        if (token) {
          const payloadBase64 = token.split('.')[1];
          const payloadJson = Buffer.from(payloadBase64, 'base64').toString(
            'utf8',
          );
          const payload = JSON.parse(payloadJson);
          userId = payload.sub || payload._id || payload.id;
        }
      } catch {}
    }

    const effectiveLon = lon !== undefined && lon !== null ? lon : lng;
    return this.restaurantsService.getPersonalizedRecommendations(
      userId,
      lat,
      effectiveLon,
      maxPrice,
      limit || 10,
    );
  }

  /**
   * [TASK-P2-02 & TASK-SEC-02] Kích hoạt đồng bộ ma trận tương tác sang AI microservice để huấn luyện lại SVD
   * POST /restaurants/recommender/sync-cf (Chỉ Quản trị viên Admin)
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post('recommender/sync-cf')
  syncInteractionsToAi() {
    return this.restaurantsService.syncInteractionsToAi();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.restaurantsService.findOne(id);
  }

  /**
   * [TASK-SEC-02] Cập nhật thông tin quán ăn (Admin hoặc Owner)
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'owner')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateRestaurantDto: UpdateRestaurantDto,
  ) {
    return this.restaurantsService.update(id, updateRestaurantDto);
  }

  /**
   * [TASK-SEC-02] Xóa quán ăn (Chỉ Admin)
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.restaurantsService.remove(id);
  }

  @Post('chat')
  async chat(@Req() req: any, @Body() body: ChatRestaurantDto) {
    let userId = req.user?.sub || req.user?._id || req.user?.id;
    if (!userId && req.headers?.authorization) {
      try {
        const token = req.headers.authorization.split(' ')[1];
        if (token) {
          const payloadBase64 = token.split('.')[1];
          const payloadJson = Buffer.from(payloadBase64, 'base64').toString(
            'utf8',
          );
          const payload = JSON.parse(payloadJson);
          userId = payload.sub || payload._id || payload.id;
        }
      } catch {}
    }
    return this.restaurantsService.chatWithAI(
      body.message,
      body.userLat,
      body.userLon,
      userId,
    );
  }
}
