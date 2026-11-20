import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { randomUUID } from 'crypto';
import {
  RouteOptimizationResult,
  OptimizedStopResult,
} from '@shared/contracts/planning.contracts';
import { RouteOptimizeRequest } from '@shared/contracts/ai.contracts';
import {
  calculateHaversineDistanceKm,
  estimateTransitTimeMinutes,
} from '@shared/utils/geo.utils';

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
   * Gọi AI Microservice (OR-Tools TSPTW) với Circuit Breaker và 3500ms timeout
   * Tự động fallback sang Gastronomic Greedy Heuristic nếu AI offline hoặc timeout
   * KHÔNG fallback khi gặp lỗi Authentication (401/403)
   */
  async optimizeRoute(
    request: RouteOptimizeRequest,
    correlationId?: string,
  ): Promise<RouteOptimizationResult> {
    const cid = correlationId || randomUUID();
    const startTime = Date.now();
    const url = `${this.aiUrl}/routes/optimize`;

    try {
      const response = await firstValueFrom(
        this.httpService.post<any>(url, request, {
          headers: this.getHeaders(cid),
          timeout: 3500,
        }),
      );

      const durationMs = Date.now() - startTime;
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
          solver: response.data?.solver || 'OR-Tools TSPTW',
        }),
      );

      if (response.data && response.data.ordered_stops) {
        return {
          stops: response.data.ordered_stops.map((s: any, idx: number) => ({
            restaurant_id: s.id || s.restaurant_id,
            order_index: idx,
            arrival_time: s.arrival || s.arrival_time || '12:00',
            departure_time: s.departure || s.departure_time || '13:00',
            transit_time_mins: s.transit_mins || s.transit_time_mins || 15,
            distance_km: s.distance_km || 1.5,
          })),
          total_distance_km: response.data.total_distance_km || 5.0,
          total_duration_mins: response.data.total_duration_mins || 120,
          solver: response.data.solver || 'OR-Tools TSPTW',
        };
      }
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const status = err.response?.status;

      // CRITICAL SECURITY CHECK: If authentication failed (401/403), NEVER fall back silently!
      if (status === 401 || status === 403) {
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
            message: 'CRITICAL: AI Service internal authentication failed. Keys mismatched or rejected.',
          }),
        );
        throw new UnauthorizedException(
          `AI Service authentication failed (HTTP ${status}) [cid: ${cid}]: ${err.response?.data?.detail || err.message}`,
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
    let order = 0;

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
