import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Logger,
  Optional,
} from '@nestjs/common';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Restaurant, RestaurantDocument } from './schemas/restaurant.schema';
import { MenuItem, MenuItemDocument } from './schemas/menu-item.schema';
import { Review, ReviewDocument } from '../reviews/schemas/review.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { FavoriteCollection } from '../favorites/schemas/favorite-collection.schema';
import { Model, Types } from 'mongoose';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import FormData from 'form-data';
import { TasteDnaService } from '../taste-dna/taste-dna.service';
import { InteractionsService } from '../interactions/interactions.service';
import {
  extractValidGeoPoint,
  isValidGeoJsonPoint,
  parseValidCoordinatePair,
  toGeoJsonPoint,
} from '@shared/utils/geo.utils';
import {
  formatRestaurantTagsString,
  normalizeRestaurantRating,
  normalizeRestaurantTags,
  parseRestaurantPriceVnd,
} from '@shared/utils/restaurant-normalizer.util';
import {
  evaluateRestaurantDataQuality,
  IngestionValidationError,
} from '@shared/ingestion';
import { ValidateRestaurantDataQualityDto } from './dto/validate-restaurant-data-quality.dto';
import { QueryDishesDto } from './dto/query-dishes.dto';

export interface RestaurantListExtraFilters {
  district?: string;
  area?: string;
  cuisine?: string;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  status?: 'open' | 'closed' | 'pending' | 'all';
}

const MAX_PAGE_LIMIT = 100;
const MAX_PAGE_NUMBER = 1000;
const MAX_MANUAL_SCAN_LIMIT = 500;
const MAX_MENU_LEGACY_LIMIT = 200;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class RestaurantsService {
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
    @Optional()
    @InjectModel(Review.name)
    private readonly reviewModel?: Model<ReviewDocument>,
    @Optional()
    @InjectModel(User.name)
    private readonly userModel?: Model<UserDocument>,
    @Optional()
    @InjectModel(FavoriteCollection.name)
    private readonly favoriteCollectionModel?: Model<FavoriteCollection>,
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

  async getMenuWithMeta(idOrSlug: string) {
    const restaurant = await this.findOne(idOrSlug);
    const filter = { restaurantId: restaurant._id };
    const [dbCount, fetched] = await Promise.all([
      this.menuItemModel.countDocuments(filter).exec(),
      this.menuItemModel
        .find(filter)
        .sort({ isFeatured: -1, createdAt: -1 })
        .limit(MAX_MENU_LEGACY_LIMIT + 1)
        .exec(),
    ]);

    const items = fetched.slice(0, MAX_MENU_LEGACY_LIMIT);
    const totalCount = Math.max(dbCount, fetched.length);
    const isTruncated =
      fetched.length > MAX_MENU_LEGACY_LIMIT || dbCount > MAX_MENU_LEGACY_LIMIT;

    return {
      items,
      totalCount,
      limit: MAX_MENU_LEGACY_LIMIT,
      isTruncated,
      successorEndpoint: `/api/v1/restaurants/${String(restaurant._id)}/dishes`,
    };
  }

  async getMenu(idOrSlug: string) {
    const { items } = await this.getMenuWithMeta(idOrSlug);
    return items;
  }

  async getAllMenuItemsWithMeta(search?: string, restaurantId?: string) {
    const filter: any = {};
    if (restaurantId && restaurantId !== 'all') {
      if (Types.ObjectId.isValid(restaurantId)) {
        filter.restaurantId = new Types.ObjectId(restaurantId);
      }
    }
    if (search) {
      filter.name = { $regex: escapeRegex(search.trim()), $options: 'i' };
    }
    const [dbCount, fetched] = await Promise.all([
      this.menuItemModel.countDocuments(filter).exec(),
      this.menuItemModel
        .find(filter)
        .populate('restaurantId', 'tenQuan diaChi')
        .sort({ isFeatured: -1, createdAt: -1 })
        .limit(MAX_MENU_LEGACY_LIMIT + 1)
        .exec(),
    ]);

    const items = fetched.slice(0, MAX_MENU_LEGACY_LIMIT);
    const totalCount = Math.max(dbCount, fetched.length);
    const isTruncated =
      fetched.length > MAX_MENU_LEGACY_LIMIT || dbCount > MAX_MENU_LEGACY_LIMIT;

    return {
      items,
      totalCount,
      limit: MAX_MENU_LEGACY_LIMIT,
      isTruncated,
      successorEndpoint: '/api/v1/dishes',
    };
  }

  async getAllMenuItems(search?: string, restaurantId?: string) {
    const { items } = await this.getAllMenuItemsWithMeta(search, restaurantId);
    return items;
  }

  private mapDishToDTO(raw: any) {
    const d = raw?.toObject ? raw.toObject() : raw;
    const populatedRest =
      d.restaurantId &&
      typeof d.restaurantId === 'object' &&
      '_id' in d.restaurantId
        ? d.restaurantId
        : null;
    const restaurantIdStr = populatedRest
      ? String(populatedRest._id)
      : d.restaurantId
        ? String(d.restaurantId)
        : null;

    return {
      id: d._id ? String(d._id) : d.id,
      _id: d._id ? String(d._id) : d.id,
      restaurantId: restaurantIdStr,
      ...(populatedRest
        ? {
            restaurant: {
              id: String(populatedRest._id),
              tenQuan: populatedRest.tenQuan,
              diaChi: populatedRest.diaChi,
              lat: populatedRest.lat,
              lon: populatedRest.lon,
              location: populatedRest.location ?? null,
            },
          }
        : {}),
      name: d.name,
      description: d.description || '',
      price: typeof d.price === 'number' ? d.price : Number(d.price) || 0,
      image: d.image || '',
      isVegetarian: Boolean(d.isVegetarian),
      calories: d.calories ?? null,
      tags: Array.isArray(d.tags) ? d.tags : [],
      isAvailable: d.isAvailable !== false,
      isFeatured: Boolean(d.isFeatured),
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    };
  }

  async findDishes(query: QueryDishesDto = {}) {
    const pageNum = Math.max(
      1,
      Math.min(MAX_PAGE_NUMBER, Math.floor(Number(query.page) || 1)),
    );
    const limitNum = Math.max(
      1,
      Math.min(MAX_PAGE_LIMIT, Math.floor(Number(query.limit) || 20)),
    );
    const skip = (pageNum - 1) * limitNum;

    if (
      query.minPrice !== undefined &&
      query.maxPrice !== undefined &&
      Number(query.minPrice) > Number(query.maxPrice)
    ) {
      throw new BadRequestException(
        'minPrice cannot be greater than maxPrice.',
      );
    }

    const andConditions: Array<Record<string, unknown>> = [];

    if (query.restaurantId && query.restaurantId !== 'all') {
      if (
        !Types.ObjectId.isValid(query.restaurantId) ||
        !/^[0-9a-fA-F]{24}$/.test(query.restaurantId)
      ) {
        throw new BadRequestException(
          `Invalid restaurantId "${query.restaurantId}". Expected a 24-character hex ObjectId.`,
        );
      }
      andConditions.push({
        restaurantId: new Types.ObjectId(query.restaurantId),
      });
    }

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      const priceRange: Record<string, number> = {};
      if (query.minPrice !== undefined) priceRange.$gte = Number(query.minPrice);
      if (query.maxPrice !== undefined) priceRange.$lte = Number(query.maxPrice);
      andConditions.push({ price: priceRange });
    }

    // Both `category` and `tag` map onto MenuItem.tags with explicit AND semantics
    // so providing both filters narrows results to dishes matching BOTH tags.
    const categoryVal = (query.category || '').trim();
    if (categoryVal && categoryVal !== 'all') {
      andConditions.push({
        tags: { $regex: new RegExp(escapeRegex(categoryVal), 'i') },
      });
    }

    const tagVal = (query.tag || '').trim();
    if (tagVal && tagVal !== 'all') {
      andConditions.push({
        tags: { $regex: new RegExp(escapeRegex(tagVal), 'i') },
      });
    }

    if (query.isAvailable === 'true') {
      andConditions.push({ isAvailable: true });
    } else if (query.isAvailable === 'false') {
      andConditions.push({ isAvailable: false });
    }

    if (query.isVegetarian === 'true') {
      andConditions.push({ isVegetarian: true });
    } else if (query.isVegetarian === 'false') {
      andConditions.push({ isVegetarian: false });
    }

    if (query.search && query.search.trim().length > 0) {
      const safeSearch = escapeRegex(query.search.trim());
      andConditions.push({
        $or: [
          { name: { $regex: safeSearch, $options: 'i' } },
          { description: { $regex: safeSearch, $options: 'i' } },
          { tags: { $regex: safeSearch, $options: 'i' } },
        ],
      });
    }

    const filter: Record<string, unknown> =
      andConditions.length === 0
        ? {}
        : andConditions.length === 1
          ? andConditions[0]
          : { $and: andConditions };

    const sortDir = query.order === 'asc' ? 1 : -1;
    const sortMap: Record<string, Record<string, 1 | -1>> = {
      price: { price: sortDir, _id: 1 },
      name: { name: sortDir, _id: 1 },
      createdAt: { createdAt: sortDir, _id: 1 },
      isFeatured: { isFeatured: -1, createdAt: -1 },
    };
    const sortSpec =
      (query.sortBy && sortMap[query.sortBy]) || sortMap.isFeatured;

    const [total, rawItems] = await Promise.all([
      this.menuItemModel.countDocuments(filter).exec(),
      this.menuItemModel
        .find(filter)
        .populate('restaurantId', 'tenQuan diaChi lat lon location')
        .sort(sortSpec)
        .skip(skip)
        .limit(limitNum)
        .lean()
        .exec(),
    ]);

    return {
      data: rawItems.map((item) => this.mapDishToDTO(item)),
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    };
  }

  async findDishesByRestaurant(idOrSlug: string, query: QueryDishesDto = {}) {
    const restaurant = await this.findOne(idOrSlug);
    return this.findDishes({
      ...query,
      restaurantId: String(restaurant._id),
    });
  }

  async findDishById(id: string) {
    if (!id || !Types.ObjectId.isValid(id) || !/^[0-9a-fA-F]{24}$/.test(id)) {
      throw new BadRequestException(
        `Invalid dish ID "${id}". Expected a 24-character hex ObjectId.`,
      );
    }

    const dish = await this.menuItemModel
      .findById(id)
      .populate('restaurantId', 'tenQuan diaChi lat lon location')
      .lean()
      .exec();

    if (!dish) {
      throw new NotFoundException(`Dish with ID "${id}" not found`);
    }

    return this.mapDishToDTO(dish);
  }

  async createMenuItem(restaurantId: string, dto: any) {
    let targetRestId: string | null = null;
    if (restaurantId && Types.ObjectId.isValid(restaurantId)) {
      const rest = await this.restaurantModel
        .findById(restaurantId)
        .lean()
        .exec();
      if (rest) {
        targetRestId = rest._id.toString();
      }
    } else if (restaurantId) {
      const rest = await this.restaurantModel
        .findOne({ slug: restaurantId })
        .lean()
        .exec();
      if (rest) targetRestId = rest._id.toString();
    }

    if (!targetRestId) {
      throw new NotFoundException(
        `Không tìm thấy nhà hàng "${restaurantId}" để thêm món ăn.`,
      );
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
      .findByIdAndUpdate(menuId, dto, { new: true, runValidators: true })
      .exec();
  }

  async deleteMenuItem(menuId: string) {
    return this.menuItemModel.findByIdAndDelete(menuId).exec();
  }

  async create(createRestaurantDto: any): Promise<RestaurantDocument> {
    const restaurantData: any = {
      ...createRestaurantDto,
      ...(createRestaurantDto.moTa && !createRestaurantDto.description
        ? { description: createRestaurantDto.moTa }
        : {}),
    };

    const hasLat =
      createRestaurantDto.lat !== undefined && createRestaurantDto.lat !== null;
    const hasLon =
      createRestaurantDto.lon !== undefined && createRestaurantDto.lon !== null;
    const hasLocation = createRestaurantDto.location !== undefined;

    if (hasLocation) {
      if (createRestaurantDto.location === null) {
        restaurantData.location = null;
        if (!hasLat && !hasLon) {
          delete restaurantData.lat;
          delete restaurantData.lon;
        }
      } else {
        if (!isValidGeoJsonPoint(createRestaurantDto.location)) {
          throw new BadRequestException(
            'Invalid GeoJSON location: must be { type: "Point", coordinates: [lon, lat] } within WGS84 bounds and non-[0,0]',
          );
        }
        const [lon, lat] = createRestaurantDto.location.coordinates;
        restaurantData.lat = lat;
        restaurantData.lon = lon;
        restaurantData.location = { type: 'Point', coordinates: [lon, lat] };
      }
    } else if (hasLat || hasLon) {
      const geoPoint = toGeoJsonPoint(
        createRestaurantDto.lat,
        createRestaurantDto.lon,
      );
      if (!geoPoint) {
        throw new BadRequestException(
          'Invalid restaurant coordinates: lat [-90..90] and lon [-180..180] must both be valid numbers and not [0, 0]',
        );
      }
      restaurantData.lon = geoPoint.coordinates[0];
      restaurantData.lat = geoPoint.coordinates[1];
      restaurantData.location = geoPoint;
    } else {
      delete restaurantData.lat;
      delete restaurantData.lon;
      restaurantData.location = null;
    }

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
    const searchCenter = parseValidCoordinatePair(lat, lon);
    if (!searchCenter) {
      throw new BadRequestException(
        'Valid non-zero latitude and longitude are required for nearby search',
      );
    }

    const radiusMeters = Math.max(1, Number(radiusKm) || 5) * 1000;
    const matchStage: any = {
      status: { $ne: 'closed' },
      'location.type': 'Point',
      'location.coordinates.0': { $type: 'number', $gte: -180, $lte: 180 },
      'location.coordinates.1': { $type: 'number', $gte: -90, $lte: 90 },
      'location.coordinates': { $ne: [0, 0] },
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
              coordinates: [searchCenter.lon, searchCenter.lat],
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
          const point = extractValidGeoPoint(item);
          if (!point) return null;
          const dist = this.getDistanceFromLatLonInKm(
            searchCenter.lat,
            searchCenter.lon,
            point.lat,
            point.lon,
          );
          if (dist > radiusKm) return null;
          const dto = this.mapRestaurantToDTO(item);
          dto.distance = Number(dist.toFixed(2));
          return dto;
        })
        .filter((item: any): item is any => item !== null);

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
            'X-Internal-AI-Key': this.internalAiKey,
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

      const headers: Record<string, string> = {
        'X-Internal-AI-Key': this.internalAiKey,
      };
      const aiResponse = await firstValueFrom(
        this.httpService.post(`${aiUrl}/weather-recommend`, payload, {
          headers,
        }),
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
      } catch (error: unknown) {
        const reason =
          error instanceof Error ? error.message : 'Unknown nearby error';
        this.logger.warn(
          `Fallback nearby search failed; falling back to top-rated list: ${reason}`,
        );
      }
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
    const {
      rating: normalizedRating,
      rawRating,
      ratingScale,
      isAmbiguous: isAmbiguousRating,
    } = normalizeRestaurantRating(r);
    const normalizedTags = normalizeRestaurantTags(r.tags);
    const formattedTags = formatRestaurantTagsString(r.tags);

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
      rawRating,
      ratingScale,
      isAmbiguousRating,
      priceRange: r.giaCa || r.priceRange || '30.000đ - 150.000đ',
      giaCa: r.giaCa || r.priceRange || '30.000đ - 150.000đ',
      openingHours:
        r.gioMoCua || r.openingHours || r.openTime || '08:00 - 22:00',
      gioMoCua: r.gioMoCua || r.openingHours || r.openTime || '08:00 - 22:00',
      openTime: r.gioMoCua || r.openingHours || r.openTime || '08:00 - 22:00',
      cuisineTypes: normalizedTags.length > 0 ? normalizedTags : ['Nhà hàng'],
      tags: formattedTags,
      phone: r.contactPhone || r.phone || '0901 234 567',
      contactPhone: r.contactPhone || r.phone || '0901 234 567',
      description: r.description || '',
      lat: r.lat,
      lon: r.lon ?? r.lng,
      lng: r.lon ?? r.lng,
      location: r.location ?? null,
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
    extraFilters: RestaurantListExtraFilters = {},
  ): Promise<any> {
    const pageNum = Math.max(
      1,
      Math.min(MAX_PAGE_NUMBER, Math.floor(Number(page) || 1)),
    );
    const limitNum = Math.max(
      1,
      Math.min(MAX_PAGE_LIMIT, Math.floor(Number(limit) || 32)),
    );
    const skip = (pageNum - 1) * limitNum;

    if (
      extraFilters.minPrice !== undefined &&
      extraFilters.maxPrice !== undefined &&
      Number(extraFilters.minPrice) > Number(extraFilters.maxPrice)
    ) {
      throw new BadRequestException(
        'minPrice cannot be greater than maxPrice.',
      );
    }

    // 1. Setup Sort
    const sortOptions: any = {};
    const effectiveSortBy = sortBy === 'rating' ? 'diemTrungBinh' : sortBy;
    const allowedSortFields = [
      'diemTrungBinh',
      'diemKhongGian',
      'diemViTri',
      'diemChatLuong',
      'diemPhucVu',
      'diemGiaCa',
    ];
    const sortField =
      allowedSortFields.includes(effectiveSortBy) &&
      effectiveSortBy !== 'default'
        ? effectiveSortBy
        : 'diemTrungBinh';
    const sortDirection = order === 'asc' ? 1 : -1;
    sortOptions[sortField] = sortDirection;

    // 2. Setup Filter
    const andConditions: Array<Record<string, unknown>> = [];
    if (extraFilters.status && extraFilters.status !== 'all') {
      andConditions.push({ status: extraFilters.status });
    }

    if (city) {
      if (city === 'hanoi') {
        andConditions.push({
          diaChi: {
            $regex:
              /Hà Nội|Ha Noi|HN|Hanoi|Ba Đình|Ba Dinh|Hoàn Kiếm|Hoan Kiem|Tây Hồ|Tay Ho|Long Biên|Long Bien|Cầu Giấy|Cau Giay|Đống Đa|Dong Da|Hai Bà Trưng|Hai Ba Trung|Hoàng Mai|Hoang Mai|Thanh Xuân|Thanh Xuan|Sóc Sơn|Soc Son|Đông Anh|Dong Anh|Gia Lâm|Gia Lam|Nam Từ Liêm|Nam Tu Liem|Bắc Từ Liêm|Bac Tu Liem|Thanh Trì|Thanh Tri|Hà Đông|Ha Dong|Sơn Tây|Son Tay/i,
          },
        });
      } else if (city === 'hcmc') {
        andConditions.push({
          diaChi: {
            $regex:
              /Hồ Chí Minh|Ho Chi Minh|TP\.?\s?HCM|TPHCM|Sài Gòn|Sai Gon|HCM|Thủ Đức|Thu Duc|Gò Vấp|Go Vap|Bình Thạnh|Binh Thanh|Tân Bình|Tan Binh|Tân Phú|Tan Phu|Phú Nhuận|Phu Nhuan|Bình Tân|Binh Tan|Củ Chi|Cu Chi|Hóc Môn|Hoc Mon|Bình Chánh|Binh Chanh|Nhà Bè|Nha Be|Cần Giờ|Can Gio|Quận\s?1|District\s?1|Q\.?1|Quận\s?3|District\s?3|Q\.?3|Quận\s?4|District\s?4|Q\.?4|Quận\s?5|District\s?5|Q\.?5|Quận\s?6|District\s?6|Q\.?6|Quận\s?7|District\s?7|Q\.?7|Quận\s?8|District\s?8|Q\.?8|Quận\s?10|District\s?10|Q\.?10|Quận\s?11|District\s?11|Q\.?11|Quận\s?12|District\s?12|Q\.?12/i,
          },
        });
      } else {
        const safeCity = escapeRegex(city.trim());
        andConditions.push({
          $or: [
            { cityId: { $regex: new RegExp(`^${safeCity}$`, 'i') } },
            { diaChi: { $regex: safeCity, $options: 'i' } },
          ],
        });
      }
    }

    const districtOrArea = (
      extraFilters.district ||
      extraFilters.area ||
      ''
    ).trim();
    if (districtOrArea) {
      andConditions.push({
        diaChi: { $regex: escapeRegex(districtOrArea), $options: 'i' },
      });
    }

    const scoreFieldToCheck = sortField;
    if (extraFilters.minRating !== undefined) {
      const minR = Number(extraFilters.minRating);
      andConditions.push({
        $or: [
          { [scoreFieldToCheck]: { $gte: minR * 2 } },
          { [scoreFieldToCheck]: { $gte: minR, $lte: 5.0 } },
        ],
      });
    } else if (rating && rating !== 'all') {
      switch (rating) {
        case 'gte4_5':
        case 'gte9':
          andConditions.push({
            $or: [
              { [scoreFieldToCheck]: { $gte: 9.0 } },
              { [scoreFieldToCheck]: { $gte: 4.5, $lte: 5.0 } },
            ],
          });
          break;
        case 'gte4':
        case '8to9':
          andConditions.push({
            $or: [
              { [scoreFieldToCheck]: { $gte: 8.0 } },
              { [scoreFieldToCheck]: { $gte: 4.0, $lte: 5.0 } },
            ],
          });
          break;
        case 'gte3_5':
        case '7to8':
          andConditions.push({
            $or: [
              { [scoreFieldToCheck]: { $gte: 7.0 } },
              { [scoreFieldToCheck]: { $gte: 3.5, $lte: 5.0 } },
            ],
          });
          break;
        case 'gte3':
        case '6to7':
          andConditions.push({
            $or: [
              { [scoreFieldToCheck]: { $gte: 6.0 } },
              { [scoreFieldToCheck]: { $gte: 3.0, $lte: 5.0 } },
            ],
          });
          break;
        case 'lt6':
          andConditions.push({ [scoreFieldToCheck]: { $lt: 6.0 } });
          break;
      }
    }

    const combinedTags = [tags, extraFilters.cuisine]
      .filter((t) => typeof t === 'string' && t.trim() && t.trim() !== 'Tất cả')
      .join(',');
    if (combinedTags) {
      const tagList = combinedTags
        .split(',')
        .map((t) => escapeRegex(t.trim()))
        .filter(Boolean);
      if (tagList.length > 0) {
        andConditions.push({
          tags: { $regex: new RegExp(tagList.join('|'), 'i') },
        });
      }
    }

    // Logic gọi AI (Text Search)
    const aiIndexMap: Record<string, number> = {};
    let isAiSearch = false;
    if (search && search.trim() !== '') {
      const safeSearch = escapeRegex(search.trim());
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
        const headers: Record<string, string> = {
          'X-Internal-AI-Key': this.internalAiKey,
        };
        const aiResponse = await firstValueFrom(
          this.httpService.post(`${aiUrl}/recommend`, payload, {
            headers,
          }),
        );

        const recommendedItems = aiResponse.data.scores || [];
        const recommendedIds = recommendedItems.map((item: any) => item.id);

        if (recommendedIds.length > 0) {
          andConditions.push({ _id: { $in: recommendedIds } });
          recommendedItems.forEach((item: any, index: number) => {
            aiIndexMap[item.id] = index;
          });
        } else {
          andConditions.push({
            $or: [
              { tenQuan: { $regex: safeSearch, $options: 'i' } },
              { name: { $regex: safeSearch, $options: 'i' } },
              { tags: { $regex: safeSearch, $options: 'i' } },
              { cuisines: { $regex: safeSearch, $options: 'i' } },
              { diaChi: { $regex: safeSearch, $options: 'i' } },
              { address: { $regex: safeSearch, $options: 'i' } },
            ],
          });
          isAiSearch = false;
        }
      } catch (error: any) {
        console.error('Lỗi kết nối AI:', error.message);
        andConditions.push({
          $or: [
            { tenQuan: { $regex: safeSearch, $options: 'i' } },
            { name: { $regex: safeSearch, $options: 'i' } },
            { tags: { $regex: safeSearch, $options: 'i' } },
            { cuisines: { $regex: safeSearch, $options: 'i' } },
            { diaChi: { $regex: safeSearch, $options: 'i' } },
            { address: { $regex: safeSearch, $options: 'i' } },
          ],
        });
        isAiSearch = false;
      }
    }

    const filterQuery: Record<string, unknown> =
      andConditions.length === 0
        ? {}
        : andConditions.length === 1
          ? andConditions[0]
          : { $and: andConditions };

    // 3. Xác định chế độ xử lý
    const isOpenNowBool = openNow === 'true';
    const isSortDistance = sortBy === 'distance' && userLat && userLon;
    const isPriceFilterOrSort =
      extraFilters.minPrice !== undefined ||
      extraFilters.maxPrice !== undefined ||
      sortBy === 'price';
    const isManualProcessing =
      isOpenNowBool || isSortDistance || isAiSearch || isPriceFilterOrSort;

    let data: any[] = [];
    let total = 0;
    let isBoundedResult = false;
    let totalMatchingBeforePostFilter: number | undefined;

    if (isManualProcessing) {
      const rawMatchingTotal = await this.restaurantModel
        .countDocuments(filterQuery)
        .exec();
      const manualCursor = this.restaurantModel.find(filterQuery);
      const sortedManualCursor =
        typeof manualCursor.sort === 'function'
          ? manualCursor.sort(sortOptions)
          : manualCursor;
      const fetchedCandidates = await sortedManualCursor
        .limit(MAX_MANUAL_SCAN_LIMIT + 1)
        .lean()
        .exec();

      isBoundedResult =
        fetchedCandidates.length > MAX_MANUAL_SCAN_LIMIT ||
        rawMatchingTotal > MAX_MANUAL_SCAN_LIMIT;
      if (isBoundedResult) {
        totalMatchingBeforePostFilter = Math.max(
          rawMatchingTotal,
          fetchedCandidates.length,
        );
      }
      let allCandidates = fetchedCandidates.slice(0, MAX_MANUAL_SCAN_LIMIT);

      if (userLat && userLon) {
        const userPoint = parseValidCoordinatePair(userLat, userLon);
        if (userPoint) {
          allCandidates = allCandidates.map((res: any) => {
            const point = extractValidGeoPoint(res);
            const dist = point
              ? this.getDistanceFromLatLonInKm(
                  userPoint.lat,
                  userPoint.lon,
                  point.lat,
                  point.lon,
                )
              : null;
            return { ...res, distance: dist };
          });
        }
      }

      const hasInMemoryPostFilter =
        isOpenNowBool ||
        extraFilters.minPrice !== undefined ||
        extraFilters.maxPrice !== undefined;

      if (isOpenNowBool) {
        allCandidates = allCandidates.filter((res: any) =>
          this.checkIsOpen(res.openingTime || res.gioMoCua),
        );
      }

      if (
        extraFilters.minPrice !== undefined ||
        extraFilters.maxPrice !== undefined
      ) {
        allCandidates = allCandidates.filter((res: any) => {
          const parsedVnd = parseRestaurantPriceVnd(res.giaCa || res.priceRange);
          if (
            extraFilters.minPrice !== undefined &&
            parsedVnd < Number(extraFilters.minPrice)
          ) {
            return false;
          }
          if (
            extraFilters.maxPrice !== undefined &&
            parsedVnd > Number(extraFilters.maxPrice)
          ) {
            return false;
          }
          return true;
        });
      }

      if (isAiSearch && sortField === 'diemTrungBinh' && sortBy !== 'price') {
        allCandidates.sort((a: any, b: any) => {
          if (order === 'asc') {
            return (a.diemTrungBinh || 0) - (b.diemTrungBinh || 0);
          }
          const idxA = aiIndexMap[a._id.toString()] ?? 9999;
          const idxB = aiIndexMap[b._id.toString()] ?? 9999;
          return idxA - idxB;
        });
      } else if (sortBy === 'price') {
        allCandidates.sort((a: any, b: any) => {
          const pA = parseRestaurantPriceVnd(a.giaCa || a.priceRange);
          const pB = parseRestaurantPriceVnd(b.giaCa || b.priceRange);
          return sortDirection === 1 ? pA - pB : pB - pA;
        });
      } else if (isSortDistance) {
        allCandidates.sort((a: any, b: any) => {
          const dA =
            typeof a.distance === 'number'
              ? a.distance
              : Number.POSITIVE_INFINITY;
          const dB =
            typeof b.distance === 'number'
              ? b.distance
              : Number.POSITIVE_INFINITY;
          return order === 'asc' ? dA - dB : dB - dA;
        });
      } else {
        allCandidates.sort((a: any, b: any) => {
          const valA = a[sortField] || 0;
          const valB = b[sortField] || 0;
          return sortDirection === 1 ? valA - valB : valB - valA;
        });
      }

      total = hasInMemoryPostFilter
        ? allCandidates.length
        : Math.max(rawMatchingTotal, allCandidates.length);
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
      page: pageNum,
      limit: limitNum,
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum),
      sortBy: sortBy,
      order: order,
      isBoundedResult,
      ...(isBoundedResult
        ? {
            evaluatedWindowLimit: MAX_MANUAL_SCAN_LIMIT,
            totalMatchingBeforePostFilter,
          }
        : {}),
    };
  }

  async findOne(idOrSlug: string): Promise<RestaurantDocument> {
    if (!idOrSlug || !/^[a-zA-Z0-9_-]{1,128}$/.test(idOrSlug)) {
      throw new BadRequestException(
        `Invalid restaurant ID or slug "${idOrSlug}".`,
      );
    }

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
      const safeSlug = escapeRegex(idOrSlug);
      restaurant = await this.restaurantModel
        .findOne({
          urlGoc: { $regex: `${safeSlug}$`, $options: 'i' },
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

    const dto = { ...updateRestaurantDto };

    // Đồng bộ & validate GeoJSON Point location khi lat/lon hoặc location được cập nhật
    if (dto.location !== undefined) {
      if (dto.location === null) {
        dto.location = null;
        if (dto.lat === undefined) dto.lat = null;
        if (dto.lon === undefined) dto.lon = null;
      } else if (!isValidGeoJsonPoint(dto.location)) {
        throw new BadRequestException(
          'Invalid GeoJSON location: must be { type: "Point", coordinates: [lon, lat] } within WGS84 bounds and non-[0,0]',
        );
      } else {
        dto.lon = dto.location.coordinates[0];
        dto.lat = dto.location.coordinates[1];
      }
    } else if (dto.lat !== undefined || dto.lon !== undefined) {
      if (dto.lat === null && dto.lon === null) {
        dto.location = null;
      } else {
        const existing = await this.restaurantModel.findById(id).lean();
        if (!existing) {
          throw new NotFoundException(`Không tìm thấy nhà hàng với ID "${id}"`);
        }
        const mergedLat = dto.lat !== undefined ? dto.lat : existing.lat;
        const mergedLon = dto.lon !== undefined ? dto.lon : existing.lon;
        const geoPoint = toGeoJsonPoint(mergedLat, mergedLon);
        if (!geoPoint) {
          throw new BadRequestException(
            'Invalid restaurant coordinates: lat [-90..90] and lon [-180..180] must be valid numbers and not [0, 0]',
          );
        }
        dto.lon = geoPoint.coordinates[0];
        dto.lat = geoPoint.coordinates[1];
        dto.location = geoPoint;
      }
    }

    const payload = {
      ...dto,
      ...(dto.moTa && !dto.description ? { description: dto.moTa } : {}),
    };

    const updated = await this.restaurantModel
      .findByIdAndUpdate(id, payload, { new: true, runValidators: true })
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
    const deleted = await this.restaurantModel.findByIdAndDelete(id).exec();
    if (!deleted) {
      throw new NotFoundException(`Không tìm thấy nhà hàng với ID "${id}"`);
    }

    const restObjId = new Types.ObjectId(id);

    // Cascade delete dependent child records & pull dangling bookmark references
    await Promise.all([
      this.menuItemModel.deleteMany({ restaurantId: restObjId }),
      this.reviewModel?.deleteMany({ restaurantId: restObjId }),
      this.userModel?.updateMany(
        { savedRestaurants: restObjId },
        { $pull: { savedRestaurants: restObjId } },
      ),
      this.favoriteCollectionModel?.updateMany(
        { restaurantIds: restObjId },
        { $pull: { restaurantIds: restObjId } },
      ),
    ]);

    return deleted;
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
        } catch (error: unknown) {
          const reason =
            error instanceof Error ? error.message : 'Unknown TasteDNA error';
          this.logger.warn(
            `Unable to load TasteDNA profile for AI chat; continuing without taste vector: ${reason}`,
          );
        }
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

  /**
   * [M10.3] Dry-run restaurant data quality validation & normalization preview (no DB writes).
   */
  validateDataQuality(dto: ValidateRestaurantDataQualityDto) {
    const hasRawContent = dto.rawContent !== undefined;
    const hasRecords = dto.records !== undefined;
    if (!hasRawContent && !hasRecords) {
      throw new BadRequestException(
        'Either rawContent or records array is required for data quality validation.',
      );
    }
    if (hasRawContent && hasRecords) {
      throw new BadRequestException(
        'Provide exactly one of rawContent or records, not both simultaneously.',
      );
    }

    try {
      const evaluated = evaluateRestaurantDataQuality({
        rawContent: dto.rawContent,
        records: dto.records,
        format: dto.format,
        source: dto.source,
        batchId: dto.batchId,
        maxRejectedSample: dto.maxRejectedSample,
      });

      return {
        batchId: evaluated.batchId,
        source: evaluated.source,
        dryRun: true,
        validationStatus: evaluated.report.overallQualityStatus,
        validatedRestaurants: evaluated.validatedCandidates,
        rejectedRecords: evaluated.rejectedRecords,
        fieldErrors: evaluated.errors,
        warnings: evaluated.warnings,
        infos: evaluated.infos,
        dataQualitySummary: evaluated.report,
      };
    } catch (err) {
      if (err instanceof IngestionValidationError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }
}
