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

export class RouteOptimizeRestaurantItem {
  id: string;
  lat: number;
  lng: number;
  open: string;
  close: string;
  duration_mins: number;
}

export class RouteOptimizeRequest {
  restaurants: RouteOptimizeRestaurantItem[];
  start_lat: number;
  start_lng: number;
  start_time: string;
  routing_mode: string;
  budget_vnd?: number;
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
