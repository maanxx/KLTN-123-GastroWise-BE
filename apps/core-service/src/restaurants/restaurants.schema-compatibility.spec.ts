import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { HttpService } from '@nestjs/axios';
import { RestaurantsService } from './restaurants.service';
import { Restaurant } from './schemas/restaurant.schema';
import { MenuItem } from './schemas/menu-item.schema';
import { InternalRestaurantsController } from '../internal/internal-restaurants.controller';

interface MappedRestaurantTestDto {
  cuisineTypes: string[];
  tags: string;
  rating: number;
  rawRating: number;
  ratingScale: string;
}

describe('M10.1 Core Restaurant Schema & Rating Compatibility', () => {
  let restaurantsService: RestaurantsService;
  let internalController: InternalRestaurantsController;
  let mockRestaurantModel: {
    find: jest.Mock;
    findById: jest.Mock;
    findOne: jest.Mock;
    countDocuments: jest.Mock;
  };

  beforeEach(async () => {
    process.env.INTERNAL_AI_KEY = 'test_internal_key_32_characters';
    mockRestaurantModel = {
      find: jest.fn(),
      findById: jest.fn(),
      findOne: jest.fn(),
      countDocuments: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InternalRestaurantsController],
      providers: [
        RestaurantsService,
        {
          provide: getModelToken(Restaurant.name),
          useValue: mockRestaurantModel,
        },
        {
          provide: getModelToken(MenuItem.name),
          useValue: {},
        },
        {
          provide: HttpService,
          useValue: { post: jest.fn() },
        },
      ],
    }).compile();

    restaurantsService = module.get<RestaurantsService>(RestaurantsService);
    internalController = module.get<InternalRestaurantsController>(
      InternalRestaurantsController,
    );
  });

  describe('RestaurantsService DTO mapping across string/array/null tags and rating scales', () => {
    it('maps array tags, string tags, and null tags without throwing tags.split TypeError', async () => {
      const validId = '507f1f77bcf86cd799439011';
      mockRestaurantModel.findById
        .mockReturnValueOnce({
          exec: jest.fn().mockResolvedValue({
            _id: validId,
            tenQuan: 'Phở Array Tags',
            tags: ['phở bò', 'nóng', 'truyền thống'],
            diemTrungBinh: 8.6,
            diemChatLuong: 8.8,
            reviewsCount: 0,
            location: { type: 'Point', coordinates: [106.701, 10.775] },
          }),
        })
        .mockReturnValueOnce({
          exec: jest.fn().mockResolvedValue({
            _id: validId,
            tenQuan: 'Cơm String Tags',
            tags: 'cơm chay, vegan',
            diemTrungBinh: 4.5,
            reviewsCount: 12,
            location: { type: 'Point', coordinates: [106.689, 10.778] },
          }),
        })
        .mockReturnValueOnce({
          exec: jest.fn().mockResolvedValue({
            _id: validId,
            tenQuan: 'Quán Null Tags & Rating',
            tags: null,
            diemTrungBinh: null,
            location: null,
          }),
        });

      const dtoArray = (await restaurantsService.findOne(
        validId,
      )) as unknown as MappedRestaurantTestDto;
      expect(dtoArray.cuisineTypes).toEqual(['phở bò', 'nóng', 'truyền thống']);
      expect(dtoArray.tags).toBe('phở bò, nóng, truyền thống');
      expect(dtoArray.rating).toBe(4.3);
      expect(dtoArray.rawRating).toBe(8.6);
      expect(dtoArray.ratingScale).toBe('10_point');

      const dtoString = (await restaurantsService.findOne(
        validId,
      )) as unknown as MappedRestaurantTestDto;
      expect(dtoString.cuisineTypes).toEqual(['cơm chay', 'vegan']);
      expect(dtoString.tags).toBe('cơm chay, vegan');
      expect(dtoString.rating).toBe(4.5);
      expect(dtoString.ratingScale).toBe('5_point');

      const dtoNull = (await restaurantsService.findOne(
        validId,
      )) as unknown as MappedRestaurantTestDto;
      expect(dtoNull.cuisineTypes).toEqual(['Nhà hàng']);
      expect(dtoNull.tags).toBe('');
      expect(dtoNull.rating).toBe(3.0);
      expect(dtoNull.ratingScale).toBe('default');
    });
  });

  describe('InternalRestaurantsController candidate & detail mapping', () => {
    it('normalizes array/string/null tags, 10-pt/5-pt/missing ratings, and average_cost safely', async () => {
      const docs = [
        {
          _id: '674700000000000000000001',
          tenQuan: 'Foody 10-pt Array Tags',
          diaChi: '10 Lê Lợi, Quận 1',
          diemTrungBinh: 8.6,
          diemChatLuong: 8.5,
          reviewsCount: 0,
          giaCa: '65.000đ',
          tags: ['phở', 'bò'],
          location: { type: 'Point', coordinates: [106.7011, 10.7755] },
        },
        {
          _id: '674700000000000000000002',
          tenQuan: 'User 5-pt String Tags',
          diaChi: '25 Võ Văn Tần, Quận 3',
          diemTrungBinh: 4.5,
          reviewsCount: 10,
          giaCa: '30.000đ - 150.000đ',
          tags: 'cơm chay, vegan',
          location: { type: 'Point', coordinates: [106.689, 10.7785] },
        },
        {
          _id: '674700000000000000000003',
          tenQuan: 'Null Tags Missing Rating',
          tags: null,
          diemTrungBinh: null,
          location: null,
        },
      ];

      mockRestaurantModel.find.mockReturnValue({
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(docs),
      });

      const res = await internalController.getCandidates();
      expect(res.total).toBe(3);

      expect(res.candidates[0]).toMatchObject({
        restaurant_id: '674700000000000000000001',
        tags: ['phở', 'bò'],
        rating: 4.3,
        raw_rating: 8.6,
        rating_scale: '10_point',
        average_cost: 65000,
      });

      expect(res.candidates[1]).toMatchObject({
        restaurant_id: '674700000000000000000002',
        tags: ['cơm chay', 'vegan'],
        rating: 4.5,
        raw_rating: 4.5,
        rating_scale: '5_point',
        average_cost: 90000,
      });

      expect(res.candidates[2]).toMatchObject({
        restaurant_id: '674700000000000000000003',
        tags: [],
        rating: 3.0,
        rating_scale: 'default',
        average_cost: 50000,
      });
    });
  });
});
