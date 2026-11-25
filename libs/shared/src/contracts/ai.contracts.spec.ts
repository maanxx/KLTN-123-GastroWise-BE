import {
  HybridRecommendationRequest,
  HybridRecommendationResponse,
  SentimentAnalysisRequest,
  SentimentAnalysisResponse,
  CopilotMessageRequest,
  CopilotMessageResponse,
  RouteOptimizeCanonicalRequest,
  RouteOptimizeResponse,
} from './ai.contracts';

describe('Shared AI DTO Contracts (Synchronized with FastAPI OpenAPI)', () => {
  it('should instantiate HybridRecommendationRequest and Response with canonical FastAPI fields', () => {
    const req: HybridRecommendationRequest = {
      user_id: 'u1',
      user_gps: [10.7769, 106.7009],
      taste_vector: [0.2, 0.2, 0.2, 0.4, 0.8, 0.1],
      dietary_exclusions: ['chay'],
      weather_type: 'rainy',
      temperature: 23.5,
      max_price: 100000,
      limit: 10,
    };
    const res: HybridRecommendationResponse = {
      total: 1,
      is_cold_start: true,
      applied_weights: { w1_taste: 0.65, w2_cf: 0.0, w3_env: 0.35 },
      items: [
        {
          id: 'rest_1',
          name: 'Cơm Chay',
          tags: 'cơm chay vegan',
          score: 0.88,
          taste_score: 0.85,
          cf_score: 0.0,
          env_score: 1.0,
          distance_km: 0.5,
          price: 45000,
          match_reasons: ['Hợp khẩu vị'],
          explanation: 'Hợp khẩu vị',
        },
      ],
    };
    expect(req.limit).toBe(10);
    expect(res.items[0].id).toBe('rest_1');
  });

  it('should align SentimentAnalysis and CopilotMessage DTOs with FastAPI schemas', () => {
    const sentReq: SentimentAnalysisRequest = { review: 'Quán ngon lắm' };
    const sentRes: SentimentAnalysisResponse = {
      label: 'POSITIVE',
      score: 0.9,
      hashtags: ['#monngon'],
    };
    const copReq: CopilotMessageRequest = {
      message: 'Tìm quán phở gần đây',
      user_gps: [10.77, 106.7],
      taste_vector: null,
    };
    const copRes: CopilotMessageResponse = {
      reply: 'Gợi ý cho bạn',
      intent: 'find_nearby',
      entities: { district: 'Quận 1' },
      action_card: null,
      results: [],
    };
    expect(sentReq.review).toBeDefined();
    expect(sentRes.hashtags).toContain('#monngon');
    expect(copReq.message).toBeDefined();
    expect(copRes.entities.district).toBe('Quận 1');
  });

  it('should align RouteOptimizeCanonicalRequest and RouteOptimizeResponse', () => {
    const req: RouteOptimizeCanonicalRequest = {
      start_location: [10.77, 106.7],
      candidates: [
        {
          id: 'r1',
          name: 'Stop 1',
          lat: 10.77,
          lon: 106.7,
        },
      ],
    };
    const res: RouteOptimizeResponse = {
      stops: [],
      ordered_stops: [],
      total_distance_km: 0,
      total_duration_mins: 0,
      total_cost: 0,
      remaining_budget: 250000,
      co2_saved_kg: 0,
      status: 'EMPTY',
      message: 'Empty',
    };
    expect(req.start_location).toHaveLength(2);
    expect(res.status).toBe('EMPTY');
  });
});
