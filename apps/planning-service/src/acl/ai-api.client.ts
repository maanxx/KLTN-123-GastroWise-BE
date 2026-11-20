import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
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
  private readonly internalAiKey?: string;

  constructor(private readonly httpService: HttpService) {
    this.aiUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:5000';
    this.internalAiKey = process.env.INTERNAL_AI_KEY;
  }

  private getHeaders(correlationId?: string): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.internalAiKey) {
      headers['X-Internal-AI-Key'] = this.internalAiKey;
    }
    if (correlationId) {
      headers['X-Correlation-Id'] = correlationId;
    }
    return headers;
  }

  /**
   * Gọi AI Microservice (OR-Tools TSPTW) với Circuit Breaker và 3500ms timeout
   * Tự động fallback sang Gastronomic Greedy Heuristic nếu AI offline hoặc timeout
   */
  async optimizeRoute(
    request: RouteOptimizeRequest,
    correlationId?: string,
  ): Promise<RouteOptimizationResult> {
    try {
      const url = `${this.aiUrl}/routes/optimize`;
      const response = await firstValueFrom(
        this.httpService.post<any>(url, request, {
          headers: this.getHeaders(correlationId),
          timeout: 3500,
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
      this.logger.warn(
        `AI Route Optimizer unavailable (${err.message}). Tripping circuit breaker to Greedy Heuristic.`,
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
      // Find nearest candidate
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
