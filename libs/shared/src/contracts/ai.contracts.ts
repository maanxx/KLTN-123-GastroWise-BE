export class HybridRecommendationRequest {
  user_id: string;
  top_k?: number;
  current_location?: {
    lat: number;
    lng: number;
  };
  taste_dna?: Record<string, number>;
  context?: {
    weather?: string;
    time_of_day?: string;
    budget?: number;
  };
}

export class HybridRecommendationItem {
  restaurant_id: string;
  score: number;
  confidence?: number;
  reasons?: string[];
}

export class HybridRecommendationResponse {
  recommendations: HybridRecommendationItem[];
  model_version?: string;
}

export class CandidateStopItem {
  id: string;
  name: string;
  lat: number;
  lon: number;
  meal_type?: string;
  open_time?: string;
  close_time?: string;
  dining_duration_mins?: number;
  avg_price?: number;
  rating?: number;
  tags?: string;
  district?: string;
}

export class RouteOptimizeRestaurantItem {
  id: string;
  lat: number;
  lng: number;
  open: string;
  close: string;
  duration_mins: number;
  name?: string;
  meal_type?: string;
  avg_price?: number;
  rating?: number;
}

export class RouteOptimizeCanonicalRequest {
  start_location: [number, number];
  start_time_mins?: number;
  budget?: number;
  routing_mode?: string;
  desired_stops?: number;
  max_duration_mins?: number;
  candidates: CandidateStopItem[];
}

export class RouteOptimizeRequest {
  restaurants: RouteOptimizeRestaurantItem[];
  start_lat: number;
  start_lng: number;
  start_time: string;
  routing_mode: string;
  budget_vnd?: number;
  desired_stops?: number;
}

export class OptimizedStopItem {
  id: string;
  name: string;
  lat: number;
  lon: number;
  order_index: number;
  meal_type: string;
  arrival_time: string;
  departure_time: string;
  dining_duration_mins: number;
  transit_time_mins: number;
  distance_to_next_km: number;
  estimated_cost: number;
  tags?: string;
}

export class RouteOptimizeResponse {
  stops: OptimizedStopItem[];
  ordered_stops?: OptimizedStopItem[];
  total_distance_km: number;
  total_duration_mins: number;
  total_cost: number;
  remaining_budget: number;
  co2_saved_kg: number;
  status: string;
  message: string;
  algorithm_used: string;
  routing_mode: string;
}

export class SentimentAnalysisRequest {
  text: string;
}

export class SentimentAnalysisResponse {
  sentiment: 'positive' | 'negative' | 'neutral';
  score: number;
  aspects?: Record<string, any>;
}

export class CopilotMessageRequest {
  user_id: string;
  message: string;
  history?: Array<{ role: string; content: string }>;
  context?: Record<string, any>;
}

export class CopilotMessageResponse {
  reply: string;
  intent?: string;
  slots?: Record<string, any>;
  action_card?: Record<string, any>;
}
