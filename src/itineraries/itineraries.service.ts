import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Itinerary } from './schemas/itinerary.schema';
import { Restaurant } from '../restaurants/schemas/restaurant.schema';
import { GenerateItineraryDto } from './dto/generate-itinerary.dto';
import { ReorderStopsDto } from './dto/reorder-stops.dto';
import { AddStopDto } from './dto/add-stop.dto';
import { RecalculateItineraryDto } from './dto/recalculate-itinerary.dto';
import { TasteDnaService } from '../taste-dna/taste-dna.service';
import { InteractionsService } from '../interactions/interactions.service';
import { randomUUID as uuidv4 } from 'crypto';

export function calculateHaversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 1.5;
  const R = 6371; // km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c * 1.35).toFixed(2)); // Hệ số uốn khúc đường bộ thực tế HCM 1.35x
}

export function parseTimeToMinutes(timeStr?: string): number {
  if (!timeStr) return 660; // 11:00 AM mặc định
  const match = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (match) {
    return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
  }
  return 660;
}

export function formatMinutesToTime(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}`;
}

export function calculateTasteAffinityScore(
  restaurant: any,
  profile: any,
): number {
  if (!profile) return 0.5;
  let score = 0.5;
  const tags = (restaurant.tags || '').toLowerCase();
  const name = (restaurant.tenQuan || '').toLowerCase();
  const combined = `${tags} ${name}`;

  if (profile.dietaryRestrictions && profile.dietaryRestrictions.length > 0) {
    for (const rstr of profile.dietaryRestrictions) {
      if (/chay|vegetarian/i.test(rstr) && !/chay/i.test(combined)) {
        score -= 0.3;
      }
    }
  }

  if (profile.spicy > 0.7 && /cay|lẩu|nướng|ớt/i.test(combined)) {
    score += 0.2;
  } else if (profile.spicy < 0.3 && /cay|ớt/i.test(combined)) {
    score -= 0.2;
  }

  if (
    profile.sweet > 0.7 &&
    /chè|trà sữa|kem|bánh ngọt|tráng miệng/i.test(combined)
  ) {
    score += 0.2;
  }

  if (profile.favoriteCuisines && profile.favoriteCuisines.length > 0) {
    for (const fav of profile.favoriteCuisines) {
      if (combined.includes(fav.toLowerCase())) {
        score += 0.25;
        break;
      }
    }
  }

  return Math.max(0, Math.min(1.0, score));
}

@Injectable()
export class ItinerariesService {
  private readonly logger = new Logger(ItinerariesService.name);

  constructor(
    @InjectModel(Itinerary.name) private itineraryModel: Model<Itinerary>,
    @InjectModel(Restaurant.name) private restaurantModel: Model<Restaurant>,
    private readonly httpService: HttpService,
    private readonly tasteDnaService: TasteDnaService,
    private readonly interactionsService: InteractionsService,
  ) {}

  public inferMealType(tags: string, name: string): string {
    const combined = `${tags} ${name}`.toLowerCase();
    if (/cà phê|cafe|trà sữa|nước|sinh tố/i.test(combined)) return 'cafe';
    if (/chè|bánh ngọt|kem|tráng miệng/i.test(combined)) return 'dessert';
    if (/ăn vặt|khai vị|bánh mì|gỏi cuốn|salad/i.test(combined))
      return 'starter';
    return 'main';
  }

  public recalculateTimetableAndMetrics(
    stops: any[],
    startLat: number,
    startLng: number,
    startTimeStr: string,
    routingMode: string = 'motorbike',
    budget: number = 250000,
  ) {
    let prevLat = startLat;
    let prevLng = startLng;
    const startMins = parseTimeToMinutes(startTimeStr);
    let currTimeMins = startMins;
    let totalDistKm = 0;
    let totalCost = 0;

    const speeds: Record<string, number> = {
      motorbike: 24.0,
      car: 18.0,
      walking: 4.5,
    };
    const speed = speeds[routingMode] || 24.0;

    const updatedStops = stops.map((stop, idx) => {
      const sLat = Number(stop.restaurant_lat || stop.lat) || startLat;
      const sLng =
        Number(stop.restaurant_lng || stop.lon || stop.lng) || startLng;
      const dist = calculateHaversineDistanceKm(prevLat, prevLng, sLat, sLng);
      totalDistKm += dist;
      prevLat = sLat;
      prevLng = sLng;

      const transitMins = Math.max(3, Math.round((dist / speed) * 60));
      const arrivalMins = currTimeMins + transitMins;
      const diningMins = stop.dining_duration_mins || 45;
      const departureMins = arrivalMins + diningMins;
      currTimeMins = departureMins;

      const cost = stop.estimated_cost || 50000;
      totalCost += cost;

      return {
        stop_id: stop.stop_id || uuidv4(),
        restaurant_id: stop.restaurant_id?._id || stop.restaurant_id,
        order_index: idx + 1,
        restaurant_name: stop.restaurant_name,
        restaurant_lat: sLat,
        restaurant_lng: sLng,
        meal_type:
          stop.meal_type ||
          this.inferMealType(stop.tags || '', stop.restaurant_name || ''),
        arrival_time: formatMinutesToTime(arrivalMins),
        departure_time: formatMinutesToTime(departureMins),
        dining_duration_mins: diningMins,
        transit_time_mins: transitMins,
        distance_to_next_km: Number(dist.toFixed(2)),
        estimated_cost: cost,
        tags: stop.tags || '',
      };
    });

    const totalDurationMins = currTimeMins - startMins;
    const remainingBudget = Math.max(0, budget - totalCost);
    const detourDist = totalDistKm * 1.35;
    const distSaved = Math.max(0.5, detourDist - totalDistKm);
    const co2SavedKg = Math.round(distSaved * 0.104 * 10) / 10;

    return {
      stops: updatedStops,
      total_distance_km: Number(totalDistKm.toFixed(2)),
      total_duration_mins: Math.max(0, totalDurationMins),
      total_cost: totalCost,
      remaining_budget: remainingBudget,
      co2SavedKg: Math.max(0.5, co2SavedKg),
    };
  }

  async generateItinerary(
    userId: string,
    dto: GenerateItineraryDto,
  ): Promise<Itinerary> {
    const prompt = dto.prompt.toLowerCase();
    const desiredStops = Math.max(1, Math.min(dto.stop_count || 3, 10));
    const routingMode = dto.routing_mode || 'motorbike';
    const userLat = dto.lat || 10.7769;
    const userLng = dto.lng || 106.7009;
    const userBudget = dto.budget || 250000;
    const startMins = parseTimeToMinutes(dto.start_time);

    // 1. Phân tích từ khóa món ăn
    const keywordMap: Record<string, string> = {
      chay: 'ĐỒ CHAY',
      uống: 'ĐỒ UỐNG',
      'tráng miệng': 'TRÁNG MIỆNG',
      lẩu: 'MÓN LẨU',
      'ăn vặt': 'ĐỒ ĂN',
      nướng: 'MÓN NƯỚNG',
      'hải sản': 'HẢI SẢN',
      pizza: 'PIZZA',
      sushi: 'SUSHI',
      cafe: 'CAFE',
      'cà phê': 'CAFE',
      'trà sữa': 'TRÀ SỮA',
      phở: 'PHỞ',
      bún: 'BÚN',
      cơm: 'CƠM',
      'bánh mì': 'BÁNH MÌ',
      mì: 'MÌ',
    };

    let selectedTag = '';
    for (const [key, tag] of Object.entries(keywordMap)) {
      if (prompt.includes(key)) {
        selectedTag = tag;
        break;
      }
    }

    // Xác định quận/huyện
    let districtRegex: string | null = null;
    let districtDisplay: string | null = null;
    const qNumMatch = prompt.match(/(?:quận|q\.?)\s*(\d+)/i);
    if (qNumMatch) {
      districtRegex = `(quận|q\\.?)\\s*0?${qNumMatch[1]}\\b`;
      districtDisplay = `Quận ${qNumMatch[1]}`;
    } else {
      const nameDistricts = [
        'thủ đức',
        'bình thạnh',
        'gò vấp',
        'phú nhuận',
        'tân bình',
        'tân phú',
        'bình tân',
        'nhà bè',
        'hóc môn',
        'củ chi',
        'cần giờ',
        'bình chánh',
      ];
      for (const name of nameDistricts) {
        if (prompt.includes(name)) {
          districtRegex = name;
          districtDisplay = name.charAt(0).toUpperCase() + name.slice(1);
          break;
        }
      }
    }

    // [TASK-BIZ-02-01] Tìm kiếm ứng viên nhà hàng
    const query: any = { status: { $ne: 'closed' } };
    if (districtRegex) {
      query.diaChi = { $regex: new RegExp(districtRegex, 'i') };
    }
    if (selectedTag) {
      query.tags = { $regex: new RegExp(selectedTag, 'i') };
    } else {
      const cleanPrompt = prompt
        .replace(
          /(?:tôi|muốn|tìm|gợi ý|quán|nhà hàng|cho|mình|ở|tại|khu vực|ăn|uống|đi|giúp|với|nhé|nào|được)/gi,
          ' ',
        )
        .trim();
      const keywords = cleanPrompt.split(/\s+/).filter((w) => w.length > 1);
      if (keywords.length > 0) {
        const searchPattern = keywords.slice(0, 3).join('|');
        query.$or = [
          { tenQuan: { $regex: new RegExp(searchPattern, 'i') } },
          { tags: { $regex: new RegExp(searchPattern, 'i') } },
          { description: { $regex: new RegExp(searchPattern, 'i') } },
        ];
      }
    }

    let restaurants = await this.restaurantModel
      .find(query)
      .sort({ isFeatured: -1, diemTrungBinh: -1 })
      .limit(12)
      .exec();

    if (!restaurants || restaurants.length === 0) {
      const fallbackQuery: any = { status: { $ne: 'closed' } };
      if (districtRegex) {
        fallbackQuery.diaChi = { $regex: new RegExp(districtRegex, 'i') };
      }
      restaurants = await this.restaurantModel
        .find(fallbackQuery)
        .sort({ isFeatured: -1, diemTrungBinh: -1 })
        .limit(12)
        .exec();
    }

    if (!restaurants || restaurants.length === 0) {
      restaurants = await this.restaurantModel
        .find({ status: { $ne: 'closed' } })
        .sort({ isFeatured: -1, diemTrungBinh: -1 })
        .limit(12)
        .exec();
    }

    // [TASK-BIZ-02-01] Lấy hồ sơ Taste DNA của người dùng để tính điểm khẩu vị
    let tasteProfile: any = null;
    try {
      if (userId && Types.ObjectId.isValid(userId)) {
        tasteProfile = await this.tasteDnaService.getProfile(userId);
      }
    } catch (err: any) {
      this.logger.debug(
        `Could not load Taste DNA for user ${userId}: ${err.message}`,
      );
    }

    // Xếp hạng ứng viên bằng mô hình kết hợp: Rating (40%) + Taste DNA (30%) + Khoảng cách (30%)
    const scoredCandidates = restaurants.map((r) => {
      const rLat = Number(r.lat) || userLat;
      const rLng = Number(r.lon) || userLng;
      const dist = calculateHaversineDistanceKm(userLat, userLng, rLat, rLng);
      const rating = Number(r.diemTrungBinh) || 4.0;
      const tasteScore = calculateTasteAffinityScore(r, tasteProfile);
      const proximityScore = Math.max(0, 1 - dist / 25);
      const compositeScore =
        (rating / 5.0) * 0.4 + tasteScore * 0.3 + proximityScore * 0.3;

      const hours = (r.gioMoCua || '08:00 - 22:00').split('-');
      return {
        id: r._id.toString(),
        name: r.tenQuan || 'Nhà hàng GastroWise',
        lat: rLat,
        lon: rLng,
        meal_type: this.inferMealType(r.tags || '', r.tenQuan || ''),
        open_time: hours[0]?.trim() || '08:00',
        close_time: hours[1]?.trim() || '22:00',
        dining_duration_mins: 45,
        avg_price: 50000,
        rating: rating,
        tags: r.tags || '',
        compositeScore,
      };
    });

    scoredCandidates.sort((a, b) => b.compositeScore - a.compositeScore);

    // [TASK-BIZ-02-05] Gọi AI Route Optimizer (FastAPI + OR-Tools TSPTW)
    let optimizedStops: any[] = [];
    let totalDistKm = 0;
    let totalDurationMins = 150;
    let totalCost = 0;
    let remainingBudget = userBudget;
    let co2Saved = 1.5;
    let optimizedBy = 'OR-Tools TSPTW';

    try {
      const aiUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:5000';
      this.logger.log(
        `Calling AI Route Optimizer: ${aiUrl}/routes/optimize with desired_stops=${desiredStops}...`,
      );

      const aiResponse = await firstValueFrom(
        this.httpService.post(
          `${aiUrl}/routes/optimize`,
          {
            start_location: [userLat, userLng],
            start_time_mins: startMins,
            budget: userBudget,
            routing_mode: routingMode,
            desired_stops: desiredStops,
            candidates: scoredCandidates.slice(0, 8),
          },
          { timeout: 3500 },
        ),
      );

      if (aiResponse?.data?.stops && aiResponse.data.stops.length > 0) {
        const aiData = aiResponse.data;
        totalDistKm = aiData.total_distance_km;
        totalDurationMins = aiData.total_duration_mins;
        totalCost = aiData.total_cost || aiData.stops.length * 50000;
        remainingBudget =
          aiData.remaining_budget !== undefined
            ? aiData.remaining_budget
            : Math.max(0, userBudget - totalCost);
        co2Saved = aiData.co2_saved_kg;
        optimizedBy = aiData.algorithm_used || 'OR-Tools TSPTW';

        optimizedStops = aiData.stops.map((s: any) => ({
          stop_id: uuidv4(),
          restaurant_id: new Types.ObjectId(s.id),
          order_index: s.order_index,
          restaurant_name: s.name,
          restaurant_lat: s.lat,
          restaurant_lng: s.lon,
          meal_type: s.meal_type,
          arrival_time: s.arrival_time,
          departure_time: s.departure_time,
          dining_duration_mins: s.dining_duration_mins,
          transit_time_mins: s.transit_time_mins,
          distance_to_next_km: s.distance_to_next_km,
          estimated_cost: s.estimated_cost,
          tags: s.tags || '',
        }));
      }
    } catch (aiErr: any) {
      this.logger.warn(
        `AI Route Optimizer offline, falling back to local heuristic: ${aiErr.message}`,
      );
    }

    // [TASK-BIZ-02-05 Fallback] Fallback sang Gastronomic Progression Heuristic nếu AI service không phản hồi
    if (optimizedStops.length === 0) {
      optimizedBy = 'Gastronomic Progression Heuristic';
      const selected = scoredCandidates.slice(0, desiredStops);

      const metrics = this.recalculateTimetableAndMetrics(
        selected.map((c) => ({
          restaurant_id: new Types.ObjectId(c.id),
          restaurant_name: c.name,
          restaurant_lat: c.lat,
          restaurant_lng: c.lon,
          meal_type: c.meal_type,
          tags: c.tags,
          estimated_cost: c.avg_price,
          dining_duration_mins: c.dining_duration_mins,
        })),
        userLat,
        userLng,
        dto.start_time || '11:00',
        routingMode,
        userBudget,
      );

      optimizedStops = metrics.stops;
      totalDistKm = metrics.total_distance_km;
      totalDurationMins = metrics.total_duration_mins;
      totalCost = metrics.total_cost;
      remainingBudget = metrics.remaining_budget;
      co2Saved = metrics.co2SavedKg;
    }

    const title = `Lộ trình ${selectedTag ? selectedTag.toLowerCase() : 'ẩm thực'} ${districtDisplay ? `tại ${districtDisplay}` : 'Sài Gòn'}`;

    // Lưu vào MongoDB
    const newItinerary = new this.itineraryModel({
      user_id: new Types.ObjectId(userId),
      prompt: dto.prompt,
      title: title,
      start_time: dto.start_time || '11:00',
      end_time: dto.end_time || '14:30',
      budget: userBudget,
      remaining_budget: remainingBudget,
      total_cost: totalCost,
      desired_stops: desiredStops,
      start_location: { type: 'Point', coordinates: [userLng, userLat] },
      status: 'generated',
      stops: optimizedStops,
      total_distance_km: Number(totalDistKm.toFixed(2)),
      total_duration_mins: totalDurationMins,
      co2SavedKg: co2Saved,
      routing_mode: routingMode,
      optimizedBy: optimizedBy,
      created_at: new Date(),
    });

    return await newItinerary.save();
  }

  async getItinerariesByUser(userId: string): Promise<Itinerary[]> {
    return this.itineraryModel
      .find({ user_id: new Types.ObjectId(userId) })
      .sort({ created_at: -1 })
      .exec();
  }

  async getAllItineraries(): Promise<Itinerary[]> {
    return this.itineraryModel
      .find()
      .populate('user_id', 'username firstName lastName email')
      .sort({ created_at: -1 })
      .exec();
  }

  async getItineraryById(id: string, userId: string): Promise<Itinerary> {
    if (!Types.ObjectId.isValid(id) || !/^[0-9a-fA-F]{24}$/.test(id)) {
      throw new NotFoundException(
        `Lộ trình với ID "${id}" không hợp lệ hoặc không tồn tại.`,
      );
    }
    const itinerary = await this.itineraryModel
      .findById(id)
      .populate('stops.restaurant_id')
      .exec();
    if (!itinerary) {
      throw new NotFoundException('Không tìm thấy lộ trình');
    }
    return itinerary;
  }

  /**
   * [TASK-BIZ-02-06] Sắp xếp lại thứ tự các chặng dừng và cập nhật thời gian động
   */
  async reorderStops(
    id: string,
    stopIds: string[],
    actorId?: string,
    actorRole?: string,
  ): Promise<Itinerary> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`ID lộ trình "${id}" không hợp lệ.`);
    }

    const itinerary = await this.itineraryModel.findById(id).exec();
    if (!itinerary) {
      throw new NotFoundException('Không tìm thấy lộ trình để sắp xếp lại.');
    }

    if (actorRole && actorRole !== 'admin') {
      const ownerId =
        (itinerary.user_id as any)?._id?.toString() ||
        itinerary.user_id?.toString();
      if (ownerId && actorId && ownerId !== actorId) {
        throw new ForbiddenException(
          'Access Denied: You do not own this itinerary.',
        );
      }
    }

    const existingStopsMap = new Map<string, any>();
    for (const s of itinerary.stops) {
      existingStopsMap.set(s.stop_id, s);
    }

    const reordered: any[] = [];
    for (const sid of stopIds) {
      const found = existingStopsMap.get(sid);
      if (found) {
        reordered.push(found);
        existingStopsMap.delete(sid);
      }
    }

    for (const s of existingStopsMap.values()) {
      reordered.push(s);
    }

    const startLat = itinerary.start_location?.coordinates?.[1] || 10.7769;
    const startLng = itinerary.start_location?.coordinates?.[0] || 106.7009;

    const metrics = this.recalculateTimetableAndMetrics(
      reordered,
      startLat,
      startLng,
      itinerary.start_time || '11:00',
      itinerary.routing_mode || 'motorbike',
      itinerary.budget || 250000,
    );

    itinerary.stops = metrics.stops;
    itinerary.total_distance_km = metrics.total_distance_km;
    itinerary.total_duration_mins = metrics.total_duration_mins;
    itinerary.total_cost = metrics.total_cost;
    itinerary.remaining_budget = metrics.remaining_budget;
    itinerary.co2SavedKg = metrics.co2SavedKg;

    return await itinerary.save();
  }

  /**
   * [TASK-BIZ-02-06] Thêm một nhà hàng mới vào lộ trình và tính lại lộ trình
   */
  async addStop(
    id: string,
    dto: AddStopDto,
    actorId?: string,
    actorRole?: string,
  ): Promise<Itinerary> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`ID lộ trình "${id}" không hợp lệ.`);
    }

    const itinerary = await this.itineraryModel.findById(id).exec();
    if (!itinerary) {
      throw new NotFoundException('Không tìm thấy lộ trình để thêm điểm dừng.');
    }

    if (actorRole && actorRole !== 'admin') {
      const ownerId =
        (itinerary.user_id as any)?._id?.toString() ||
        itinerary.user_id?.toString();
      if (ownerId && actorId && ownerId !== actorId) {
        throw new ForbiddenException(
          'Access Denied: You do not own this itinerary.',
        );
      }
    }

    if (!Types.ObjectId.isValid(dto.restaurant_id)) {
      throw new NotFoundException(
        `ID nhà hàng "${dto.restaurant_id}" không hợp lệ.`,
      );
    }

    const restaurant = await this.restaurantModel
      .findById(dto.restaurant_id)
      .exec();
    if (!restaurant) {
      throw new NotFoundException(
        'Không tìm thấy thông tin nhà hàng để thêm vào lộ trình.',
      );
    }

    const startLat = itinerary.start_location?.coordinates?.[1] || 10.7769;
    const startLng = itinerary.start_location?.coordinates?.[0] || 106.7009;

    const newStop = {
      stop_id: uuidv4(),
      restaurant_id: restaurant._id,
      order_index: itinerary.stops.length + 1,
      restaurant_name: restaurant.tenQuan || 'Nhà hàng GastroWise',
      restaurant_lat: Number(restaurant.lat) || startLat,
      restaurant_lng: Number(restaurant.lon) || startLng,
      meal_type: this.inferMealType(
        restaurant.tags || '',
        restaurant.tenQuan || '',
      ),
      dining_duration_mins: 45,
      estimated_cost: 50000,
      tags: restaurant.tags || '',
    };

    const currentStops = [...itinerary.stops];
    if (
      dto.insert_after_order !== undefined &&
      dto.insert_after_order >= 0 &&
      dto.insert_after_order <= currentStops.length
    ) {
      currentStops.splice(dto.insert_after_order, 0, newStop as any);
    } else {
      currentStops.push(newStop as any);
    }

    const metrics = this.recalculateTimetableAndMetrics(
      currentStops,
      startLat,
      startLng,
      itinerary.start_time || '11:00',
      itinerary.routing_mode || 'motorbike',
      itinerary.budget || 250000,
    );

    itinerary.stops = metrics.stops;
    itinerary.total_distance_km = metrics.total_distance_km;
    itinerary.total_duration_mins = metrics.total_duration_mins;
    itinerary.total_cost = metrics.total_cost;
    itinerary.remaining_budget = metrics.remaining_budget;
    itinerary.co2SavedKg = metrics.co2SavedKg;
    itinerary.desired_stops = metrics.stops.length;

    return await itinerary.save();
  }

  /**
   * [TASK-BIZ-02-06] Xóa một điểm dừng và tính toán lại thời gian chặng kế
   */
  async removeStop(
    id: string,
    stopId: string,
    actorId?: string,
    actorRole?: string,
  ): Promise<Itinerary> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`ID lộ trình "${id}" không hợp lệ.`);
    }

    const itinerary = await this.itineraryModel.findById(id).exec();
    if (!itinerary) {
      throw new NotFoundException('Không tìm thấy lộ trình để xóa điểm dừng.');
    }

    if (actorRole && actorRole !== 'admin') {
      const ownerId =
        (itinerary.user_id as any)?._id?.toString() ||
        itinerary.user_id?.toString();
      if (ownerId && actorId && ownerId !== actorId) {
        throw new ForbiddenException(
          'Access Denied: You do not own this itinerary.',
        );
      }
    }

    const filteredStops = itinerary.stops.filter((s) => s.stop_id !== stopId);
    if (filteredStops.length === itinerary.stops.length) {
      throw new NotFoundException(
        `Không tìm thấy điểm dừng với mã "${stopId}".`,
      );
    }

    const startLat = itinerary.start_location?.coordinates?.[1] || 10.7769;
    const startLng = itinerary.start_location?.coordinates?.[0] || 106.7009;

    const metrics = this.recalculateTimetableAndMetrics(
      filteredStops,
      startLat,
      startLng,
      itinerary.start_time || '11:00',
      itinerary.routing_mode || 'motorbike',
      itinerary.budget || 250000,
    );

    itinerary.stops = metrics.stops;
    itinerary.total_distance_km = metrics.total_distance_km;
    itinerary.total_duration_mins = metrics.total_duration_mins;
    itinerary.total_cost = metrics.total_cost;
    itinerary.remaining_budget = metrics.remaining_budget;
    itinerary.co2SavedKg = metrics.co2SavedKg;
    itinerary.desired_stops = metrics.stops.length;

    return await itinerary.save();
  }

  /**
   * [TASK-BIZ-02-06] Tính toán lại toàn bộ lộ trình khi thay đổi ràng buộc (budget, time, mode)
   */
  async recalculateItinerary(
    id: string,
    dto: RecalculateItineraryDto,
    actorId?: string,
    actorRole?: string,
  ): Promise<Itinerary> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`ID lộ trình "${id}" không hợp lệ.`);
    }

    const itinerary = await this.itineraryModel.findById(id).exec();
    if (!itinerary) {
      throw new NotFoundException('Không tìm thấy lộ trình để tính toán lại.');
    }

    if (actorRole && actorRole !== 'admin') {
      const ownerId =
        (itinerary.user_id as any)?._id?.toString() ||
        itinerary.user_id?.toString();
      if (ownerId && actorId && ownerId !== actorId) {
        throw new ForbiddenException(
          'Access Denied: You do not own this itinerary.',
        );
      }
    }

    if (dto.budget !== undefined) itinerary.budget = dto.budget;
    if (dto.start_time) itinerary.start_time = dto.start_time;
    if (dto.routing_mode) itinerary.routing_mode = dto.routing_mode;
    if (dto.lat !== undefined && dto.lng !== undefined) {
      itinerary.start_location = {
        type: 'Point',
        coordinates: [dto.lng, dto.lat],
      };
    }

    const startLat = itinerary.start_location?.coordinates?.[1] || 10.7769;
    const startLng = itinerary.start_location?.coordinates?.[0] || 106.7009;

    let aiOptimized = false;
    if (itinerary.stops && itinerary.stops.length > 0) {
      try {
        const aiUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:5000';
        const candidatePayload = itinerary.stops.map((s) => ({
          id:
            (s.restaurant_id as any)?._id?.toString() ||
            s.restaurant_id?.toString() ||
            s.stop_id,
          name: s.restaurant_name,
          lat: s.restaurant_lat,
          lon: s.restaurant_lng,
          meal_type: s.meal_type || 'main',
          dining_duration_mins: s.dining_duration_mins || 45,
          avg_price: s.estimated_cost || 50000,
          tags: s.tags,
        }));

        const aiResponse = await firstValueFrom(
          this.httpService.post(
            `${aiUrl}/routes/optimize`,
            {
              start_location: [startLat, startLng],
              start_time_mins: parseTimeToMinutes(itinerary.start_time),
              budget: itinerary.budget || 250000,
              routing_mode: itinerary.routing_mode || 'motorbike',
              desired_stops: itinerary.stops.length,
              candidates: candidatePayload,
            },
            { timeout: 3500 },
          ),
        );

        if (aiResponse?.data?.stops && aiResponse.data.stops.length > 0) {
          const aiData = aiResponse.data;
          itinerary.stops = aiData.stops.map((s: any) => ({
            stop_id: uuidv4(),
            restaurant_id: new Types.ObjectId(s.id),
            order_index: s.order_index,
            restaurant_name: s.name,
            restaurant_lat: s.lat,
            restaurant_lng: s.lon,
            meal_type: s.meal_type,
            arrival_time: s.arrival_time,
            departure_time: s.departure_time,
            dining_duration_mins: s.dining_duration_mins,
            transit_time_mins: s.transit_time_mins,
            distance_to_next_km: s.distance_to_next_km,
            estimated_cost: s.estimated_cost,
          }));
          itinerary.total_distance_km = aiData.total_distance_km;
          itinerary.total_duration_mins = aiData.total_duration_mins;
          itinerary.total_cost = aiData.total_cost;
          itinerary.remaining_budget = aiData.remaining_budget;
          itinerary.co2SavedKg = aiData.co2_saved_kg;
          itinerary.optimizedBy = aiData.algorithm_used || 'OR-Tools TSPTW';
          aiOptimized = true;
        }
      } catch (e: any) {
        this.logger.warn(
          `AI Route Optimizer recalculation offline, falling back: ${e.message}`,
        );
      }
    }

    if (!aiOptimized) {
      const metrics = this.recalculateTimetableAndMetrics(
        itinerary.stops,
        startLat,
        startLng,
        itinerary.start_time || '11:00',
        itinerary.routing_mode || 'motorbike',
        itinerary.budget || 250000,
      );

      itinerary.stops = metrics.stops;
      itinerary.total_distance_km = metrics.total_distance_km;
      itinerary.total_duration_mins = metrics.total_duration_mins;
      itinerary.total_cost = metrics.total_cost;
      itinerary.remaining_budget = metrics.remaining_budget;
      itinerary.co2SavedKg = metrics.co2SavedKg;
      itinerary.optimizedBy = 'Gastronomic Progression Heuristic';
    }

    return await itinerary.save();
  }

  /**
   * [TASK-SEC-02] Admin / User: Cập nhật trạng thái + RBAC ownership verification
   * + Tự động ghi audit trail & Reinforce Taste DNA khi Hoàn Thành
   */
  async updateStatus(
    id: string,
    newStatus: string,
    actorId?: string,
    actorRole?: string,
  ): Promise<Itinerary> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`ID lộ trình "${id}" không hợp lệ.`);
    }

    const existing = await this.itineraryModel.findById(id).exec();
    if (!existing) {
      throw new NotFoundException('Không tìm thấy lộ trình để cập nhật.');
    }

    if (actorRole && actorRole !== 'admin') {
      const ownerId =
        (existing.user_id as any)?._id?.toString() ||
        existing.user_id?.toString();
      if (ownerId && actorId && ownerId !== actorId) {
        throw new ForbiddenException(
          'Access Denied: You do not own this itinerary.',
        );
      }
    }

    const now = new Date();
    const actorObjectId =
      actorId && Types.ObjectId.isValid(actorId)
        ? new Types.ObjectId(actorId)
        : null;

    const auditUpdate: Record<string, any> = { status: newStatus };

    if (newStatus === 'confirmed') {
      auditUpdate.confirmedBy = actorObjectId;
      auditUpdate.confirmedAt = now;
    } else if (newStatus === 'cancelled') {
      auditUpdate.cancelledBy = actorObjectId;
      auditUpdate.cancelledAt = now;
    } else if (newStatus === 'completed') {
      auditUpdate.completedBy = actorObjectId;
      auditUpdate.completedAt = now;
    }

    const updated = await this.itineraryModel
      .findByIdAndUpdate(id, { $set: auditUpdate }, { new: true })
      .populate('user_id', 'username firstName lastName email')
      .exec();

    if (!updated) {
      throw new NotFoundException('Không tìm thấy lộ trình để cập nhật.');
    }

    if (newStatus === 'completed') {
      const ownerIdStr =
        (updated.user_id as any)?._id?.toString() ||
        (updated.user_id as any)?.toString();
      if (ownerIdStr) {
        await this.interactionsService.recordEvent(ownerIdStr, {
          eventType: 'itinerary_complete',
          targetType: 'itinerary',
          targetId: id,
          metadata: { totalStops: updated.stops?.length || 0 },
        });

        if (updated.stops && updated.stops.length > 0) {
          const restaurantIds = updated.stops.map((s) => s.restaurant_id);
          const visitedRests = await this.restaurantModel
            .find({ _id: { $in: restaurantIds } })
            .lean()
            .exec();

          let hasSpicy = false;
          let hasSweet = false;
          let hasUmami = false;

          visitedRests.forEach((r) => {
            const tags = (r.tags || '').toLowerCase();
            if (/cay|lẩu|nướng|ớt/i.test(tags)) hasSpicy = true;
            if (/chè|trà sữa|bánh|ngọt/i.test(tags)) hasSweet = true;
            if (/phở|bún|cơm|hủ tiếu/i.test(tags)) hasUmami = true;
          });

          const tasteAdjustment: any = {};
          if (hasSpicy) tasteAdjustment.spicy = 0.8;
          if (hasSweet) tasteAdjustment.sweet = 0.8;
          if (hasUmami) tasteAdjustment.umami = 0.85;

          if (Object.keys(tasteAdjustment).length > 0) {
            await this.tasteDnaService.applyFeedbackEma(
              ownerIdStr,
              tasteAdjustment,
              0.12,
            );
            this.logger.log(
              `[Taste DNA Reinforcement] Đã cập nhật khẩu vị cho user ${ownerIdStr} sau khi hoàn thành lộ trình ${id}.`,
            );
          }
        }
      }
    }

    return updated;
  }

  /**
   * [TASK-SEC-02] Admin / User: Xóa lộ trình + RBAC ownership verification
   */
  async remove(
    id: string,
    actorId?: string,
    actorRole?: string,
  ): Promise<{ message: string }> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`ID lộ trình "${id}" không hợp lệ.`);
    }

    const existing = await this.itineraryModel.findById(id).exec();
    if (!existing) {
      throw new NotFoundException('Không tìm thấy lộ trình để xóa.');
    }

    if (actorRole && actorRole !== 'admin') {
      const ownerId =
        (existing.user_id as any)?._id?.toString() ||
        existing.user_id?.toString();
      if (ownerId && actorId && ownerId !== actorId) {
        throw new ForbiddenException(
          'Access Denied: You do not own this itinerary.',
        );
      }
    }

    await this.itineraryModel.findByIdAndDelete(id).exec();
    return { message: 'Đã xóa lộ trình thành công.' };
  }
}
