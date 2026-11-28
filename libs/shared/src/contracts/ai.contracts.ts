/**
 * Shared TypeScript Contracts for GastroWise Microservices <-> AI Microservice (FastAPI 1.0.0)
 * Synchronized against KLTN-123-GastroWise-AI OpenAPI 3.1.0 & runtime callers (M7.3.9).
 */

export class RecommendRequest {
  query: string;
  candidate_ids?: string[] | null = [];
  user_gps?: number[] | null;
  city_filter?: string | null;
  taste_vector?: number[] | null;
  dietary_exclusions?: string[] | null = [];
}

export class RecommendTasteScore {
  id: string;
  name: string;
  tags: string;
  S_taste: number;
  distance_km: number;
  price: number;
  explanation?: string | null;
}

export class RecommendResponse {
  sort_by: string;
  scores: RecommendTasteScore[];
}

export class WeatherRecommendRequest {
  user_gps?: number[] | null;
  temperature?: number | null;
  weather_condition?: string | null;
}

export class WeatherInfo {
  temperature: number;
  condition_text: string;
  condition_code: number;
  banner_title: string;
  banner_desc: string;
  weather_type: string;
}

export class WeatherRecommendResponse {
  weather: WeatherInfo;
  scores: RecommendTasteScore[];
}

export class TrainCFRequest {
  interactions: Array<Record<string, any>>;
}

export class TrainCFResponse {
  success: boolean;
  message: string;
  user_count: number;
  item_count: number;
}

export class HybridRecommendationRequest {
  user_id?: string | null;
  user_gps?: number[] | null;
  taste_vector?: number[] | null;
  dietary_exclusions?: string[] | null = [];
  weather_type?: string | null;
  temperature?: number | null;
  max_price?: number | null;
  limit?: number | null = 10;
}

export class HybridRecommendationItem {
  id: string;
  name: string;
  tags: string;
  score: number;
  taste_score: number;
  cf_score: number;
  env_score: number;
  distance_km: number;
  price: number;
  match_reasons: string[];
  explanation: string;
}

export class HybridRecommendationResponse {
  total: number;
  is_cold_start: boolean;
  applied_weights: Record<string, number>;
  items: HybridRecommendationItem[];
}

export class CandidateStopItem {
  id: string;
  name: string;
  lat: number;
  lon: number;
  meal_type?: string | null = 'main';
  open_time?: string | null = '08:00';
  close_time?: string | null = '22:00';
  dining_duration_mins?: number | null = 45;
  avg_price?: number | null = 50000;
  rating?: number | null = 4.5;
  tags?: string | null;
  district?: string | null;
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
  tags?: string;
  district?: string;
}

export class RouteOptimizeCanonicalRequest {
  start_location: [number, number];
  start_time_mins?: number | null = 660;
  budget?: number | null = 250000;
  routing_mode?: string | null = 'motorbike';
  desired_stops?: number | null = 3;
  max_duration_mins?: number | null;
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
  tags?: string | null;
}

export class RouteOptimizeResponse {
  stops: OptimizedStopItem[];
  ordered_stops?: OptimizedStopItem[] | null;
  total_distance_km: number;
  total_duration_mins: number;
  total_cost: number;
  remaining_budget: number;
  co2_saved_kg: number;
  status: string;
  message: string;
  algorithm_used?: string = 'OR-Tools TSPTW';
  routing_mode?: string = 'motorbike';
}

export class SentimentAnalysisRequest {
  review: string;
}

export class SentimentAnalysisResponse {
  label: string;
  score: number;
  hashtags?: string[];
}

export class CopilotMessageRequest {
  message: string;
  user_gps?: number[] | null;
  taste_vector?: number[] | null;
}

export class CopilotMessageResponse {
  reply: string;
  intent: string;
  entities: Record<string, any>;
  action_card?: Record<string, any> | null;
  results?: Array<Record<string, any>> = [];
}
