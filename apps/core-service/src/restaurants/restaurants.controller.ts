// src/restaurants/restaurants.controller.ts
import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Req,
  Res,
  UseInterceptors,
  UploadedFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { RestaurantsService } from './restaurants.service';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { ChatRestaurantDto } from './dto/chat-restaurant.dto';
import { ValidateRestaurantDataQualityDto } from './dto/validate-restaurant-data-quality.dto';
import { QueryRestaurantsDto } from './dto/query-restaurants.dto';
import { QueryDishesDto } from './dto/query-dishes.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { parseValidCoordinatePair } from '@shared/utils/geo.utils';

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
    const center = parseValidCoordinatePair(lat, effectiveLon);
    if (!center) {
      throw new BadRequestException(
        'Valid non-zero lat and lon/lng query parameters are required for nearby search',
      );
    }
    return this.restaurantsService.findNearby(
      center.lat,
      center.lon,
      Number(radiusKm) || 5,
      Number(limit) || 20,
      tags,
      search,
    );
  }

  @Get()
  findAll(@Query() query: QueryRestaurantsDto) {
    return this.restaurantsService.findAll(
      query.page,
      query.limit,
      query.sortBy,
      query.order,
      query.rating,
      query.openNow,
      query.userLat,
      query.userLon,
      query.search,
      query.city,
      query.tags,
      {
        district: query.district,
        area: query.area,
        cuisine: query.cuisine,
        category: query.category,
        minPrice: query.minPrice,
        maxPrice: query.maxPrice,
        minRating: query.minRating,
        status: query.status,
      },
    );
  }

  private applyLegacyMenuHeaders(
    res: Response | undefined,
    meta: {
      totalCount: number;
      limit: number;
      isTruncated: boolean;
      successorEndpoint: string;
    },
  ) {
    if (!res || typeof res.setHeader !== 'function') {
      return;
    }
    res.setHeader('X-Legacy-Endpoint', 'true');
    res.setHeader('Deprecation', 'true');
    res.setHeader(
      'Link',
      `<${meta.successorEndpoint}>; rel="successor-version"`,
    );
    res.setHeader('X-Total-Count', String(meta.totalCount));
    res.setHeader('X-Result-Limit', String(meta.limit));
    res.setHeader('X-Result-Truncated', String(meta.isTruncated));
    if (meta.isTruncated) {
      res.setHeader(
        'Warning',
        `299 - "Legacy menu response truncated at ${meta.limit} items (${meta.totalCount} total). Migrate to ${meta.successorEndpoint} for paginated results."`,
      );
    }
  }

  @Get('menu/all')
  async getAllMenuItems(
    @Query('search') search?: string,
    @Query('restaurantId') restaurantId?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const result = await this.restaurantsService.getAllMenuItemsWithMeta(
      search,
      restaurantId,
    );
    this.applyLegacyMenuHeaders(res, result);
    return result.items;
  }

  @Get(':id/menu')
  async getMenu(
    @Param('id') id: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const result = await this.restaurantsService.getMenuWithMeta(id);
    this.applyLegacyMenuHeaders(res, result);
    return result.items;
  }

  /**
   * [M10.5] List dishes belonging to a restaurant with pagination, search, price & tag filters
   * GET /api/v1/restaurants/:id/dishes
   */
  @Get(':id/dishes')
  getRestaurantDishes(
    @Param('id') id: string,
    @Query() query: QueryDishesDto,
  ) {
    return this.restaurantsService.findDishesByRestaurant(id, query);
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

  /**
   * [M10.3] Dry-run restaurant data quality validation & normalization preview (Admin only)
   * POST /restaurants/data-quality/validate
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post('data-quality/validate')
  validateDataQuality(@Body() dto: ValidateRestaurantDataQualityDto) {
    return this.restaurantsService.validateDataQuality(dto);
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
