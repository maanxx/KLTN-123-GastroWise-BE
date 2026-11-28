import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { HttpService } from '@nestjs/axios';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { of } from 'rxjs';
import { RestaurantsService } from './restaurants.service';
import { RestaurantsController } from './restaurants.controller';
import { DishesController } from './dishes.controller';
import { Restaurant } from './schemas/restaurant.schema';
import { MenuItem } from './schemas/menu-item.schema';
import { QueryRestaurantsDto } from './dto/query-restaurants.dto';
import { QueryDishesDto } from './dto/query-dishes.dto';
import { ROLES_KEY } from '../auth/roles.decorator';

interface RestaurantListResponse {
  data: Array<Record<string, unknown>>;
  total: number;
  page: number;
  limit: number;
  currentPage: number;
  totalPages: number;
  isBoundedResult?: boolean;
  evaluatedWindowLimit?: number;
  totalMatchingBeforePostFilter?: number;
}

function createChainMock<T>(result: T) {
  const chain: Record<string, jest.Mock> = {};
  chain.populate = jest.fn(() => chain);
  chain.sort = jest.fn(() => chain);
  chain.skip = jest.fn(() => chain);
  chain.limit = jest.fn(() => chain);
  chain.lean = jest.fn(() => chain);
  chain.exec = jest.fn().mockResolvedValue(result);
  return chain;
}

describe('M10.5 Restaurant & Dish Read APIs', () => {
  let service: RestaurantsService;
  let restaurantsController: RestaurantsController;
  let dishesController: DishesController;
  let restaurantModel: Record<string, jest.Mock>;
  let menuItemModel: Record<string, jest.Mock>;
  let httpService: { post: jest.Mock };

  const restId1 = new Types.ObjectId().toHexString();
  const restId2 = new Types.ObjectId().toHexString();
  const dishId1 = new Types.ObjectId().toHexString();

  const sampleRestaurants = [
    {
      _id: restId1,
      tenQuan: 'Phở Hòa Pasteur',
      diaChi: '260C Pasteur, Quận 3, TP. HCM',
      cityId: 'hcmc',
      diemTrungBinh: 4.5,
      ratingScale: '5_point',
      giaCa: '65.000đ - 95.000đ',
      tags: 'Phở, Món Việt',
      lat: 10.7852,
      lon: 106.6879,
      location: { type: 'Point', coordinates: [106.6879, 10.7852] },
      status: 'open',
      isVerified: true,
      isFeatured: true,
      // Internal ingestion fields must never leak in public DTOs
      ingestionBatchId: 'internal-batch-1',
      ingestionPostDigest: 'secret-digest',
      ownerId: new Types.ObjectId(),
    },
    {
      _id: restId2,
      tenQuan: 'Bánh Mì Huynh Hoa',
      diaChi: '26 Lê Thị Riêng, Quận 1, TP. HCM',
      cityId: 'hcmc',
      diemTrungBinh: 4.2,
      ratingScale: '5_point',
      giaCa: '50.000đ - 70.000đ',
      tags: 'Bánh mì, Ăn vặt',
      lat: 10.7712,
      lon: 106.6915,
      location: { type: 'Point', coordinates: [106.6915, 10.7712] },
      status: 'open',
    },
  ];

  const sampleDishes = [
    {
      _id: dishId1,
      restaurantId: {
        _id: restId1,
        tenQuan: 'Phở Hòa Pasteur',
        diaChi: '260C Pasteur, Quận 3, TP. HCM',
        lat: 10.7852,
        lon: 106.6879,
        location: { type: 'Point', coordinates: [106.6879, 10.7852] },
      },
      name: 'Phở Tái Nạm',
      description: 'Phở bò nước dùng hầm xương',
      price: 75000,
      image: 'https://images.foody.vn/pho-tai-nam.jpg',
      isVegetarian: false,
      calories: 520,
      tags: ['Phở', 'Món chính'],
      isAvailable: true,
      isFeatured: true,
    },
  ];

  beforeEach(async () => {
    process.env.INTERNAL_AI_KEY = 'test-internal-ai-key';

    restaurantModel = {
      countDocuments: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(2) }),
      find: jest.fn().mockReturnValue(createChainMock(sampleRestaurants)),
      findById: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(sampleRestaurants[0]),
      }),
      findOne: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
    };

    menuItemModel = {
      countDocuments: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(1) }),
      find: jest.fn().mockReturnValue(createChainMock(sampleDishes)),
      findById: jest.fn().mockReturnValue(createChainMock(sampleDishes[0])),
    };

    httpService = {
      post: jest.fn().mockReturnValue(of({ data: { scores: [] } })),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RestaurantsController, DishesController],
      providers: [
        RestaurantsService,
        { provide: getModelToken(Restaurant.name), useValue: restaurantModel },
        { provide: getModelToken(MenuItem.name), useValue: menuItemModel },
        { provide: HttpService, useValue: httpService },
      ],
    }).compile();

    service = module.get<RestaurantsService>(RestaurantsService);
    restaurantsController = module.get<RestaurantsController>(
      RestaurantsController,
    );
    dishesController = module.get<DishesController>(DishesController);
  });

  it('lists restaurants with pagination, coordinates, and excludes internal DB fields', async () => {
    const res = (await service.findAll(
      1,
      10,
      'rating',
      'desc',
    )) as RestaurantListResponse;
    expect(res.total).toBe(2);
    expect(res.page).toBe(1);
    expect(res.limit).toBe(10);
    expect(res.totalPages).toBe(1);
    expect(res.data).toHaveLength(2);
    expect(res.data[0]).toMatchObject({
      id: restId1,
      tenQuan: 'Phở Hòa Pasteur',
      lat: 10.7852,
      lon: 106.6879,
      lng: 106.6879,
      location: { type: 'Point', coordinates: [106.6879, 10.7852] },
    });
    expect(res.data[0].ingestionBatchId).toBeUndefined();
    expect(res.data[0].ingestionPostDigest).toBeUndefined();
    expect(res.data[0].ownerId).toBeUndefined();
  });

  it('enforces pagination boundaries and handles empty database cleanly', async () => {
    restaurantModel.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(0),
    });
    restaurantModel.find.mockReturnValue(createChainMock([]));

    const res = (await service.findAll(1, 500)) as RestaurantListResponse;
    expect(res.limit).toBe(100);
    expect(res.total).toBe(0);
    expect(res.totalPages).toBe(0);
    expect(res.data).toEqual([]);
  });

  it('supports search, district, cuisine, price range, minRating, status filters, and price sorting', async () => {
    const res = (await service.findAll(
      1,
      10,
      'price',
      'asc',
      'all',
      'false',
      '',
      '',
      'Phở',
      'hcmc',
      '',
      {
        district: 'Quận 3',
        cuisine: 'Phở',
        minPrice: 40000,
        maxPrice: 120000,
        minRating: 4.0,
        status: 'open',
      },
    )) as RestaurantListResponse;

    expect(res.data.length).toBe(2);
    // Bánh Mì (50k) sorted before Phở (65k) in price ascending order
    expect(res.data[0].id).toBe(restId2);
    expect(res.data[1].id).toBe(restId1);

    await expect(
      service.findAll(
        1,
        10,
        'price',
        'asc',
        'all',
        'false',
        '',
        '',
        '',
        '',
        '',
        {
          minPrice: 200000,
          maxPrice: 50000,
        },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('handles invalid restaurant IDs (400) and missing restaurants (404)', async () => {
    await expect(service.findOne('invalid id with spaces!')).rejects.toThrow(
      BadRequestException,
    );

    restaurantModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
    await expect(
      service.findOne(new Types.ObjectId().toHexString()),
    ).rejects.toThrow(NotFoundException);
  });

  it('lists dishes globally and by restaurant with filters, and handles dish 400/404 cleanly', async () => {
    const listRes = await dishesController.findAll({
      page: 1,
      limit: 20,
      search: 'Phở',
      minPrice: 50000,
      maxPrice: 100000,
      category: 'Phở',
      isAvailable: 'true',
      sortBy: 'price',
      order: 'asc',
    });
    expect(listRes.total).toBe(1);
    expect(listRes.data[0]).toMatchObject({
      id: dishId1,
      name: 'Phở Tái Nạm',
      price: 75000,
      restaurantId: restId1,
    });

    const byRestRes = await service.findDishesByRestaurant(restId1, {
      page: 1,
      limit: 10,
    });
    expect(byRestRes.total).toBe(1);

    const detail = await dishesController.findOne(dishId1);
    expect(detail.id).toBe(dishId1);

    await expect(
      dishesController.findOne('not-a-valid-objectid'),
    ).rejects.toThrow(BadRequestException);

    menuItemModel.findById.mockReturnValue(createChainMock(null));
    await expect(
      dishesController.findOne(new Types.ObjectId().toHexString()),
    ).rejects.toThrow(NotFoundException);

    await expect(
      service.findDishes({ restaurantId: 'bad-id' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('validates invalid query parameters on QueryRestaurantsDto and QueryDishesDto', async () => {
    const badRestDto = plainToInstance(QueryRestaurantsDto, {
      page: 0,
      limit: 500,
      minRating: 6,
      sortBy: 'invalid_sort',
    });
    const restErrors = await validate(badRestDto);
    expect(restErrors.length).toBeGreaterThanOrEqual(4);

    const badDishDto = plainToInstance(QueryDishesDto, {
      page: -1,
      limit: 250,
      minPrice: -10,
      sortBy: 'unknown',
    });
    const dishErrors = await validate(badDishDto);
    expect(dishErrors.length).toBeGreaterThanOrEqual(4);
  });

  it('preserves Admin/Owner role metadata on mutating restaurant routes while keeping read routes public', () => {
    const getHandler = (name: string): object =>
      Object.getOwnPropertyDescriptor(RestaurantsController.prototype, name)
        ?.value as object;

    const createRoles: unknown = Reflect.getMetadata(
      ROLES_KEY,
      getHandler('create'),
    );
    const deleteRoles: unknown = Reflect.getMetadata(
      ROLES_KEY,
      getHandler('remove'),
    );
    const readRoles: unknown = Reflect.getMetadata(
      ROLES_KEY,
      getHandler('findAll'),
    );
    expect(createRoles).toEqual(['admin', 'owner']);
    expect(deleteRoles).toEqual(['admin']);
    expect(readRoles).toBeUndefined();
  });

  describe('M10.5.1 pagination accuracy (>500 docs) & combined dish filters', () => {
    it('reports exact DB total for >500 restaurants on DB-side pagination without truncation', async () => {
      restaurantModel.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(650),
      });
      restaurantModel.find.mockReturnValue(createChainMock(sampleRestaurants));

      const res = (await service.findAll(
        2,
        20,
        'rating',
        'desc',
      )) as RestaurantListResponse;

      expect(res.total).toBe(650);
      expect(res.page).toBe(2);
      expect(res.limit).toBe(20);
      expect(res.totalPages).toBe(33);
      expect(res.isBoundedResult).toBe(false);
      expect(res.evaluatedWindowLimit).toBeUndefined();
    });

    it('explicitly flags bounded scan semantics when manual price-filtered dataset exceeds 500 restaurants', async () => {
      const overLimitDocs = Array.from({ length: 501 }, (_, idx) => ({
        _id: new Types.ObjectId().toHexString(),
        tenQuan: `Restaurant ${idx}`,
        diaChi: 'Quận 1, TP. HCM',
        diemTrungBinh: 4.5,
        ratingScale: '5_point',
        giaCa: '50.000đ - 90.000đ',
        status: 'open',
      }));

      restaurantModel.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(650),
      });
      restaurantModel.find.mockReturnValue(createChainMock(overLimitDocs));

      const res = (await service.findAll(
        1,
        20,
        'price',
        'asc',
        'all',
        'false',
        '',
        '',
        '',
        '',
        '',
        { minPrice: 30000, maxPrice: 120000 },
      )) as RestaurantListResponse;

      expect(res.isBoundedResult).toBe(true);
      expect(res.evaluatedWindowLimit).toBe(500);
      expect(res.totalMatchingBeforePostFilter).toBe(650);
      expect(res.total).toBe(500);
      expect(res.data).toHaveLength(20);
    });

    it('composes category AND tag simultaneously with search, price, availability, and vegetarian filters in findDishes()', async () => {
      await service.findDishes({
        search: 'Phở (Đặc biệt)',
        category: 'Món chính',
        tag: 'Phở',
        minPrice: 40000,
        maxPrice: 100000,
        isAvailable: 'true',
        isVegetarian: 'false',
        page: 1,
        limit: 10,
      });

      const calls = menuItemModel.find.mock.calls as Array<
        [{ $and?: Array<Record<string, unknown>> }]
      >;
      const executedFilter = calls[0][0];
      expect(Array.isArray(executedFilter.$and)).toBe(true);
      const clauses = executedFilter.$and || [];

      // Both category and tag must be present as separate AND clauses on tags
      const tagClauses = clauses.filter((c) => 'tags' in c);
      expect(tagClauses).toHaveLength(2);
      const tagRegexSources = tagClauses.map(
        (c) => (c.tags as { $regex: RegExp }).$regex.source,
      );
      expect(tagRegexSources).toEqual(
        expect.arrayContaining(['Món chính', 'Phở']),
      );

      // Price, availability, vegetarian, and escaped regex search must all compose together
      expect(clauses).toEqual(
        expect.arrayContaining([
          { price: { $gte: 40000, $lte: 100000 } },
          { isAvailable: true },
          { isVegetarian: false },
        ]),
      );
      const searchClause = clauses.find((c) => '$or' in c);
      expect(searchClause).toBeDefined();
      expect(JSON.stringify(searchClause)).toContain('Phở \\\\(Đặc biệt\\\\)');
    });
  });

  describe('M10.5.2 legacy menu compatibility (>200 items) & full dish query contract', () => {
    function createMockRes() {
      const headers: Record<string, string> = {};
      return {
        headers,
        res: {
          setHeader: jest.fn((key: string, value: string) => {
            headers[key] = value;
          }),
        },
      };
    }

    it('preserves array contract on GET /restaurants/:id/menu and sets truncation & migration headers when >200 items exist', async () => {
      const overLimitItems = Array.from({ length: 201 }, (_, idx) => ({
        _id: new Types.ObjectId().toHexString(),
        restaurantId: restId1,
        name: `Dish ${idx + 1}`,
        price: 50000 + idx * 1000,
        tags: ['Món chính'],
        isAvailable: true,
      }));

      menuItemModel.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(245),
      });
      menuItemModel.find.mockReturnValue(createChainMock(overLimitItems));

      const { headers, res } = createMockRes();
      const body = await restaurantsController.getMenu(restId1, res as never);

      // Backward-compatible array response body for Web & Mobile clients
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(200);

      // Explicit truncation, deprecation, and migration headers
      expect(headers['X-Legacy-Endpoint']).toBe('true');
      expect(headers['Deprecation']).toBe('true');
      expect(headers['Link']).toBe(
        `</api/v1/restaurants/${restId1}/dishes>; rel="successor-version"`,
      );
      expect(headers['X-Total-Count']).toBe('245');
      expect(headers['X-Result-Limit']).toBe('200');
      expect(headers['X-Result-Truncated']).toBe('true');
      expect(headers['Warning']).toContain(
        'truncated at 200 items (245 total)',
      );
    });

    it('preserves array contract on GET /restaurants/menu/all and sets truncation & migration headers when >200 items exist', async () => {
      const overLimitItems = Array.from({ length: 201 }, (_, idx) => ({
        _id: new Types.ObjectId().toHexString(),
        restaurantId: { _id: restId1, tenQuan: 'Phở Hòa Pasteur' },
        name: `Catalog Dish ${idx + 1}`,
        price: 45000,
        tags: ['Phở'],
        isAvailable: true,
      }));

      menuItemModel.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(310),
      });
      menuItemModel.find.mockReturnValue(createChainMock(overLimitItems));

      const { headers, res } = createMockRes();
      const body = await restaurantsController.getAllMenuItems(
        'Catalog',
        restId1,
        res as never,
      );

      // Backward-compatible array response body for Admin CMS menu page
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(200);
      expect(headers['X-Legacy-Endpoint']).toBe('true');
      expect(headers['Deprecation']).toBe('true');
      expect(headers['Link']).toBe('</api/v1/dishes>; rel="successor-version"');
      expect(headers['X-Total-Count']).toBe('310');
      expect(headers['X-Result-Limit']).toBe('200');
      expect(headers['X-Result-Truncated']).toBe('true');
      expect(headers['Warning']).toContain(
        'truncated at 200 items (310 total)',
      );
    });

    it('sets X-Result-Truncated=false and omits Warning when legacy menu has <=200 items, and preserves direct service methods', async () => {
      const { headers, res } = createMockRes();
      const body = await restaurantsController.getMenu(restId1, res as never);
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(1);
      expect(headers['X-Result-Truncated']).toBe('false');
      expect(headers['X-Total-Count']).toBe('1');
      expect(headers['Warning']).toBeUndefined();

      const directMenu = await service.getMenu(restId1);
      expect(Array.isArray(directMenu)).toBe(true);
      expect(directMenu).toHaveLength(1);

      const directAll = await service.getAllMenuItems();
      expect(Array.isArray(directAll)).toBe(true);
      expect(directAll).toHaveLength(1);
    });

    it('supports all 12 documented query parameters on GET /dishes and GET /restaurants/:id/dishes, and rejects invalid params', async () => {
      const res = await dishesController.findAll({
        page: 2,
        limit: 15,
        search: 'Phở',
        restaurantId: restId1,
        minPrice: 30000,
        maxPrice: 120000,
        category: 'Món chính',
        tag: 'Phở',
        isAvailable: 'true',
        isVegetarian: 'false',
        sortBy: 'name',
        order: 'asc',
      });
      expect(res.page).toBe(2);
      expect(res.limit).toBe(15);
      expect(res.total).toBe(1);
      expect(res.totalPages).toBe(1);

      const byRest = await restaurantsController.getRestaurantDishes(restId1, {
        page: 1,
        limit: 20,
        search: 'Phở',
        minPrice: 30000,
        maxPrice: 120000,
        category: 'Món chính',
        tag: 'Phở',
        isAvailable: 'true',
        isVegetarian: 'false',
        sortBy: 'price',
        order: 'desc',
      });
      expect(byRest.total).toBe(1);

      await expect(
        dishesController.findAll({ minPrice: 150000, maxPrice: 50000 }),
      ).rejects.toThrow(BadRequestException);

      restaurantModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });
      await expect(
        restaurantsController.getRestaurantDishes(
          new Types.ObjectId().toHexString(),
          {},
        ),
      ).rejects.toThrow(NotFoundException);

      const invalidDishDto = plainToInstance(QueryDishesDto, {
        isAvailable: 'yes',
        isVegetarian: '1',
        order: 'sideways',
      });
      const validationErrors = await validate(invalidDishDto);
      expect(validationErrors.length).toBeGreaterThanOrEqual(3);
    });
  });
});
