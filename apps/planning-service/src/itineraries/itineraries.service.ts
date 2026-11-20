import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Itinerary } from './schemas/itinerary.schema';
import { GenerateItineraryDto } from './dto/generate-itinerary.dto';
import { ReorderStopsDto } from './dto/reorder-stops.dto';
import { AddStopDto } from './dto/add-stop.dto';
import { RecalculateItineraryDto } from './dto/recalculate-itinerary.dto';
import { CoreApiClient } from '../acl/core-api.client';
import { AiApiClient } from '../acl/ai-api.client';
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
  return Number((R * c * 1.35).toFixed(2));
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
  const tags = (
    restaurant.tags
      ? Array.isArray(restaurant.tags)
        ? restaurant.tags.join(' ')
        : restaurant.tags
      : ''
  ).toLowerCase();
  const name = (restaurant.name || restaurant.tenQuan || '').toLowerCase();
  const combined = `${tags} ${name}`;

  const fp = profile.flavorProfile || profile;

  if (profile.dietaryRestrictions && profile.dietaryRestrictions.length > 0) {
    for (const rstr of profile.dietaryRestrictions) {
      if (/chay|vegetarian/i.test(rstr) && !/chay/i.test(combined)) {
        score -= 0.3;
      }
    }
  }

  if (fp.spicy > 0.7 && /cay|lẩu|nướng|ớt/i.test(combined)) {
    score += 0.2;
  } else if (fp.spicy < 0.3 && /cay|ớt/i.test(combined)) {
    score -= 0.2;
  }

  if (
    fp.sweet > 0.7 &&
    /chè|trà sữa|kem|bánh ngọt|tráng miệng/i.test(combined)
  ) {
    score += 0.2;
  }

  if (profile.preferredCuisines && profile.preferredCuisines.length > 0) {
    for (const fav of profile.preferredCuisines) {
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
    private readonly coreApiClient: CoreApiClient,
    private readonly aiApiClient: AiApiClient,
    private readonly httpService: HttpService,
  ) {}

  public inferMealType(tags: string | string[], name: string): string {
    const tagStr = Array.isArray(tags) ? tags.join(' ') : tags || '';
    const combined = `${tagStr} ${name}`.toLowerCase();
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
    const prevLng = startLng;
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

      const transitMins = Math.max(3, Math.round((dist / speed) * 60));
      const arrivalMins = currTimeMins + transitMins;

      const diningDuration = Number(stop.dining_duration_mins) || 45;
      const departureMins = arrivalMins + diningDuration;
      currTimeMins = departureMins;

      const stopCost = Number(stop.estimated_cost) || 50000;
      totalCost += stopCost;

      return {
        stop_id: stop.stop_id || uuidv4(),
        restaurant_id: stop.restaurant_id?.toString() || stop.id?.toString(),
        order_index: idx + 1,
        restaurant_name:
          stop.restaurant_name || stop.name || 'Nhà hàng GastroWise',
        restaurant_lat: sLat,
        restaurant_lng: sLng,
        restaurant_address: stop.restaurant_address || stop.address || '',
        meal_type:
          stop.meal_type ||
          this.inferMealType(
            stop.tags || '',
            stop.restaurant_name || stop.name || '',
          ),
        arrival_time: formatMinutesToTime(arrivalMins),
        departure_time: formatMinutesToTime(departureMins),
        dining_duration_mins: diningDuration,
        transit_time_mins: transitMins,
        distance_to_next_km: Number(dist.toFixed(2)),
        estimated_cost: stopCost,
        tags: Array.isArray(stop.tags) ? stop.tags.join(', ') : stop.tags || '',
      };
    });

    const totalDurationMins = currTimeMins - startMins;
    const remainingBudget = Math.max(0, budget - totalCost);
    const co2SavedKg = Number((totalDistKm * 0.12).toFixed(2));

    return {
      stops: updatedStops,
      total_distance_km: Number(totalDistKm.toFixed(2)),
      total_duration_mins: totalDurationMins,
      total_cost: totalCost,
      remaining_budget: remainingBudget,
      co2SavedKg,
    };
  }

  async generateItinerary(
    userId: string,
    dto: GenerateItineraryDto,
  ): Promise<Itinerary> {
    const prompt = (dto.prompt || '').trim();
    const userLat = dto.lat || 10.7769;
    const userLng = dto.lng || 106.7009;
    const userBudget = dto.budget || 250000;
    const desiredStops = Math.min(Math.max(dto.desired_stops || 3, 2), 6);
    const routingMode = dto.routing_mode || 'motorbike';
    const startMins = parseTimeToMinutes(dto.start_time || '11:00');

    // Extract tags from prompt
    const tagKeywords = [
      'ốc',
      'lẩu',
      'nướng',
      'chè',
      'cà phê',
      'cafe',
      'bún',
      'phở',
      'hủ tiếu',
      'cơm',
      'trà sữa',
    ];
    let selectedTag = '';
    for (const tag of tagKeywords) {
      if (new RegExp(tag, 'i').test(prompt)) {
        selectedTag = tag;
        break;
      }
    }

    // Call Core API to retrieve candidate restaurants
    let candidates = await this.coreApiClient.getCandidates({
      tags: selectedTag || undefined,
      lat: userLat,
      lng: userLng,
      radius_km: 15,
      limit: 15,
    });

    if (!candidates || candidates.length === 0) {
      candidates = await this.coreApiClient.getCandidates({ limit: 15 });
    }

    // Load Taste DNA from Core API
    let tasteProfile: any = null;
    try {
      if (userId) {
        tasteProfile = await this.coreApiClient.getTasteDna(userId);
      }
    } catch (err: any) {
      this.logger.debug(
        `Could not load Taste DNA for user ${userId}: ${err.message}`,
      );
    }

    // Score candidates
    const scoredCandidates = candidates.map((r) => {
      const rLat = r.lat ?? 10.7769;
      const rLng = r.lng ?? 106.7009;
      const dist = calculateHaversineDistanceKm(userLat, userLng, rLat, rLng);
      const rating = Number(r.rating) || 4.0;
      const tasteScore = calculateTasteAffinityScore(r, tasteProfile);
      const proximityScore = Math.max(0, 1 - dist / 25);
      const compositeScore =
        (rating / 5.0) * 0.4 + tasteScore * 0.3 + proximityScore * 0.3;

      return {
        id: r.restaurant_id,
        name: r.name,
        lat: rLat,
        lon: rLng,
        meal_type: this.inferMealType(r.tags || [], r.name),
        open_time: r.open_time?.split('-')[0]?.trim() || '08:00',
        close_time: r.open_time?.split('-')[1]?.trim() || '22:00',
        dining_duration_mins: 45,
        avg_price: 50000,
        rating,
        tags: Array.isArray(r.tags) ? r.tags.join(', ') : r.tags || '',
        compositeScore,
      };
    });

    scoredCandidates.sort((a, b) => b.compositeScore - a.compositeScore);

    // Call AI Route Optimizer via ACL AiApiClient
    let optimizedStops: any[] = [];
    let totalDistKm = 0;
    let totalDurationMins = 150;
    let totalCost = 0;
    let remainingBudget = userBudget;
    let co2Saved = 1.5;
    let optimizedBy = 'OR-Tools TSPTW';

    try {
      const aiResult = await this.aiApiClient.optimizeRoute({
        restaurants: scoredCandidates.slice(0, desiredStops + 2).map((c) => ({
          id: c.id,
          lat: c.lat,
          lng: c.lon,
          open: c.open_time,
          close: c.close_time,
          duration_mins: c.dining_duration_mins,
        })),
        start_lat: userLat,
        start_lng: userLng,
        start_time: dto.start_time || '11:00',
        routing_mode: routingMode,
        budget_vnd: userBudget,
      });

      if (aiResult && aiResult.stops && aiResult.stops.length > 0) {
        const candidateMap = new Map(scoredCandidates.map((c) => [c.id, c]));
        optimizedStops = aiResult.stops.map((s) => {
          const cand = candidateMap.get(s.restaurant_id);
          return {
            stop_id: uuidv4(),
            restaurant_id: s.restaurant_id,
            order_index: s.order_index + 1,
            restaurant_name: cand?.name || 'Nhà hàng GastroWise',
            restaurant_lat: cand?.lat || userLat,
            restaurant_lng: cand?.lon || userLng,
            meal_type: cand?.meal_type || 'main',
            arrival_time: s.arrival_time,
            departure_time: s.departure_time,
            dining_duration_mins: 45,
            transit_time_mins: s.transit_time_mins,
            distance_to_next_km: s.distance_km,
            estimated_cost: 50000,
            tags: cand?.tags || '',
          };
        });

        totalDistKm = aiResult.total_distance_km;
        totalDurationMins = aiResult.total_duration_mins;
        totalCost = optimizedStops.length * 50000;
        remainingBudget = Math.max(0, userBudget - totalCost);
        co2Saved = Number((totalDistKm * 0.12).toFixed(2));
        optimizedBy = aiResult.solver;
      }
    } catch (aiErr: any) {
      this.logger.warn(`AI Route Optimizer error: ${aiErr.message}`);
    }

    // Heuristic fallback if AI yielded no stops
    if (optimizedStops.length === 0) {
      optimizedBy = 'Gastronomic Progression Heuristic';
      const selected = scoredCandidates.slice(0, desiredStops);
      const metrics = this.recalculateTimetableAndMetrics(
        selected.map((c) => ({
          restaurant_id: c.id,
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

    const title = `Lộ trình ${selectedTag ? selectedTag.toLowerCase() : 'ẩm thực'} Sài Gòn`;

    const newItinerary = new this.itineraryModel({
      user_id: userId,
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
      .find({ user_id: userId })
      .sort({ created_at: -1 })
      .exec();
  }

  async getAllItineraries(): Promise<Itinerary[]> {
    return this.itineraryModel.find().sort({ created_at: -1 }).exec();
  }

  async getItineraryById(id: string, userId?: string): Promise<Itinerary> {
    if (!Types.ObjectId.isValid(id) || !/^[0-9a-fA-F]{24}$/.test(id)) {
      throw new NotFoundException(
        `Lộ trình với ID "${id}" không hợp lệ hoặc không tồn tại.`,
      );
    }
    const itinerary = await this.itineraryModel.findById(id).exec();
    if (!itinerary) {
      throw new NotFoundException('Không tìm thấy lộ trình');
    }
    return itinerary;
  }

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
      const ownerId = itinerary.user_id?.toString();
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
      const ownerId = itinerary.user_id?.toString();
      if (ownerId && actorId && ownerId !== actorId) {
        throw new ForbiddenException(
          'Access Denied: You do not own this itinerary.',
        );
      }
    }

    // Retrieve restaurant details via CoreApiClient ACL (Zero direct DB query)
    const restaurant = await this.coreApiClient.getRestaurantById(
      dto.restaurant_id,
    );
    if (!restaurant) {
      throw new NotFoundException(
        'Không tìm thấy thông tin nhà hàng từ Core Service.',
      );
    }

    const startLat = itinerary.start_location?.coordinates?.[1] || 10.7769;
    const startLng = itinerary.start_location?.coordinates?.[0] || 106.7009;

    const newStop = {
      stop_id: uuidv4(),
      restaurant_id: restaurant.restaurant_id,
      order_index: itinerary.stops.length + 1,
      restaurant_name: restaurant.name || 'Nhà hàng GastroWise',
      restaurant_lat: Number(restaurant.lat) || startLat,
      restaurant_lng: Number(restaurant.lng) || startLng,
      restaurant_address: restaurant.address || '',
      meal_type: this.inferMealType(
        restaurant.tags || [],
        restaurant.name || '',
      ),
      dining_duration_mins: 45,
      estimated_cost: 50000,
      tags: Array.isArray(restaurant.tags)
        ? restaurant.tags.join(', ')
        : restaurant.tags || '',
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
      const ownerId = itinerary.user_id?.toString();
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
      const ownerId = itinerary.user_id?.toString();
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

    return await itinerary.save();
  }

  async updateStatus(
    id: string,
    newStatus: string,
    actorId?: string,
    actorRole?: string,
  ): Promise<Itinerary> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`ID lộ trình "${id}" không hợp lệ.`);
    }

    const validStatuses = ['generated', 'confirmed', 'completed', 'cancelled'];
    if (!validStatuses.includes(newStatus)) {
      throw new NotFoundException(`Trạng thái "${newStatus}" không hợp lệ.`);
    }

    const itinerary = await this.itineraryModel.findById(id).exec();
    if (!itinerary) {
      throw new NotFoundException(
        'Không tìm thấy lộ trình để cập nhật trạng thái.',
      );
    }

    if (actorRole && actorRole !== 'admin') {
      const ownerId = itinerary.user_id?.toString();
      if (ownerId && actorId && ownerId !== actorId) {
        throw new ForbiddenException(
          'Access Denied: You do not own this itinerary.',
        );
      }
    }

    const auditUpdate: any = { status: newStatus };
    const now = new Date();
    if (newStatus === 'confirmed') {
      auditUpdate.confirmedBy = actorId || null;
      auditUpdate.confirmedAt = now;
    } else if (newStatus === 'cancelled') {
      auditUpdate.cancelledBy = actorId || null;
      auditUpdate.cancelledAt = now;
    } else if (newStatus === 'completed') {
      auditUpdate.completedBy = actorId || null;
      auditUpdate.completedAt = now;
    }

    const updated = await this.itineraryModel
      .findByIdAndUpdate(id, { $set: auditUpdate }, { new: true })
      .exec();

    if (!updated) {
      throw new NotFoundException('Không tìm thấy lộ trình để cập nhật.');
    }

    // When tour is completed, asynchronously propagate event & feedback to Core Service
    if (newStatus === 'completed') {
      const ownerIdStr = updated.user_id?.toString();
      if (ownerIdStr) {
        this.coreApiClient.recordInteraction({
          userId: ownerIdStr,
          restaurantId: updated.stops?.[0]?.restaurant_id || '',
          interactionType: 'itinerary_complete',
          metadata: { totalStops: updated.stops?.length || 0, itineraryId: id },
        });

        if (updated.stops && updated.stops.length > 0) {
          const restaurantIds = updated.stops.map((s) => s.restaurant_id);
          this.coreApiClient.applyFeedback(ownerIdStr, {
            completedItineraryId: id,
            restaurantIds,
            rating: 5,
          });
        }
      }
    }

    return updated;
  }

  async remove(id: string, actorId?: string, actorRole?: string) {
    return this.deleteItinerary(id, actorId, actorRole);
  }

  async deleteItinerary(id: string, actorId?: string, actorRole?: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`ID lộ trình "${id}" không hợp lệ.`);
    }

    const itinerary = await this.itineraryModel.findById(id).exec();
    if (!itinerary) {
      throw new NotFoundException('Không tìm thấy lộ trình để xóa.');
    }

    if (actorRole && actorRole !== 'admin') {
      const ownerId = itinerary.user_id?.toString();
      if (ownerId && actorId && ownerId !== actorId) {
        throw new ForbiddenException(
          'Access Denied: You do not own this itinerary.',
        );
      }
    }

    return this.itineraryModel.findByIdAndDelete(id).exec();
  }
}
