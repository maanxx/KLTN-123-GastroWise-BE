import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { RestaurantsService } from './restaurants.service';
import { Restaurant } from './schemas/restaurant.schema';
import { MenuItem } from './schemas/menu-item.schema';
import { TasteDnaService } from '../taste-dna/taste-dna.service';
import { InteractionsService } from '../interactions/interactions.service';

describe('RestaurantsService - Hybrid Personalized Recommendations (TASK-P2-01 & TASK-P2-02)', () => {
  let service: RestaurantsService;
  let mockRestaurantModel: any;
  let mockMenuItemModel: any;
  let mockHttpService: any;
  let mockTasteDnaService: any;
  let mockInteractionsService: any;

  const mockRestaurants = [
    {
      _id: '673100000000000000000001',
      tenQuan: 'Lẩu Cay Sài Gòn',
      name: 'Lẩu Cay Sài Gòn',
      diaChi: '123 Lê Lợi, Q1, TP.HCM',
      diemTrungBinh: 4.8,
      rating: 4.8,
      giaCa: '120.000đ - 250.000đ',
      tags: 'lẩu thái, cay, hải sản',
      lat: 10.7769,
      lon: 106.7009,
    },
    {
      _id: '673100000000000000000002',
      tenQuan: 'Cơm Chay An Lạc',
      name: 'Cơm Chay An Lạc',
      diaChi: '45 Nguyễn Huệ, Q1, TP.HCM',
      diemTrungBinh: 4.6,
      rating: 4.6,
      giaCa: '35.000đ - 65.000đ',
      tags: 'cơm chay, thanh đạm, rau củ',
      lat: 10.777,
      lon: 106.701,
    },
  ];

  beforeEach(async () => {
    const mockQueryChain: any = {
      lean: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(mockRestaurants),
    };

    mockRestaurantModel = {
      countDocuments: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(0),
      }),
      find: jest.fn().mockReturnValue(mockQueryChain),
      aggregate: jest.fn().mockResolvedValue(mockRestaurants),
    };

    mockMenuItemModel = {
      find: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([]),
      }),
    };

    mockHttpService = {
      post: jest.fn().mockImplementation((url: string) => {
        if (url.includes('/weather-recommend')) {
          return of({
            data: {
              weather: {
                temperature: 24,
                weather_type: 'rainy',
                banner_title: 'Trời mưa mát mẻ',
              },
              scores: [],
            },
          });
        }
        if (url.includes('/recommend/hybrid')) {
          return of({
            data: {
              total: 2,
              is_cold_start: false,
              applied_weights: { w1_taste: 0.45, w2_cf: 0.3, w3_env: 0.25 },
              items: [
                {
                  id: '673100000000000000000001',
                  name: 'Lẩu Cay Sài Gòn',
                  tags: 'lẩu thái, cay, hải sản',
                  score: 0.912,
                  taste_score: 0.94,
                  cf_score: 0.88,
                  env_score: 1.3,
                  distance_km: 1.2,
                  price: 150000,
                  match_reasons: [
                    '✨ Hợp khẩu vị Taste DNA (94%)',
                    '🌧️ Món nóng ấm lý tưởng cho ngày mưa',
                  ],
                  explanation:
                    '✨ Hợp khẩu vị Taste DNA (94%) • 🌧️ Món nóng ấm lý tưởng cho ngày mưa',
                },
                {
                  id: '673100000000000000000002',
                  name: 'Cơm Chay An Lạc',
                  tags: 'cơm chay, thanh đạm, rau củ',
                  score: 0.765,
                  taste_score: 0.7,
                  cf_score: 0.65,
                  env_score: 1.0,
                  distance_km: 1.5,
                  price: 50000,
                  match_reasons: ['📍 Gần bạn (1.5km)', '⭐ Đánh giá cao'],
                  explanation: '📍 Gần bạn (1.5km) • ⭐ Đánh giá cao',
                },
              ],
            },
          });
        }
        if (url.includes('/copilot/message')) {
          return of({
            data: {
              reply: 'Mình đã lập kế hoạch Food Tour tại Quận 1 cho bạn!',
              intent: 'plan_journey',
              entities: { district: 'Quận 1', budget: 200000 },
              action_card: {
                type: 'planner_action',
                title: 'Lập Lộ Trình Food Tour Quận 1',
                button_text: 'Khởi Tạo Lộ Trình',
                action: 'open_planner',
              },
              results: [],
            },
          });
        }
        return of({ data: {} });
      }),
    };

    mockTasteDnaService = {
      getProfile: jest.fn().mockResolvedValue({
        userId: 'user_123',
        spicy: 0.85,
        sweet: 0.3,
        sour: 0.4,
        salty: 0.5,
        umami: 0.8,
        bitter: 0.2,
        favoriteCuisines: ['Lẩu', 'Món Việt'],
        dietaryRestrictions: [],
      }),
    };

    mockInteractionsService = {
      getMatrixExport: jest
        .fn()
        .mockResolvedValue([
          { userId: 'u1', targetId: 'r1', eventType: 'REVIEW' },
        ]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RestaurantsService,
        {
          provide: getModelToken(Restaurant.name),
          useValue: mockRestaurantModel,
        },
        { provide: getModelToken(MenuItem.name), useValue: mockMenuItemModel },
        { provide: HttpService, useValue: mockHttpService },
        { provide: TasteDnaService, useValue: mockTasteDnaService },
        { provide: InteractionsService, useValue: mockInteractionsService },
      ],
    }).compile();

    service = module.get<RestaurantsService>(RestaurantsService);
  });

  it('nên được khởi tạo thành công', () => {
    expect(service).toBeDefined();
  });

  it('nên trả về gợi ý cá nhân hóa đa tầng với đầy đủ điểm số và explainability pills', async () => {
    const result = await service.getPersonalizedRecommendations(
      'user_123',
      10.7769,
      106.7009,
      300000,
      10,
    );

    expect(result.success).toBe(true);
    expect(result.total).toBe(2);
    expect(result.data.length).toBe(2);

    const firstItem = result.data[0];
    expect(firstItem._id.toString()).toBe('673100000000000000000001');
    expect(firstItem.aiScore).toBe(0.912);
    expect(firstItem.tasteScore).toBe(0.94);
    expect(firstItem.cfScore).toBe(0.88);
    expect(firstItem.explanation).toContain('Hợp khẩu vị Taste DNA');
    expect(firstItem.matchReasons.length).toBeGreaterThan(0);

    // Xác nhận mockTasteDnaService đã được gọi để lấy vector khẩu vị
    expect(mockTasteDnaService.getProfile).toHaveBeenCalledWith('user_123');
  });

  it('khi người dùng là khách vãng lai (chưa đăng nhập), vẫn trả về gợi ý an toàn', async () => {
    const result = await service.getPersonalizedRecommendations(
      undefined,
      10.7769,
      106.7009,
    );

    expect(result.success).toBe(true);
    expect(result.data.length).toBeGreaterThan(0);
    // Khi userId không có, không gọi getProfile
    expect(mockTasteDnaService.getProfile).not.toHaveBeenCalled();
  });

  it('khi AI Microservice bị lỗi, kích hoạt graceful fallback an toàn mà không bị crash', async () => {
    mockHttpService.post.mockImplementation((url: string) => {
      if (url.includes('/recommend/hybrid')) {
        return throwError(() => new Error('FastAPI Connection Refused'));
      }
      return of({ data: { weather: {}, scores: [] } });
    });

    const result = await service.getPersonalizedRecommendations(
      'user_123',
      10.7769,
      106.7009,
    );

    expect(result.success).toBe(true);
    expect(result.isColdStart).toBe(true);
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data[0].explanation).toBeDefined();
  });

  it('chatWithAI nên trả về phản hồi NLU Copilot có structured action card', async () => {
    const result = await service.chatWithAI(
      'lên lịch trình ăn uống quận 1',
      '10.7769',
      '106.7009',
      'user_123',
    );
    expect(result.intent).toBe('plan_journey');
    expect(result.action_card).toBeDefined();
    expect(result.action_card.type).toBe('planner_action');
    expect(result.reply).toContain('Food Tour');
  });

  it('chatWithAI fallback an toàn khi AI microservice trả về lỗi', async () => {
    mockHttpService.post.mockImplementationOnce(() =>
      throwError(() => new Error('Copilot Service Offline')),
    );
    const result = await service.chatWithAI(
      'tìm quán lẩu',
      '10.7769',
      '106.7009',
    );
    expect(result.reply).toBeDefined();
    expect(result.action_card).toBeDefined();
  });
});
