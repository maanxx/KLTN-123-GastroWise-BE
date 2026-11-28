import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { HttpService } from '@nestjs/axios';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { of, throwError } from 'rxjs';
import { RestaurantsService } from './restaurants.service';
import { RecommendationsController } from './recommendations.controller';
import { Restaurant } from './schemas/restaurant.schema';
import { MenuItem } from './schemas/menu-item.schema';
import { QueryFoodRecommendationsDto } from './dto/query-food-recommendations.dto';
import {
  extractValidatedAiScores,
  rankFoodRecommendations,
} from './food-recommendation.ranker';

function createChainMock<T>(result: T) {
  const chain: Record<string, jest.Mock> = {};
  chain.select = jest.fn(() => chain);
  chain.populate = jest.fn(() => chain);
  chain.sort = jest.fn(() => chain);
  chain.skip = jest.fn(() => chain);
  chain.limit = jest.fn(() => chain);
  chain.lean = jest.fn(() => chain);
  chain.exec = jest.fn().mockResolvedValue(result);
  return chain;
}

describe('M10.9 Food Search & Recommendation Integration', () => {
  let controller: RecommendationsController;
  let restaurantModel: Record<string, jest.Mock>;
  let menuItemModel: Record<string, jest.Mock>;
  let httpService: { post: jest.Mock };

  const restId1 = '674000000000000000000001';
  const restId2 = '674000000000000000000002';
  const restIdNoCoords = '674000000000000000000003';
  const dishId1 = new Types.ObjectId().toHexString();
  const dishId2 = new Types.ObjectId().toHexString();
  const dishId3 = new Types.ObjectId().toHexString();

  const sampleRestaurants = [
    {
      _id: restId1,
      tenQuan: 'Phở Hòa Pasteur',
      diaChi: '260C Pasteur, Quận 3, TP. HCM',
      diemTrungBinh: 4.5,
      ratingScale: '5_point',
      giaCa: '65.000đ - 95.000đ',
      tags: 'Phở, Món Việt, Mì phở',
      lat: 10.7852,
      lon: 106.6879,
      location: { type: 'Point', coordinates: [106.6879, 10.7852] },
      status: 'open',
      ingestionBatchId: 'secret-batch',
      ownerId: new Types.ObjectId(),
    },
    {
      _id: restId2,
      tenQuan: 'Bánh Mì Huynh Hoa',
      diaChi: '26 Lê Thị Riêng, Quận 1, TP. HCM',
      diemTrungBinh: 4.4,
      ratingScale: '5_point',
      giaCa: '45.000đ - 70.000đ',
      tags: 'Bánh mì, Ăn chay, Món Việt',
      lat: 10.7712,
      lon: 106.6915,
      location: { type: 'Point', coordinates: [106.6915, 10.7712] },
      status: 'open',
    },
    {
      _id: restIdNoCoords,
      tenQuan: 'Quán Chưa Có Tọa Độ',
      diaChi: 'TP. HCM',
      diemTrungBinh: 0,
      giaCa: '',
      tags: 'Phở',
      location: null,
      status: 'open',
    },
  ];

  const sampleDishes = [
    {
      _id: dishId1,
      restaurantId: restId1,
      name: 'Phở Tái Nạm',
      description: 'Phở bò nước dùng hầm xương',
      price: 75000,
      isVegetarian: false,
      tags: ['Phở', 'Món chính'],
      isAvailable: true,
      isFeatured: true,
      sourceMetadata: { token: 'must-never-leak' },
    },
    {
      _id: dishId2,
      restaurantId: restId2,
      name: 'Bánh Mì Chay Đậu Hũ Nấm',
      description: 'Đậu hũ chiên giòn, nấm đông cô',
      price: 45000,
      isVegetarian: true,
      tags: ['Bánh mì', 'Ăn chay'],
      isAvailable: true,
      isFeatured: true,
    },
    {
      _id: dishId3,
      restaurantId: restIdNoCoords,
      name: 'Phở Không Giá',
      price: 0,
      isVegetarian: false,
      tags: ['Phở'],
      isAvailable: true,
    },
  ];

  beforeEach(async () => {
    process.env.INTERNAL_AI_KEY = 'test-internal-ai-secret-key';

    restaurantModel = {
      find: jest.fn().mockReturnValue(createChainMock(sampleRestaurants)),
    };
    menuItemModel = {
      find: jest.fn().mockReturnValue(createChainMock(sampleDishes)),
    };
    httpService = {
      post: jest
        .fn()
        .mockReturnValue(throwError(() => new Error('AI service timeout'))),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RecommendationsController],
      providers: [
        RestaurantsService,
        { provide: getModelToken(Restaurant.name), useValue: restaurantModel },
        { provide: getModelToken(MenuItem.name), useValue: menuItemModel },
        { provide: HttpService, useValue: httpService },
      ],
    }).compile();

    controller = module.get<RecommendationsController>(
      RecommendationsController,
    );
  });

  it('validates DTO bounds and rejects invalid coordinates or minBudget > maxBudget with HTTP 400', async () => {
    const badDto = plainToInstance(QueryFoodRecommendationsDto, {
      latitude: 95,
      longitude: -200,
      radiusKm: 500,
      minBudget: -10,
      limit: 100,
      isVegetarian: 'maybe',
    });
    const errors = await validate(badDto);
    expect(errors.length).toBeGreaterThanOrEqual(6);

    await expect(
      controller.getFoodRecommendations({ latitude: 10.77 }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      controller.getFoodRecommendations({ latitude: 0, longitude: 0 }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      controller.getFoodRecommendations({
        minBudget: 150000,
        maxBudget: 50000,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('falls back gracefully to deterministic ranking when AI Service is unavailable and batches dishes in a single query', async () => {
    const res = await controller.getFoodRecommendations({
      keyword: 'Phở',
      latitude: 10.785,
      longitude: 106.688,
      radiusKm: 5,
      maxBudget: 100000,
      limit: 10,
    });

    expect(res.meta.strategy).toBe('deterministic');
    expect(res.data).toHaveLength(1);
    expect(res.data[0].restaurant.id).toBe(restId1);
    expect(res.data[0].recommendedDishes).toHaveLength(1);
    expect(res.data[0].recommendedDishes[0].name).toBe('Phở Tái Nạm');
    expect(res.data[0].reasons.join(' ')).toContain('Within budget');
    expect(res.data[0].reasons.join(' ')).toContain('Nearby');

    // Single batched $in query for dishes (no N+1)
    expect(menuItemModel.find).toHaveBeenCalledTimes(1);

    // Must never leak internal DB fields or internal AI credentials
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain('secret-batch');
    expect(serialized).not.toContain('must-never-leak');
    expect(serialized).not.toContain('test-internal-ai-secret-key');
  });

  it('uses hybrid strategy when AI returns verified candidate scores and strictly discards fabricated AI IDs', async () => {
    httpService.post.mockReturnValue(
      of({
        data: {
          sort_by: 'S_taste',
          scores: [
            { id: restId2, S_taste: 0.95 },
            { id: '674000000000000000009999', S_taste: 0.99 }, // fabricated ID must be ignored
          ],
        },
      }),
    );

    const res = await controller.getFoodRecommendations({
      cuisines: 'Món Việt',
      limit: 5,
    });

    expect(res.meta.strategy).toBe('hybrid');
    const returnedIds = res.data.map((item) => item.restaurant.id);
    expect(returnedIds).not.toContain('674000000000000000009999');
    expect(returnedIds).toContain(restId2);

    // Verify internal auth header is forwarded to AI Service
    const postCalls = httpService.post.mock.calls as Array<
      [string, unknown, { headers: Record<string, string>; timeout: number }]
    >;
    expect(postCalls[0][2].headers['X-Internal-AI-Key']).toBe(
      'test-internal-ai-secret-key',
    );
    expect(postCalls[0][2].timeout).toBe(2000);
  });

  it('filters vegetarian dishes strictly and ignores malformed AI payloads safely', async () => {
    httpService.post.mockReturnValue(of({ data: 'malformed-string-response' }));

    const res = await controller.getFoodRecommendations({
      isVegetarian: 'true',
      maxBudget: 60000,
    });

    expect(res.meta.strategy).toBe('deterministic');
    expect(res.data).toHaveLength(1);
    expect(res.data[0].restaurant.id).toBe(restId2);
    expect(res.data[0].recommendedDishes[0].name).toBe(
      'Bánh Mì Chay Đậu Hũ Nấm',
    );
    expect(res.data[0].reasons.join(' ')).toContain(
      'Vegetarian dishes available',
    );
  });

  it('never claims nearby when coordinates are missing, never claims within budget when price is unknown, and uses stable ID tie-breaking', () => {
    const validated = extractValidatedAiScores(
      {
        scores: [
          { id: 'unknown-id', S_taste: 1.0 },
          { id: 'a', S_taste: -5 },
        ],
      },
      new Set(['a', 'b']),
    );
    expect(validated.size).toBe(0);

    // Two identical unrated restaurants with missing coords & price -> stable ID order ('id-a' before 'id-b')
    const ranked = rankFoodRecommendations(
      [
        {
          rawRestaurant: { _id: 'id-b', tenQuan: 'Quán B', status: 'open' },
          restaurantDto: { id: 'id-b', tenQuan: 'Quán B' },
          dishDtos: [],
        },
        {
          rawRestaurant: { _id: 'id-a', tenQuan: 'Quán A', status: 'open' },
          restaurantDto: { id: 'id-a', tenQuan: 'Quán A' },
          dishDtos: [],
        },
      ],
      {
        radiusKm: 10,
        preferences: [],
        isVegetarianOnly: false,
      },
    );

    expect(ranked.map((r) => r.restaurant.id)).toEqual(['id-a', 'id-b']);
    for (const entry of ranked) {
      const joinedReasons = entry.reasons.join(' ');
      expect(joinedReasons).not.toContain('Nearby');
      expect(joinedReasons).not.toContain('Within budget');
      expect(joinedReasons).not.toContain('Rated');
    }
  });
});
