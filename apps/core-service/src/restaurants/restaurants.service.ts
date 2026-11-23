// src/restaurants/restaurants.service.ts
import {
  Injectable,
  NotFoundException,
  OnApplicationBootstrap,
  Logger,
  Optional,
  Inject,
} from '@nestjs/common';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Restaurant, RestaurantDocument } from './schemas/restaurant.schema';
import { MenuItem, MenuItemDocument } from './schemas/menu-item.schema';
import { Model, Types } from 'mongoose';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import FormData from 'form-data';
import { TasteDnaService } from '../taste-dna/taste-dna.service';
import { InteractionsService } from '../interactions/interactions.service';

const aiUrl = process.env.AI_SERVICE_URL;

@Injectable()
export class RestaurantsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RestaurantsService.name);
  private readonly aiBaseUrl: string;
  private readonly internalAiKey: string;

  constructor(
    @InjectModel(Restaurant.name)
    private restaurantModel: Model<RestaurantDocument>,
    @InjectModel(MenuItem.name)
    private menuItemModel: Model<MenuItemDocument>,
    private readonly httpService: HttpService,
    @Optional()
    private readonly tasteDnaService?: TasteDnaService,
    @Optional()
    private readonly interactionsService?: InteractionsService,
  ) {
    this.aiBaseUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:5000';
    const key = process.env.INTERNAL_AI_KEY;
    if (!key) {
      throw new Error(
        'Missing mandatory security configuration: INTERNAL_AI_KEY must be set in environment variables',
      );
    }
    this.internalAiKey = key;
  }

  async onApplicationBootstrap() {
    await this.ensureGeoJsonLocations();
  }

  /**
   * Tự động chuẩn hóa GeoJSON Point coordinates cho các nhà hàng có lat/lon
   */
  async ensureGeoJsonLocations() {
    try {
      const pendingCount = await this.restaurantModel.countDocuments({
        $or: [
          { 'location.coordinates': { $exists: false } },
          { 'location.coordinates': { $size: 0 } },
          { location: null },
        ],
        lat: { $exists: true, $ne: null },
        lon: { $exists: true, $ne: null },
      });

      if (pendingCount > 0) {
        this.logger.log(
          `[GeoJSON Normalization] Tìm thấy ${pendingCount} nhà hàng chưa có Point coordinates. Đang chuẩn hóa...`,
        );
        const cursor = this.restaurantModel
          .find({
            $or: [
              { 'location.coordinates': { $exists: false } },
              { 'location.coordinates': { $size: 0 } },
              { location: null },
            ],
            lat: { $exists: true, $ne: null },
            lon: { $exists: true, $ne: null },
          })
          .cursor();

        let updated = 0;
        for await (const doc of cursor) {
          const lat =
            typeof doc.lat === 'string'
              ? parseFloat((doc.lat as string).replace(',', '.'))
              : Number(doc.lat);
          const lon =
            typeof doc.lon === 'string'
              ? parseFloat((doc.lon as string).replace(',', '.'))
              : Number(doc.lon);
          if (!isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0) {
            await this.restaurantModel.updateOne(
              { _id: doc._id },
              {
                $set: {
                  location: {
                    type: 'Point',
                    coordinates: [lon, lat], // [longitude, latitude]
                  },
                },
              },
            );
            updated++;
          }
        }
        this.logger.log(
          `[GeoJSON Normalization] Đã cập nhật thành công ${updated} nhà hàng.`,
        );
      }
    } catch (err: any) {
      this.logger.warn(`[GeoJSON Normalization] Cảnh báo: ${err.message}`);
    }
  }

  async getMenu(idOrSlug: string) {
    const restaurant = await this.findOne(idOrSlug);
    return this.menuItemModel.find({ restaurantId: restaurant._id }).exec();
  }

  async getAllMenuItems(search?: string, restaurantId?: string) {
    const filter: any = {};
    if (restaurantId && restaurantId !== 'all') {
      if (Types.ObjectId.isValid(restaurantId)) {
        filter.restaurantId = new Types.ObjectId(restaurantId);
      }
    }
    if (search) {
      filter.name = { $regex: search, $options: 'i' };
    }
    return this.menuItemModel
      .find(filter)
      .populate('restaurantId', 'tenQuan diaChi')
      .sort({ isFeatured: -1, createdAt: -1 })
      .exec();
  }

  async createMenuItem(restaurantId: string, dto: any) {
    let targetRestId = restaurantId;
    if (restaurantId && Types.ObjectId.isValid(restaurantId)) {
      targetRestId = restaurantId;
    } else if (restaurantId) {
      const rest = await this.restaurantModel
        .findOne({ slug: restaurantId })
        .exec();
      if (rest) targetRestId = rest._id.toString();
    }
    const item = new this.menuItemModel({
      restaurantId: new Types.ObjectId(targetRestId),
      name: dto.name,
      description: dto.description || '',
      price: Number(dto.price) || 0,
      image:
        dto.image ||
        'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=600&q=80',
      isVegetarian: Boolean(dto.isVegetarian),
      tags: dto.tags || [],
    });
    return item.save();
  }

  async updateMenuItem(menuId: string, dto: any) {
    return this.menuItemModel
      .findByIdAndUpdate(menuId, dto, { new: true })
      .exec();
  }

  async deleteMenuItem(menuId: string) {
    return this.menuItemModel.findByIdAndDelete(menuId).exec();
  }

  async create(createRestaurantDto: any): Promise<RestaurantDocument> {
    const lat = Number(createRestaurantDto.lat) || 10.7769;
    const lon = Number(createRestaurantDto.lon) || 106.7009;
    const restaurantData: any = {
      ...createRestaurantDto,
      location: {
        type: 'Point',
        coordinates: [lon, lat],
      },
    };
    const created = new this.restaurantModel(restaurantData);
    return created.save();
  }

  async findNearby(
    lat: number,
    lon: number,
    radiusKm: number = 5,
    limit: number = 20,
    tags?: string,
    search?: string,
  ) {
    const radiusMeters = Math.max(1, Number(radiusKm) || 5) * 1000;
    const matchStage: any = {
      status: { $ne: 'closed' },
    };

    if (tags && tags !== 'all' && tags !== 'Tất cả') {
      const tagList = tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      if (tagList.length > 0) {
        matchStage.tags = { $regex: new RegExp(tagList.join('|'), 'i') };
      }
    }

    if (search && search.trim()) {
      matchStage.$or = [
        { tenQuan: { $regex: search.trim(), $options: 'i' } },
        { diaChi: { $regex: search.trim(), $options: 'i' } },
        { tags: { $regex: search.trim(), $options: 'i' } },
      ];
    }

    try {
      const pipeline: any[] = [
        {
          $geoNear: {
            near: {
              type: 'Point',
              coordinates: [Number(lon), Number(lat)],
            },
            distanceField: 'distanceMeters',
            maxDistance: radiusMeters,
            spherical: true,
            query: matchStage,
          },
        },
        { $limit: Math.min(100, Math.max(1, Number(limit) || 20)) },
      ];

      const results = await this.restaurantModel.aggregate(pipeline).exec();
      return results.map((item) => {
        const dto = this.mapRestaurantToDTO(item);
        dto.distance = Number(((item.distanceMeters || 0) / 1000).toFixed(2));
        return dto;
      });
    } catch (error: any) {
      this.logger.warn(
        `Fallback từ $geoNear sang Haversine query: ${error.message}`,
      );
      const candidates = await this.restaurantModel
        .find(matchStage)
        .limit(100)
        .lean()
        .exec();
      const withDist = candidates
        .map((item: any) => {
          const dto = this.mapRestaurantToDTO(item);
          const dist = this.getDistanceFromLatLonInKm(
            lat,
            lon,
            item.lat || 0,
            item.lon || 0,
          );
          dto.distance = Number(dist.toFixed(2));
          return dto;
        })
        .filter((item: any) => item.distance <= radiusKm);

      withDist.sort((a: any, b: any) => a.distance - b.distance);
      return withDist.slice(0, Number(limit) || 20);
    }
  }

  // [MỚI] HÀM XỬ LÝ SEARCH ẢNH
  async searchByImage(file: Express.Multer.File) {
    try {
      if (!file) throw new Error('Không có file được tải lên');

      const aiUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:5000';

      console.log('------------------------------------------------');
      console.log('📸 ĐANG GỌI AI SERVICE...');
      console.log('🔗 URL được dùng:', aiUrl);
      console.log(
        '❓ Có phải localhost không?:',
        aiUrl.includes('127.0.0.1') ? 'CÓ (LỖI)' : 'KHÔNG (OK)',
      );
      console.log('------------------------------------------------');

      const formData = new FormData();
      formData.append('file', Buffer.from(file.buffer), file.originalname);

      const aiResponse = await firstValueFrom(
        this.httpService.post(`${aiUrl}/predict-food`, formData, {
          headers: {
            ...formData.getHeaders(),
          },
        }),
      );

      const foodName = aiResponse.data.food_name;
      console.log('AI Detected:', foodName);

      if (!foodName) {
        return { data: [], message: 'Không nhận diện được món ăn' };
      }

      const result = await this.findAll(
        1, // page
        50, // limit: Lấy 50 để lọc
        'diemTrungBinh', // sortBy
        'desc', // order
        'all', // rating
        'false', // openNow
        '',
        '', // lat, lon (Tạm để trống, có thể update nếu cần GPS)
        foodName, // search query (Tên món AI đoán)
      );

      let topRestaurants = result.data || [];
      topRestaurants.sort(
        (a: any, b: any) => (b.diemTrungBinh || 0) - (a.diemTrungBinh || 0),
      );
      topRestaurants = topRestaurants.slice(0, 5);

      const touristInfo = this.getSimilarDishesAndTouristInfo(foodName);

      return {
        data: topRestaurants,
        detectedFood: foodName,
        englishName: touristInfo.englishName,
        similarDishes: touristInfo.similarDishes,
        touristGuide: touristInfo.touristGuide,
        total: topRestaurants.length,
      };
    } catch (error: any) {
      console.error('Lỗi search by image:', error.message);
      return { data: [], message: 'Lỗi xử lý hình ảnh' };
    }
  }

  private getSimilarDishesAndTouristInfo(foodName: string) {
    const lower = (foodName || '').toLowerCase();

    if (lower.includes('phở') || lower.includes('pho')) {
      return {
        englishName: 'Vietnamese Beef Noodle Soup (Pho)',
        similarDishes: ['Bún Bò Huế', 'Phở Gà', 'Hủ Tiếu Nam Vang', 'Mì Quảng'],
        touristGuide:
          'A world-famous Vietnamese staple featuring aromatic bone broth, flat rice noodles, fresh herbs, and tender beef slices.',
      };
    } else if (lower.includes('cơm') || lower.includes('com')) {
      return {
        englishName: 'Vietnamese Broken Rice (Com Tam)',
        similarDishes: [
          'Cơm Gà Xối Mỡ',
          'Cơm Niêu',
          'Cơm Sườn nướng',
          'Cơm Tấm Chả Trứng',
        ],
        touristGuide:
          'Iconic Saigon street food consisting of fragrant broken rice served with marinated grilled pork chop, steamed egg loaf, and sweet fish sauce.',
      };
    } else if (lower.includes('bánh mì') || lower.includes('banh mi')) {
      return {
        englishName: 'Vietnamese Baguette Sandwich (Banh Mi)',
        similarDishes: ['Bánh Mì Chảo', 'Bánh Xèo', 'Gỏi Cuốn', 'Bánh Cuốn'],
        touristGuide:
          'Crispy crusty baguette stuffed with savory pate, grilled meats, pickled daikon & carrots, fresh cilantro, and chili.',
      };
    } else if (lower.includes('bún') || lower.includes('bun')) {
      return {
        englishName: 'Vietnamese Rice Noodle Bowl (Bun)',
        similarDishes: [
          'Phở Bò',
          'Bún Bò Huế',
          'Bún Riêu Cua',
          'Bún Chả Hà Nội',
        ],
        touristGuide:
          'Rich, flavorful Vietnamese noodle dish infused with herbs, savory broth, tender meats, and fresh greens.',
      };
    } else if (lower.includes('lẩu') || lower.includes('hotpot')) {
      return {
        englishName: 'Vietnamese Hotpot (Lau)',
        similarDishes: ['Lẩu Thái Cay', 'Lẩu Hải Sản', 'Lẩu Bò', 'Nướng BBQ'],
        touristGuide:
          'Simmering communal hotpot served with fresh seafood, sliced meats, seasonal green vegetables, and noodles.',
      };
    }

    return {
      englishName: foodName,
      similarDishes: ['Phở Bò', 'Bánh Mì', 'Cơm Tấm', 'Gỏi Cuốn', 'Bún Bò Huế'],
      touristGuide:
        'Delicious authentic Vietnamese dish served with traditional fresh ingredients and aromatic seasonings.',
    };
  }

  // [MỚI] GỢI Ý MÓN ĂN THEO THỜI TIẾT REALTIME + GPS
  async getWeatherRecommendation(userLat?: string, userLon?: string) {
    try {
      const aiUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:5000';
      const payload: any = {};
      if (userLat && userLon) {
        payload.user_gps = [parseFloat(userLat), parseFloat(userLon)];
      }

      const aiResponse = await firstValueFrom(
        this.httpService.post(`${aiUrl}/weather-recommend`, payload),
      );

      const weatherData = aiResponse.data.weather;
      const scores = aiResponse.data.scores || [];
      const recommendedIds = scores.map((item: any) => item.id);

      let restaurants: any[] = [];
      if (recommendedIds.length > 0) {
        const found = await this.restaurantModel
          .find({ _id: { $in: recommendedIds } })
          .lean()
          .exec();

        const idMap = new Map(found.map((r: any) => [r._id.toString(), r]));
        restaurants = recommendedIds
          .map((id: string) => idMap.get(id))
          .filter(Boolean)
          .slice(0, 10)
          .map((res: any) => this.mapRestaurantToDTO(res));
      }

      return {
        weather: weatherData,
        data: restaurants,
        total: restaurants.length,
      };
    } catch (error: any) {
      console.error('Lỗi weather recommendation AI:', error.message);
      return {
        weather: {
          temperature: 28,
          condition_text: 'Trời nắng mát',
          condition_code: 0,
          banner_title: '🌤️ Món ngon dành riêng cho bạn hôm nay!',
          banner_desc:
            'Khám phá các địa điểm ẩm thực nổi tiếng được đánh giá cao nhất.',
          weather_type: 'cool',
        },
        data: [],
        total: 0,
      };
    }
  }

  /**
   * [TASK-P2-01 & TASK-P2-02] Gợi ý nhà hàng cá nhân hóa đa tầng (Hybrid Recommendation):
   * Kết hợp Taste DNA 6 chiều, SVD Collaborative Filtering, Ngữ cảnh thời tiết & Khoảng cách.
   */
  async getPersonalizedRecommendations(
    userId?: string,
    userLat?: string | number,
    userLon?: string | number,
    maxPrice?: number,
    limit: number = 10,
  ) {
    try {
      let tasteVector: number[] | undefined = undefined;
      let dietaryExclusions: string[] = [];

      // 1. Lấy Taste DNA vector nếu user đã đăng nhập
      if (userId && this.tasteDnaService) {
        try {
          const profile = await this.tasteDnaService.getProfile(userId);
          if (profile) {
            tasteVector = [
              profile.spicy ?? 0.5,
              profile.sweet ?? 0.5,
              profile.sour ?? 0.5,
              profile.salty ?? 0.5,
              profile.umami ?? 0.5,
              profile.bitter ?? 0.5,
            ];
            dietaryExclusions = profile.dietaryRestrictions || [];
          }
        } catch (e: any) {
          this.logger.warn(
            `Không lấy được Taste DNA cho user ${userId}: ${e.message}`,
          );
        }
      }

      // 2. Lấy thông tin thời tiết để kết hợp ngữ cảnh
      const weatherRec = await this.getWeatherRecommendation(
        userLat ? String(userLat) : undefined,
        userLon ? String(userLon) : undefined,
      );
      const weatherType = weatherRec?.weather?.weather_type || 'cool';
      const temperature = weatherRec?.weather?.temperature || 28;

      // 3. Chuẩn bị payload gửi sang FastAPI Hybrid Engine
      const aiBaseUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:5000';
      const payload: any = {
        user_id: userId || '',
        limit: Number(limit) || 10,
        weather_type: weatherType,
        temperature: Number(temperature),
        dietary_exclusions: dietaryExclusions,
      };

      if (userLat !== undefined && userLon !== undefined) {
        const latNum = Number(userLat);
        const lonNum = Number(userLon);
        if (!isNaN(latNum) && !isNaN(lonNum) && latNum !== 0 && lonNum !== 0) {
          payload.user_gps = [latNum, lonNum];
        }
      }

      if (tasteVector) {
        payload.taste_vector = tasteVector;
      }

      if (maxPrice && Number(maxPrice) > 0) {
        payload.max_price = Number(maxPrice);
      }

      // 4. Gọi FastAPI /recommend/hybrid
      const headers: Record<string, string> = {
        'X-Internal-AI-Key': this.internalAiKey,
      };
      const aiRes = await firstValueFrom(
        this.httpService.post(`${this.aiBaseUrl}/recommend/hybrid`, payload, {
          headers,
          timeout: 3500,
        }),
      );

      const items = aiRes.data?.items || [];
      const recommendedIds = items.map((it: any) => it.id);

      if (recommendedIds.length > 0) {
        const found = await this.restaurantModel
          .find({ _id: { $in: recommendedIds } })
          .lean()
          .exec();

        const docMap = new Map(found.map((r: any) => [r._id.toString(), r]));
        const itemMetaMap = new Map(items.map((it: any) => [it.id, it]));

        const hydrated = recommendedIds
          .map((id: string) => {
            const rawDoc = docMap.get(id);
            if (!rawDoc) return null;
            const dto: any = this.mapRestaurantToDTO(rawDoc);
            const meta: any = itemMetaMap.get(id) || {};
            dto.aiScore = meta.score || 0;
            dto.tasteScore = meta.taste_score || 0;
            dto.cfScore = meta.cf_score || 0;
            dto.envScore = meta.env_score || 1.0;
            dto.explanation = meta.explanation || 'Gợi ý hợp khẩu vị của bạn';
            dto.matchReasons = meta.match_reasons || [dto.explanation];
            if (meta.distance_km !== undefined) {
              dto.distance = meta.distance_km;
            }
            return dto;
          })
          .filter(Boolean);

        return {
          success: true,
          total: hydrated.length,
          isColdStart: aiRes.data?.is_cold_start ?? true,
          appliedWeights: aiRes.data?.applied_weights,
          data: hydrated,
        };
      }

      // Fallback nếu AI trả về 0 kết quả
      return this.getFallbackRecommendations(userLat, userLon, limit);
    } catch (error: any) {
      this.logger.warn(
        `AI Hybrid Recommendation lỗi, kích hoạt fallback: ${error.message}`,
      );
      return this.getFallbackRecommendations(userLat, userLon, limit);
    }
  }

  /**
   * Fallback an toàn khi AI Microservice bảo trì hoặc không có kết nối
   */
  async getFallbackRecommendations(
    userLat?: any,
    userLon?: any,
    limit: number = 10,
  ) {
    let fallbackList: any[] = [];
    if (userLat && userLon) {
      try {
        fallbackList = await this.findNearby(
          Number(userLat),
          Number(userLon),
          15,
          limit,
        );
      } catch {}
    }

    if (!fallbackList || fallbackList.length === 0) {
      const topRated = await this.restaurantModel
        .find({})
        .sort({ diemTrungBinh: -1, reviewsCount: -1 })
        .limit(limit)
        .lean()
        .exec();
      fallbackList = topRated.map((r: any) => this.mapRestaurantToDTO(r));
    }

    const enriched = fallbackList.map((r: any) => ({
      ...r,
      aiScore: 0.85,
      tasteScore: 0.8,
      explanation:
        '⭐ Địa điểm ẩm thực nổi tiếng được yêu thích trên GastroWise',
      matchReasons: ['⭐ Đánh giá cao', '🌟 Quán nổi bật'],
    }));

    return {
      success: true,
      total: enriched.length,
      isColdStart: true,
      data: enriched,
    };
  }

  /**
   * Đồng bộ ma trận tương tác sang AI microservice để huấn luyện lại SVD
   */
  async syncInteractionsToAi() {
    if (!this.interactionsService) {
      return { success: false, message: 'InteractionsService chưa sẵn sàng' };
    }
    try {
      const interactions = await this.interactionsService.getMatrixExport(5000);
      const headers: Record<string, string> = {
        'X-Internal-AI-Key': this.internalAiKey,
      };
      const res = await firstValueFrom(
        this.httpService.post(
          `${this.aiBaseUrl}/cf/train`,
          { interactions },
          { headers, timeout: 10000 },
        ),
      );
      return res.data;
    } catch (err: any) {
      this.logger.error(
        `Lỗi đồng bộ interaction matrix sang AI: ${err.message}`,
      );
      return { success: false, error: err.message };
    }
  }

  // --- CÁC HÀM CŨ GIỮ NGUYÊN BÊN DƯỚI ---

  private checkIsOpen(gioMoCua: string): boolean {
    if (!gioMoCua) return false;
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const ranges = gioMoCua.split(/[|,]/).map((r) => r.trim());

    for (const range of ranges) {
      const parts = range.split('-').map((p) => p.trim());
      if (parts.length !== 2) continue;
      const [startStr, endStr] = parts;
      const toMinutes = (timeStr: string) => {
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
      };
      const start = toMinutes(startStr);
      const end = toMinutes(endStr);

      if (start <= end) {
        if (currentMinutes >= start && currentMinutes <= end) return true;
      } else {
        if (currentMinutes >= start || currentMinutes <= end) return true;
      }
    }
    return false;
  }

  private getDistanceFromLatLonInKm(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ) {
    const R = 6371;
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(lat1)) *
        Math.cos(this.deg2rad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private deg2rad(deg: number) {
    return deg * (Math.PI / 180);
  }

  private mapRestaurantToDTO(res: any) {
    const r = res.toObject ? res.toObject() : res;
    const rawRating = r.diemTrungBinh
      ? Number(r.diemTrungBinh)
      : r.rating
        ? Number(r.rating)
        : 5.0;
    const normalizedRating =
      rawRating > 5
        ? Number((rawRating / 2).toFixed(1))
        : Number(rawRating.toFixed(1));

    return {
      id: r._id ? r._id.toString() : r.id,
      _id: r._id ? r._id.toString() : r.id,
      name: r.tenQuan || r.name || 'Nhà hàng GastroWise',
      tenQuan: r.tenQuan || r.name || 'Nhà hàng GastroWise',
      address: r.diaChi || r.address || 'TP. Hồ Chí Minh',
      diaChi: r.diaChi || r.address || 'TP. Hồ Chí Minh',
      coverImage:
        r.avatarUrl ||
        r.coverImage ||
        r.cover_image ||
        `https://picsum.photos/seed/${r._id || r.id}/1200/500`,
      avatarUrl:
        r.avatarUrl ||
        r.coverImage ||
        r.cover_image ||
        `https://picsum.photos/seed/${r._id || r.id}/1200/500`,
      rating: normalizedRating,
      diemTrungBinh: normalizedRating,
      priceRange: r.giaCa || r.priceRange || '30.000đ - 150.000đ',
      giaCa: r.giaCa || r.priceRange || '30.000đ - 150.000đ',
      openingHours:
        r.gioMoCua || r.openingHours || r.openTime || '08:00 - 22:00',
      gioMoCua: r.gioMoCua || r.openingHours || r.openTime || '08:00 - 22:00',
      openTime: r.gioMoCua || r.openingHours || r.openTime || '08:00 - 22:00',
      cuisineTypes: r.tags
        ? r.tags.split(',').map((t: string) => t.trim())
        : ['Nhà hàng'],
      tags: r.tags || '',
      phone: r.contactPhone || r.phone || '0901 234 567',
      contactPhone: r.contactPhone || r.phone || '0901 234 567',
      description: r.description || '',
      lat: r.lat,
      lng: r.lon || r.lng,
      location: r.location,
      shopeeUrl: r.urlGoc || null,
      distance: r.distance,
      status: r.status || 'open',
      isVerified: Boolean(r.isVerified),
      isFeatured: Boolean(r.isFeatured),
    };
  }

  async findAll(
    page: number = 1,
    limit: number = 32,
    sortBy: string = 'diemTrungBinh',
    order: string = 'desc',
    rating: string = 'all',
    openNow: string = 'false',
    userLat: string = '',
    userLon: string = '',
    search: string = '',
    city: string = '',
    tags: string = '',
  ): Promise<any> {
    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 32;
    const skip = (pageNum - 1) * limitNum;

    // 1. Setup Sort
    const sortOptions: any = {};
    const allowedSortFields = [
      'diemTrungBinh',
      'diemKhongGian',
      'diemViTri',
      'diemChatLuong',
      'diemPhucVu',
      'diemGiaCa',
    ];
    const sortField =
      allowedSortFields.includes(sortBy) && sortBy !== 'default'
        ? sortBy
        : 'diemTrungBinh';
    const sortDirection = order === 'asc' ? 1 : -1;
    sortOptions[sortField] = sortDirection;

    // 2. Setup Filter
    const filterQuery: any = {};
    if (city) {
      if (city === 'hanoi') {
        filterQuery['diaChi'] = {
          $regex:
            /Hà Nội|Ha Noi|HN|Hanoi|Ba Đình|Ba Dinh|Hoàn Kiếm|Hoan Kiem|Tây Hồ|Tay Ho|Long Biên|Long Bien|Cầu Giấy|Cau Giay|Đống Đa|Dong Da|Hai Bà Trưng|Hai Ba Trung|Hoàng Mai|Hoang Mai|Thanh Xuân|Thanh Xuan|Sóc Sơn|Soc Son|Đông Anh|Dong Anh|Gia Lâm|Gia Lam|Nam Từ Liêm|Nam Tu Liem|Bắc Từ Liêm|Bac Tu Liem|Thanh Trì|Thanh Tri|Hà Đông|Ha Dong|Sơn Tây|Son Tay/i,
        };
      } else if (city === 'hcmc') {
        filterQuery['diaChi'] = {
          $regex:
            /Hồ Chí Minh|Ho Chi Minh|TP\.?\s?HCM|TPHCM|Sài Gòn|Sai Gon|HCM|Thủ Đức|Thu Duc|Gò Vấp|Go Vap|Bình Thạnh|Binh Thanh|Tân Bình|Tan Binh|Tân Phú|Tan Phu|Phú Nhuận|Phu Nhuan|Bình Tân|Binh Tan|Củ Chi|Cu Chi|Hóc Môn|Hoc Mon|Bình Chánh|Binh Chanh|Nhà Bè|Nha Be|Cần Giờ|Can Gio|Quận\s?1|District\s?1|Q\.?1|Quận\s?3|District\s?3|Q\.?3|Quận\s?4|District\s?4|Q\.?4|Quận\s?5|District\s?5|Q\.?5|Quận\s?6|District\s?6|Q\.?6|Quận\s?7|District\s?7|Q\.?7|Quận\s?8|District\s?8|Q\.?8|Quận\s?10|District\s?10|Q\.?10|Quận\s?11|District\s?11|Q\.?11|Quận\s?12|District\s?12|Q\.?12/i,
        };
      }
    }
    const scoreFieldToCheck = sortField;
    if (rating && rating !== 'all') {
      switch (rating) {
        case 'gte4_5':
        case 'gte9':
          filterQuery['$or'] = [
            { [scoreFieldToCheck]: { $gte: 9.0 } },
            { [scoreFieldToCheck]: { $gte: 4.5, $lte: 5.0 } },
          ];
          break;
        case 'gte4':
        case '8to9':
          filterQuery['$or'] = [
            { [scoreFieldToCheck]: { $gte: 8.0 } },
            { [scoreFieldToCheck]: { $gte: 4.0, $lte: 5.0 } },
          ];
          break;
        case 'gte3_5':
        case '7to8':
          filterQuery['$or'] = [
            { [scoreFieldToCheck]: { $gte: 7.0 } },
            { [scoreFieldToCheck]: { $gte: 3.5, $lte: 5.0 } },
          ];
          break;
        case 'gte3':
        case '6to7':
          filterQuery['$or'] = [
            { [scoreFieldToCheck]: { $gte: 6.0 } },
            { [scoreFieldToCheck]: { $gte: 3.0, $lte: 5.0 } },
          ];
          break;
        case 'lt6':
          filterQuery[scoreFieldToCheck] = { $lt: 6.0 };
          break;
      }
    }

    if (tags && tags !== 'Tất cả') {
      const tagList = tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      if (tagList.length > 0) {
        filterQuery['tags'] = { $regex: new RegExp(tagList.join('|'), 'i') };
      }
    }

    // Logic gọi AI (Text Search)
    const aiIndexMap: Record<string, number> = {};
    let isAiSearch = false;
    if (search && search.trim() !== '') {
      isAiSearch = true;
      try {
        const payload = {
          query: search,
          user_gps:
            userLat && userLon
              ? [parseFloat(userLat), parseFloat(userLon)]
              : null,
        };
        const aiUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:5000';
        const aiResponse = await firstValueFrom(
          this.httpService.post(`${aiUrl}/recommend`, payload),
        );

        const recommendedItems = aiResponse.data.scores || [];
        const recommendedIds = recommendedItems.map((item: any) => item.id);

        if (recommendedIds.length > 0) {
          filterQuery['_id'] = { $in: recommendedIds };
          recommendedItems.forEach((item: any, index: number) => {
            aiIndexMap[item.id] = index;
          });
        } else {
          filterQuery['$or'] = [
            { tenQuan: { $regex: search, $options: 'i' } },
            { name: { $regex: search, $options: 'i' } },
            { tags: { $regex: search, $options: 'i' } },
            { cuisines: { $regex: search, $options: 'i' } },
            { diaChi: { $regex: search, $options: 'i' } },
            { address: { $regex: search, $options: 'i' } },
          ];
          isAiSearch = false;
        }
      } catch (error: any) {
        console.error('Lỗi kết nối AI:', error.message);
        filterQuery['$or'] = [
          { tenQuan: { $regex: search, $options: 'i' } },
          { name: { $regex: search, $options: 'i' } },
          { tags: { $regex: search, $options: 'i' } },
          { cuisines: { $regex: search, $options: 'i' } },
          { diaChi: { $regex: search, $options: 'i' } },
          { address: { $regex: search, $options: 'i' } },
        ];
        isAiSearch = false;
      }
    }

    // 3. Xác định chế độ xử lý
    const isOpenNowBool = openNow === 'true';
    const isSortDistance = sortBy === 'distance' && userLat && userLon;
    const isManualProcessing = isOpenNowBool || isSortDistance || isAiSearch;

    let data: any[] = [];
    let total = 0;

    if (isManualProcessing) {
      let allCandidates = await this.restaurantModel
        .find(filterQuery)
        .lean()
        .exec();

      if (userLat && userLon) {
        const uLat = parseFloat(userLat);
        const uLon = parseFloat(userLon);

        allCandidates = allCandidates.map((res: any) => {
          const parseCoord = (val: any) => {
            if (typeof val === 'number') return val;
            if (typeof val === 'string')
              return parseFloat(val.replace(',', '.'));
            return 0;
          };
          const resLat = parseCoord(res.lat);
          const resLon = parseCoord(res.lon);
          const dist =
            resLat && resLon
              ? this.getDistanceFromLatLonInKm(uLat, uLon, resLat, resLon)
              : 99999;
          return { ...res, distance: dist };
        });
      }

      if (isOpenNowBool) {
        allCandidates = allCandidates.filter((res: any) =>
          this.checkIsOpen(res.openingTime || res.gioMoCua),
        );
      }

      if (isAiSearch && sortBy === 'diemTrungBinh') {
        allCandidates.sort((a: any, b: any) => {
          if (order === 'asc') {
            return (a.diemTrungBinh || 0) - (b.diemTrungBinh || 0);
          }
          const idxA = aiIndexMap[a._id.toString()] ?? 9999;
          const idxB = aiIndexMap[b._id.toString()] ?? 9999;
          return idxA - idxB;
        });
      } else if (isSortDistance) {
        allCandidates.sort((a: any, b: any) => {
          return order === 'asc'
            ? a.distance - b.distance
            : b.distance - a.distance;
        });
      } else {
        allCandidates.sort((a: any, b: any) => {
          const valA = a[sortField] || 0;
          const valB = b[sortField] || 0;
          return sortDirection === 1 ? valA - valB : valB - valA;
        });
      }

      total = allCandidates.length;
      data = allCandidates
        .slice(skip, skip + limitNum)
        .map((res) => this.mapRestaurantToDTO(res));
    } else {
      total = await this.restaurantModel.countDocuments(filterQuery).exec();
      const rawData = await this.restaurantModel
        .find(filterQuery)
        .sort(sortOptions)
        .skip(skip)
        .limit(limitNum)
        .exec();
      data = rawData.map((res) => this.mapRestaurantToDTO(res));
    }

    return {
      data,
      total,
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum),
      sortBy: sortBy,
      order: order,
    };
  }

  async findOne(idOrSlug: string): Promise<RestaurantDocument> {
    let restaurant: RestaurantDocument | null = null;
    if (
      Types.ObjectId.isValid(idOrSlug) &&
      /^[0-9a-fA-F]{24}$/.test(idOrSlug)
    ) {
      restaurant = await this.restaurantModel.findById(idOrSlug).exec();
    }
    if (!restaurant) {
      restaurant = await this.restaurantModel
        .findOne({ slug: idOrSlug })
        .exec();
    }
    if (!restaurant) {
      restaurant = await this.restaurantModel
        .findOne({
          urlGoc: { $regex: `${idOrSlug}$`, $options: 'i' },
        })
        .exec();
    }
    if (!restaurant)
      throw new NotFoundException(
        `Restaurant with ID or slug "${idOrSlug}" not found`,
      );
    return this.mapRestaurantToDTO(restaurant) as any;
  }

  async update(
    id: string,
    updateRestaurantDto: any,
  ): Promise<RestaurantDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`ID nhà hàng "${id}" không hợp lệ.`);
    }

    // Tự động đồng bộ GeoJSON Point location nếu lat hoặc lon thay đổi
    if (
      updateRestaurantDto.lat !== undefined ||
      updateRestaurantDto.lon !== undefined
    ) {
      const existing = await this.restaurantModel.findById(id).lean();
      const newLat =
        updateRestaurantDto.lat !== undefined
          ? Number(updateRestaurantDto.lat)
          : Number(existing?.lat || 0);
      const newLon =
        updateRestaurantDto.lon !== undefined
          ? Number(updateRestaurantDto.lon)
          : Number(existing?.lon || 0);
      if (!isNaN(newLat) && !isNaN(newLon) && newLat !== 0 && newLon !== 0) {
        updateRestaurantDto.location = {
          type: 'Point',
          coordinates: [newLon, newLat],
        };
      }
    }

    const updated = await this.restaurantModel
      .findByIdAndUpdate(id, updateRestaurantDto, { new: true })
      .exec();
    if (!updated) {
      throw new NotFoundException(`Không tìm thấy nhà hàng với ID "${id}"`);
    }
    return updated;
  }

  async remove(id: string): Promise<any> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`ID nhà hàng "${id}" không hợp lệ.`);
    }
    return this.restaurantModel.findByIdAndDelete(id).exec();
  }

  private getRandomReply(
    type: 'success' | 'notFound' | 'error',
    params?: { count?: number; keyword?: string },
  ): string {
    const { count, keyword } = params || {};

    const templates = {
      success: [
        `Tuyệt vời! Mình tìm được ${count} quán "${keyword}" được đánh giá cao nhất cho bạn đây 👇`,
        `Có ngay! Dưới đây là ${count} địa điểm bán "${keyword}" xịn xò nhất mà mình lọc được. Mời bạn thẩm! 😋`,
        `Bingo! 🎯 Tìm thấy ${count} quán "${keyword}" cực phẩm. Bạn xem thử nhé!`,
        `Dựa trên yêu cầu "${keyword}", đây là top ${count} quán "đỉnh của chóp" mình gợi ý cho bạn.`,
        `Đã tìm ra! ${count} địa điểm này chắc chắn sẽ làm bạn hài lòng với món "${keyword}".`,
        `Món "${keyword}" hả? Dễ ợt! Mình có ${count} gợi ý siêu chất lượng bên dưới này.`,
      ],
      notFound: [
        `Hic, tiếc quá! Mình lục tung dữ liệu mà không thấy quán nào bán "${keyword}". Hay bạn thử món khác xem? 🍜`,
        `Rất tiếc, hiện tại mình chưa có dữ liệu về món "${keyword}". Bạn thử tìm "Phở", "Cơm tấm" xem sao nhé!`,
        `Ca này khó! 😅 Mình không tìm thấy kết quả nào cho "${keyword}". Bạn kiểm tra lại chính tả hoặc thử từ khóa ngắn gọn hơn nhé.`,
        `Hmm... Món này nghe lạ quá, mình chưa tìm thấy quán phù hợp. Bạn thử đổi món khác nhé?`,
      ],
      error: [
        `Ouch! Hệ thống đang bị "đau bụng" chút xíu. Bạn thử lại sau nhé! 🤒`,
        `Xin lỗi, mình đang mất kết nối tạm thời. Bạn chờ chút rồi hỏi lại nha!`,
        `Máy chủ đang bận, bạn vui lòng thử lại sau vài phút nhé!`,
      ],
    };

    const list = templates[type];
    const randomIndex = Math.floor(Math.random() * list.length);
    return list[randomIndex];
  }

  /**
   * [TASK-P5-01] AI Natural Language Food Copilot Chatbot:
   * Kết nối với FastAPI NLU Service để phân tích ý định (Intent), trích xuất thực thể (Slots),
   * gắn Action Card tương tác (Lập tour, Thẻ dinh dưỡng, Tìm gần đây) và hydrate dữ liệu quán ăn.
   */
  async chatWithAI(
    message: string,
    userLat?: string,
    userLon?: string,
    userId?: string,
  ) {
    try {
      let tasteVector: number[] | undefined = undefined;
      if (userId && this.tasteDnaService) {
        try {
          const profile = await this.tasteDnaService.getProfile(userId);
          if (profile) {
            tasteVector = [
              profile.spicy ?? 0.5,
              profile.sweet ?? 0.5,
              profile.sour ?? 0.5,
              profile.salty ?? 0.5,
              profile.umami ?? 0.5,
              profile.bitter ?? 0.5,
            ];
          }
        } catch {}
      }

      const aiBaseUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:5000';
      const payload: any = { message };
      if (userLat && userLon) {
        const lat = parseFloat(userLat);
        const lon = parseFloat(userLon);
        if (!isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0) {
          payload.user_gps = [lat, lon];
        }
      }
      if (tasteVector) {
        payload.taste_vector = tasteVector;
      }

      // Gọi NLU Copilot endpoint
      const headers: Record<string, string> = {
        'X-Internal-AI-Key': this.internalAiKey,
      };
      const aiResponse = await firstValueFrom(
        this.httpService.post(`${this.aiBaseUrl}/copilot/message`, payload, {
          headers,
          timeout: 5000,
        }),
      );

      const copilotData = aiResponse.data;
      let hydratedResults: any[] = [];

      if (copilotData.results && copilotData.results.length > 0) {
        const candidateIds = copilotData.results.map((r: any) => r.id);
        const docs = await this.restaurantModel
          .find({ _id: { $in: candidateIds } })
          .lean()
          .exec();
        const docMap = new Map(docs.map((d: any) => [d._id.toString(), d]));

        hydratedResults = copilotData.results.map((r: any) => {
          const doc: any = docMap.get(r.id);
          if (doc) {
            const dto: any = this.mapRestaurantToDTO(doc);
            dto.explanation = r.explanation;
            dto.distance = r.distance_km;
            return dto;
          }
          return r;
        });
      }

      return {
        reply: copilotData.reply,
        intent: copilotData.intent,
        entities: copilotData.entities,
        action_card: copilotData.action_card,
        data: hydratedResults,
        results: hydratedResults,
      };
    } catch (error: any) {
      this.logger.warn(
        `Lỗi AI Copilot NLU, chuyển sang fallback regex search: ${error.message}`,
      );
      const result = await this.findAll(
        1,
        50,
        'diemTrungBinh',
        'desc',
        'all',
        'false',
        userLat,
        userLon,
        message,
      );

      let topRestaurants = result.data || [];
      topRestaurants.sort(
        (a: any, b: any) => (b.diemTrungBinh || 0) - (a.diemTrungBinh || 0),
      );
      topRestaurants = topRestaurants.slice(0, 5);
      const count = topRestaurants.length;

      let replyText = '';
      if (count > 0) {
        replyText = this.getRandomReply('success', { count, keyword: message });
      } else {
        replyText = this.getRandomReply('notFound', { keyword: message });
      }

      return {
        reply: replyText,
        intent: 'search_food',
        entities: {},
        action_card: {
          type: 'search_results_action',
          title: `Kết quả cho: ${message}`,
          button_text: 'Xem thêm địa điểm',
          action: 'open_explore_search',
          query: message,
        },
        data: topRestaurants,
        results: topRestaurants,
      };
    }
  }
}
