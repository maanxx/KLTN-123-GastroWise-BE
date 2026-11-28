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

    // Constant O(1) bounded dish queries (1 bounded seed query + 1 batched $in hydration; zero N+1)
    expect(menuItemModel.find).toHaveBeenCalledTimes(2);

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

  describe('M10.9 review fixes: DB-side candidate retrieval (>200 records) & strict AI score validation', () => {
    it('retrieves a matching restaurant ranked beyond global top-200 by applying keyword & cuisine filters in MongoDB query', async () => {
      // Simulate 250 restaurants in DB: top 200 are high-rated "Cơm" venues, #235 is lower-rated "Bún Bò Huế"
      const targetId = '674000000000000000000235';
      const all250Restaurants = Array.from({ length: 250 }, (_, idx) => {
        if (idx === 234) {
          return {
            _id: targetId,
            tenQuan: 'Bún Bò Huế O Xuân',
            diaChi: '12 Nguyễn Du, Quận 1, TP. HCM',
            diemTrungBinh: 3.8,
            ratingScale: '5_point',
            giaCa: '55.000đ - 75.000đ',
            tags: 'Bún bò, Huế, Món Việt',
            status: 'open',
          };
        }
        return {
          _id: `67400000000000000000${String(idx).padStart(4, '0')}`,
          tenQuan: `Quán Cơm Top ${idx}`,
          diaChi: 'Quận 1, TP. HCM',
          diemTrungBinh: 4.9,
          ratingScale: '5_point',
          giaCa: '50.000đ',
          tags: 'Cơm tấm',
          status: 'open',
        };
      });

      const restLimitSpy = jest.fn();
      // Mock restaurantModel.find to actually evaluate the DB-side $and/$or regex filter before applying .limit(200)
      restaurantModel.find.mockImplementation(
        (filter: Record<string, unknown>) => {
          const serializedFilter = JSON.stringify(filter);
          // Verify keyword & cuisine filters are pushed down to MongoDB query before limit
          expect(serializedFilter).toContain('Bún Bò Huế');
          expect(serializedFilter).toContain('Huế');

          const matched = all250Restaurants.filter(
            (r) => r.tenQuan.includes('Bún Bò Huế') && r.tags.includes('Huế'),
          );
          const chain = createChainMock(matched);
          chain.limit = jest.fn((n: number) => {
            restLimitSpy(n);
            return chain;
          });
          return chain;
        },
      );

      const dishLimitSpy = jest.fn();
      menuItemModel.find.mockImplementation(() => {
        const chain = createChainMock([
          {
            _id: new Types.ObjectId().toHexString(),
            restaurantId: targetId,
            name: 'Bún Bò Huế Đặc Biệt',
            price: 65000,
            tags: ['Bún bò', 'Huế'],
            isAvailable: true,
          },
        ]);
        chain.limit = jest.fn((n: number) => {
          dishLimitSpy(n);
          return chain;
        });
        return chain;
      });

      const res = await controller.getFoodRecommendations({
        keyword: 'Bún Bò Huế',
        cuisines: 'Huế',
        limit: 10,
      });

      expect(res.data).toHaveLength(1);
      expect(res.data[0].restaurant.id).toBe(targetId);
      expect(res.data[0].restaurant.tenQuan).toBe('Bún Bò Huế O Xuân');
      // Verify bounded resource limits are enforced on both DB queries
      expect(restLimitSpy).toHaveBeenCalledWith(200);
      expect(dishLimitSpy).toHaveBeenCalledWith(200);
    });

    it('strictly validates AI scores: accepts [0, 1] and normalizes (1, 100], rejects negative, >100, NaN, Infinity, strings, null, and fabricated IDs', () => {
      const allowedIds = new Set([
        'id-0',
        'id-half',
        'id-1',
        'id-50',
        'id-95',
        'id-100',
        'id-neg',
        'id-101',
        'id-999',
        'id-nan',
        'id-inf',
        'id-str',
        'id-null',
      ]);

      const validated = extractValidatedAiScores(
        {
          scores: [
            { id: 'id-0', S_taste: 0 },
            { id: 'id-half', S_taste: 0.5 },
            { id: 'id-1', S_taste: 1 },
            { id: 'id-50', S_taste: 50 },
            { id: 'id-95', S_taste: 95 },
            { id: 'id-100', S_taste: 100 },
            { id: 'id-neg', S_taste: -1 },
            { id: 'id-101', S_taste: 101 },
            { id: 'id-999', S_taste: 999 },
            { id: 'id-nan', S_taste: Number.NaN },
            { id: 'id-inf', S_taste: Number.POSITIVE_INFINITY },
            { id: 'id-str', S_taste: '0.9' },
            { id: 'id-null', S_taste: null },
            { id: 'fabricated-id', S_taste: 0.9 },
          ],
        },
        allowedIds,
      );

      // Valid scores in [0, 1] and (1, 100]
      expect(validated.get('id-0')).toBe(0);
      expect(validated.get('id-half')).toBe(0.5);
      expect(validated.get('id-1')).toBe(1);
      expect(validated.get('id-50')).toBe(0.5);
      expect(validated.get('id-95')).toBe(0.95);
      expect(validated.get('id-100')).toBe(1);

      // Invalid scores must be strictly rejected (never clamped to 1)
      expect(validated.has('id-neg')).toBe(false);
      expect(validated.has('id-101')).toBe(false);
      expect(validated.has('id-999')).toBe(false);
      expect(validated.has('id-nan')).toBe(false);
      expect(validated.has('id-inf')).toBe(false);
      expect(validated.has('id-str')).toBe(false);
      expect(validated.has('id-null')).toBe(false);
      expect(validated.has('fabricated-id')).toBe(false);
      expect(validated.size).toBe(6);
    });
  });

  describe('M10.10 recommendation edge-case hardening & DTO hygiene', () => {
    it('rejects negative/excessive budgets, invalid radiusKm, invalid limit, and oversized text params at service boundary', async () => {
      await expect(
        controller.getFoodRecommendations({ minBudget: -1 }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.getFoodRecommendations({ maxBudget: 99_000_000 }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.getFoodRecommendations({ radiusKm: 0 }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.getFoodRecommendations({ radiusKm: 150 }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.getFoodRecommendations({ limit: 0 }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.getFoodRecommendations({ limit: 51 }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.getFoodRecommendations({ limit: 2.5 }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.getFoodRecommendations({ keyword: 'a'.repeat(129) }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.getFoodRecommendations({ cuisines: 'x'.repeat(257) }),
      ).rejects.toThrow(BadRequestException);
    });

    it('handles whitespace-only keywords, control characters, non-existent cuisines, and restaurants without available dishes cleanly', async () => {
      // Whitespace-only keyword is treated cleanly as no keyword filter
      const wsRes = await controller.getFoodRecommendations({
        keyword: '   \t\n  ',
        limit: 5,
      });
      expect(wsRes.meta.strategy).toBe('deterministic');
      expect(wsRes.data.length).toBeGreaterThan(0);

      // Control characters + regex metacharacters in keyword must not crash
      const specialRes = await controller.getFoodRecommendations({
        keyword: 'Phở\u0000[invalid(regex',
      });
      expect(Array.isArray(specialRes.data)).toBe(true);

      // Non-existent cuisine returns clean empty result
      restaurantModel.find.mockReturnValue(createChainMock([]));
      menuItemModel.find.mockReturnValue(createChainMock([]));
      const emptyRes = await controller.getFoodRecommendations({
        cuisines: 'NonExistentMartianCuisine',
      });
      expect(emptyRes.data).toEqual([]);
      expect(emptyRes.meta.total).toBe(0);
      expect(emptyRes.meta.strategy).toBe('deterministic');

      // Open restaurant with zero available dishes returns recommendedDishes: [] when no dish-required filter is set
      restaurantModel.find.mockReturnValue(
        createChainMock([sampleRestaurants[0]]),
      );
      menuItemModel.find.mockReturnValue(createChainMock([]));
      const noDishRes = await controller.getFoodRecommendations({ limit: 5 });
      expect(noDishRes.data).toHaveLength(1);
      expect(noDishRes.data[0].recommendedDishes).toEqual([]);
    });

    it('omits bogus nested restaurant stub on unpopulated ObjectId dish references in recommendedDishes', async () => {
      const restObjId = new Types.ObjectId();
      restaurantModel.find.mockReturnValue(
        createChainMock([
          {
            ...sampleRestaurants[0],
            _id: restObjId,
          },
        ]),
      );
      menuItemModel.find.mockReturnValue(
        createChainMock([
          {
            ...sampleDishes[0],
            restaurantId: restObjId, // BSON ObjectId (unpopulated)
          },
        ]),
      );

      const res = await controller.getFoodRecommendations({ limit: 5 });
      expect(res.data).toHaveLength(1);
      expect(res.data[0].recommendedDishes).toHaveLength(1);
      expect(res.data[0].recommendedDishes[0].restaurantId).toBe(
        restObjId.toHexString(),
      );
      expect(res.data[0].recommendedDishes[0].restaurant).toBeUndefined();
    });
  });
});
