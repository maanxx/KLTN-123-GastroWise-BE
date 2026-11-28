import {
  Injectable,
  Logger,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { randomUUID } from 'crypto';
import {
  RouteOptimizationResult,
  OptimizedStopResult,
} from '@shared/contracts/planning.contracts';
import {
  RouteOptimizeRequest,
  RouteOptimizeCanonicalRequest,
} from '@shared/contracts/ai.contracts';
import {
  calculateHaversineDistanceKm,
  estimateTransitTimeMinutes,
} from '@shared/utils/geo.utils';
import {
  DEFAULT_NEUTRAL_RATING,
  formatRestaurantTagsString,
  normalizeRestaurantRating,
  normalizeStopOrderIndexes,
} from '@shared/utils/restaurant-normalizer.util';

@Injectable()
export class AiApiClient {
  private readonly logger = new Logger(AiApiClient.name);
  private readonly aiUrl: string;
  private readonly internalAiKey: string;

  constructor(private readonly httpService: HttpService) {
    this.aiUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:5000';
    const key = process.env.INTERNAL_AI_KEY;
    if (!key) {
      throw new Error(
        'Missing mandatory security configuration: INTERNAL_AI_KEY must be set in environment variables',
      );
    }
    this.internalAiKey = key;
  }

  private getHeaders(correlationId?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'X-Internal-AI-Key': this.internalAiKey,
      'X-Correlation-Id': correlationId || randomUUID(),
    };
    return headers;
  }

  /**
   * Helper: Parse "HH:MM" string into minutes from midnight (default 660 = 11:00 AM)
   */
  private parseTimeToMinutes(timeStr?: string): number {
    if (!timeStr) return 660;
    const parts = timeStr.split(':').map(Number);
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      return parts[0] * 60 + parts[1];
    }
    return 660;
  }

  /**
   * Helper: Map internal Planning RouteOptimizeRequest DTO to canonical AI schema
   */
  private mapToCanonicalAiRequest(
    request: RouteOptimizeRequest,
  ): RouteOptimizeCanonicalRequest {
    return {
      start_location: [request.start_lat, request.start_lng],
      start_time_mins: this.parseTimeToMinutes(request.start_time),
      budget: request.budget_vnd ?? 250000,
      routing_mode: request.routing_mode || 'motorbike',
      desired_stops: request.desired_stops ?? (request.restaurants?.length || 3),
      candidates: (request.restaurants || []).map((r) => {
        const normalizedRating =
          r.rating !== undefined && r.rating !== null
            ? normalizeRestaurantRating({
                rating: r.rating,
                rawRating: (r as any).rawRating,
                ratingScale: (r as any).ratingScale,
              }).rating
            : DEFAULT_NEUTRAL_RATING;

        const normalizedTags =
          r.tags !== undefined && r.tags !== null
            ? formatRestaurantTagsString(r.tags)
            : undefined;

        return {
          id: r.id,
          name: r.name?.trim() || `Restaurant ${r.id}`,
          lat: r.lat,
          lon: (r as any).lon !== undefined ? (r as any).lon : r.lng,
          meal_type: r.meal_type || 'main',
          open_time: r.open || '08:00',
          close_time: r.close || '22:00',
          dining_duration_mins: r.duration_mins ?? 45,
          avg_price:
            r.avg_price !== undefined && r.avg_price !== null
              ? r.avg_price
              : 50000,
          rating: normalizedRating,
          tags: normalizedTags,
          district: r.district,
        };
      }),
    };
  }

  /**
   * Gọi AI Microservice (OR-Tools TSPTW) với Circuit Breaker và 3500ms timeout
   * Tự động fallback sang Gastronomic Greedy Heuristic nếu AI offline hoặc timeout
   * KHÔNG fallback khi gặp lỗi Authentication (401/403) hoặc Contract Validation (400/422)
   */
  async optimizeRoute(
    request: RouteOptimizeRequest,
    correlationId?: string,
  ): Promise<RouteOptimizationResult> {
    const cid = correlationId || randomUUID();
    const startTime = Date.now();
    const url = `${this.aiUrl}/routes/optimize`;
    const payload = this.mapToCanonicalAiRequest(request);

    try {
      const response = await firstValueFrom(
        this.httpService.post<any>(url, payload, {
          headers: this.getHeaders(cid),
          timeout: 3500,
        }),
      );

      const durationMs = Date.now() - startTime;
      const solver =
        response.data?.algorithm_used ||
        response.data?.solver ||
        'OR-Tools TSPTW';

      this.logger.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'INFO',
          context: 'AiApiClient',
          method: 'POST',
          url,
          status: 200,
          durationMs,
          correlationId: cid,
          solver,
        }),
      );

      const rawStops =
        response.data?.stops || response.data?.ordered_stops;

      if (Array.isArray(rawStops)) {
        const mappedStops: OptimizedStopResult[] = rawStops.map(
          (s: any, idx: number) => ({
            restaurant_id: s.id || s.restaurant_id,
            order_index:
              typeof s.order_index === 'number' ? s.order_index : idx + 1,
            meal_type: s.meal_type,
            arrival_time: s.arrival_time || s.arrival || '12:00',
            departure_time: s.departure_time || s.departure || '13:00',
            transit_time_mins: s.transit_time_mins ?? s.transit_mins ?? 15,
            distance_km: s.distance_to_next_km ?? s.distance_km ?? 1.5,
            estimated_cost: s.estimated_cost,
          }),
        );
        return {
          stops: normalizeStopOrderIndexes(mappedStops),
          total_distance_km: response.data.total_distance_km ?? 5.0,
          total_duration_mins: response.data.total_duration_mins ?? 120,
          solver,
        };
      }
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const status = err.response?.status;

      // CRITICAL SECURITY & AUTHENTICATION CHECK: Never fallback on 401/403
      if (status === 401) {
        this.logger.error(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'ERROR',
            context: 'AiApiClient',
            method: 'POST',
            url,
            status,
            durationMs,
            correlationId: cid,
            message: 'CRITICAL: AI Service internal authentication missing or rejected (401).',
          }),
        );
        throw new UnauthorizedException(
          `AI Service authentication failed (HTTP 401) [cid: ${cid}]: ${err.response?.data?.detail || err.message}`,
        );
      }

      if (status === 403) {
        this.logger.error(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'ERROR',
            context: 'AiApiClient',
            method: 'POST',
            url,
            status,
            durationMs,
            correlationId: cid,
            message: 'CRITICAL: AI Service internal authentication forbidden (403 invalid key).',
          }),
        );
        throw new ForbiddenException(
          `AI Service forbidden (HTTP 403) [cid: ${cid}]: ${err.response?.data?.detail || err.message}`,
        );
      }

      // CONTRACT VALIDATION ERROR: Never fallback on 400 or 422
      if (status === 400 || status === 422) {
        this.logger.error(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'ERROR',
            context: 'AiApiClient',
            method: 'POST',
            url,
            status,
            durationMs,
            correlationId: cid,
            message: 'CRITICAL: AI Service request schema validation failed (400/422).',
            details: err.response?.data,
          }),
        );
        throw new BadRequestException(
          `AI Service contract validation failed (HTTP ${status}) [cid: ${cid}]: ${JSON.stringify(err.response?.data?.detail || err.response?.data || err.message)}`,
        );
      }

      // Circuit Breaker: Timeout (3500ms), 5xx or connection refused -> Fall back to Gastronomic Greedy Heuristic
      this.logger.warn(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'WARN',
          context: 'AiApiClient',
          method: 'POST',
          url,
          status: status || 'NETWORK_ERROR',
          code: err.code || 'UNKNOWN',
          durationMs,
          correlationId: cid,
          message: `AI Route Optimizer unavailable (${err.message}). Tripping circuit breaker to Greedy Heuristic.`,
        }),
      );
    }

    // Fallback: Gastronomic Greedy Nearest Neighbor Heuristic
    return this.solveGreedyHeuristic(request);
  }

  private solveGreedyHeuristic(
    request: RouteOptimizeRequest,
  ): RouteOptimizationResult {
    const remaining = [...request.restaurants];
    let curLat = request.start_lat;
    let curLng = request.start_lng;
    let [curHour, curMin] = request.start_time.split(':').map(Number);
    if (isNaN(curHour)) curHour = 11;
    if (isNaN(curMin)) curMin = 30;

    const stops: OptimizedStopResult[] = [];
    let totalDist = 0;
    let totalDuration = 0;
    let order = 1;

    while (remaining.length > 0) {
      let bestIdx = 0;
      let minDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const d = calculateHaversineDistanceKm(
          curLat,
          curLng,
          remaining[i].lat,
          remaining[i].lng,
        );
        if (d < minDist) {
          minDist = d;
          bestIdx = i;
        }
      }

      const chosen = remaining.splice(bestIdx, 1)[0];
      const transitMins = estimateTransitTimeMinutes(
        minDist,
        (request.routing_mode as any) || 'motorbike',
      );
      totalDist += minDist;

      // Advance time by transit
      curMin += transitMins;
      curHour += Math.floor(curMin / 60);
      curMin = curMin % 60;
      const arrival = `${String(curHour).padStart(2, '0')}:${String(curMin).padStart(2, '0')}`;

      // Advance time by dining duration
      const diningDuration = chosen.duration_mins || 45;
      curMin += diningDuration;
      curHour += Math.floor(curMin / 60);
      curMin = curMin % 60;
      const departure = `${String(curHour).padStart(2, '0')}:${String(curMin).padStart(2, '0')}`;

      totalDuration += transitMins + diningDuration;

      stops.push({
        restaurant_id: chosen.id,
        order_index: order++,
        arrival_time: arrival,
        departure_time: departure,
        transit_time_mins: transitMins,
        distance_km: minDist,
      });

      curLat = chosen.lat;
      curLng = chosen.lng;
    }

    return {
      stops,
      total_distance_km: Number(totalDist.toFixed(2)),
      total_duration_mins: totalDuration,
      solver: 'Gastronomic Greedy Fallback',
    };
  }
}
