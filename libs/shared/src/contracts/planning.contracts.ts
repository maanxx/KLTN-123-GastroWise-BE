export class ItineraryStopSnapshot {
  stop_id: string;
  order_index: number;
  restaurant_id: string;
  restaurant_name: string;
  restaurant_lat: number;
  restaurant_lng: number;
  restaurant_address?: string;
  restaurant_rating?: number;
  restaurant_tags?: string[];
  meal_type: string;
  arrival_time: string;
  departure_time: string;
  dining_duration_mins: number;
  transit_time_mins: number;
  distance_to_next_km: number;
  estimated_cost: number;
}

export class OptimizedStopResult {
  restaurant_id: string;
  order_index: number;
  arrival_time: string;
  departure_time: string;
  transit_time_mins: number;
  distance_km: number;
}

export class RouteOptimizationResult {
  stops: OptimizedStopResult[];
  total_distance_km: number;
  total_duration_mins: number;
  solver: string;
}
