import { BadRequestException, NotFoundException } from '@nestjs/common';
import { model, Types } from 'mongoose';
import { HttpService } from '@nestjs/axios';
import { Restaurant, RestaurantSchema } from './schemas/restaurant.schema';
import { RestaurantsService } from './restaurants.service';

describe('Restaurants GeoJSON & Referential Integrity (M9.5)', () => {
  const RestaurantModel = model(Restaurant.name, RestaurantSchema);

  function buildService(overrides: Partial<Record<string, any>> = {}) {
    const defaultRestInstance = (payload: any) => ({
      ...payload,
      save: jest
        .fn()
        .mockResolvedValue({ _id: new Types.ObjectId(), ...payload }),
    });
    const restaurantModel: any = Object.assign(
      jest.fn().mockImplementation(defaultRestInstance),
      {
        find: jest.fn(),
        findById: jest.fn(),
        findOne: jest.fn(),
        findByIdAndUpdate: jest.fn(),
        findByIdAndDelete: jest.fn(),
        aggregate: jest.fn(),
        countDocuments: jest.fn(),
      },
      overrides.restaurantModel || {},
    );

    const menuItemModel: any = Object.assign(
      jest.fn().mockImplementation((payload: any) => ({
        ...payload,
        save: jest
          .fn()
          .mockResolvedValue({ _id: new Types.ObjectId(), ...payload }),
      })),
      {
        deleteMany: jest.fn().mockResolvedValue({ deletedCount: 2 }),
      },
      overrides.menuItemModel || {},
    );

    const reviewModel = overrides.reviewModel || {
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 3 }),
    };
    const userModel = overrides.userModel || {
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const favoriteCollectionModel = overrides.favoriteCollectionModel || {
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };

    const service = new RestaurantsService(
      restaurantModel,
      menuItemModel,
      {} as HttpService,
      undefined,
      undefined,
      reviewModel,
      userModel,
      favoriteCollectionModel,
    );

    return {
      service,
      restaurantModel,
      menuItemModel,
      reviewModel,
      userModel,
      favoriteCollectionModel,
    };
  }

  beforeEach(() => {
    process.env.INTERNAL_AI_KEY = 'test_m95_internal_ai_key_32_characters';
  });

  it('does not define startup ensureGeoJsonLocations boot scan', () => {
    const { service } = buildService();
    expect((service as any).onApplicationBootstrap).toBeUndefined();
    expect((service as any).ensureGeoJsonLocations).toBeUndefined();
  });

  it('schema validates GeoJSON bounds, rejects [0,0], and never assigns District 1 fallback default', () => {
    const missingDoc = new RestaurantModel({ tenQuan: 'No Location Cafe' });
    expect(missingDoc.validateSync()).toBeUndefined();
    expect(missingDoc.location).toBeNull();

    const validDoc = new RestaurantModel({
      tenQuan: 'Saigon Pho',
      lat: 10.7867,
      lon: 106.6881,
      location: { type: 'Point', coordinates: [106.6881, 10.7867] },
    });
    expect(validDoc.validateSync()).toBeUndefined();

    const nullIslandDoc = new RestaurantModel({
      tenQuan: 'Zero Point',
      location: { type: 'Point', coordinates: [0, 0] },
    });
    expect(nullIslandDoc.validateSync()?.errors.location).toBeDefined();

    const outOfRangeLon = new RestaurantModel({
      tenQuan: 'Bad Lon',
      location: { type: 'Point', coordinates: [195, 10.77] },
    });
    expect(outOfRangeLon.validateSync()?.errors.location).toBeDefined();

    const outOfRangeLat = new RestaurantModel({
      tenQuan: 'Bad Lat',
      location: { type: 'Point', coordinates: [106.7, -95] },
    });
    expect(outOfRangeLat.validateSync()?.errors.location).toBeDefined();
  });

  it('creates restaurant without coordinates leaving location null rather than District 1 default', async () => {
    const { service } = buildService();
    const created: any = await service.create({ tenQuan: 'Un-geocoded Diner' });
    expect(created.location).toBeNull();
    expect(created.lat).toBeUndefined();
    expect(created.lon).toBeUndefined();
  });

  it('creates restaurant with valid coordinates preserving [lon, lat] GeoJSON order and rejects invalid/[0,0]', async () => {
    const { service } = buildService();
    const valid: any = await service.create({
      tenQuan: 'Valid Rest',
      lat: 10.7931,
      lon: 106.6719,
    });
    expect(valid.location).toEqual({
      type: 'Point',
      coordinates: [106.6719, 10.7931],
    });

    await expect(
      service.create({ tenQuan: 'Zero Zero', lat: 0, lon: 0 }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.create({ tenQuan: 'Bad Lon', lat: 10.7, lon: 200 }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.create({ tenQuan: 'Partial Lat', lat: 10.7 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('findNearby excludes un-geocoded docs and rejects invalid/[0,0] centers', async () => {
    const aggregateExec = jest.fn().mockResolvedValue([
      {
        _id: new Types.ObjectId(),
        tenQuan: 'Valid Nearby',
        lat: 10.78,
        lon: 106.69,
        location: { type: 'Point', coordinates: [106.69, 10.78] },
        distanceMeters: 450,
      },
    ]);
    const { service, restaurantModel } = buildService({
      restaurantModel: {
        aggregate: jest.fn().mockReturnValue({ exec: aggregateExec }),
      },
    });

    await expect(service.findNearby(0, 0, 5, 10)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.findNearby(91, 106.7, 5, 10)).rejects.toThrow(
      BadRequestException,
    );

    const nearby = await service.findNearby(10.7769, 106.7009, 5, 10);
    expect(nearby).toHaveLength(1);
    const pipeline = restaurantModel.aggregate.mock.calls[0][0];
    expect(pipeline[0].$geoNear.query).toEqual(
      expect.objectContaining({
        'location.type': 'Point',
        'location.coordinates': { $ne: [0, 0] },
      }),
    );

    // Fallback Haversine path must exclude un-geocoded / [0,0] docs
    restaurantModel.aggregate.mockReturnValueOnce({
      exec: jest.fn().mockRejectedValue(new Error('2dsphere unavailable')),
    });
    restaurantModel.find.mockReturnValueOnce({
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        { _id: new Types.ObjectId(), tenQuan: 'Ungeocoded', location: null },
        {
          _id: new Types.ObjectId(),
          tenQuan: 'ZeroZero',
          lat: 0,
          lon: 0,
          location: { type: 'Point', coordinates: [0, 0] },
        },
        {
          _id: new Types.ObjectId(),
          tenQuan: 'Real Spot',
          lat: 10.777,
          lon: 106.701,
          location: { type: 'Point', coordinates: [106.701, 10.777] },
        },
      ]),
    });

    const fallbackResults = await service.findNearby(10.7769, 106.7009, 5, 10);
    expect(fallbackResults).toHaveLength(1);
    expect(fallbackResults[0].name).toBe('Real Spot');
  });

  it('createMenuItem throws NotFoundException if restaurant does not exist', async () => {
    const fakeRestId = new Types.ObjectId().toString();
    const { service } = buildService({
      restaurantModel: {
        findById: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue(null),
        }),
      },
    });

    await expect(
      service.createMenuItem(fakeRestId, { name: 'Orphan Dish', price: 30000 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('remove cascades menu_items, reviews, and pulls dangling savedRestaurants and favoriteCollections', async () => {
    const restId = new Types.ObjectId();
    const {
      service,
      menuItemModel,
      reviewModel,
      userModel,
      favoriteCollectionModel,
    } = buildService({
      restaurantModel: {
        findByIdAndDelete: jest.fn().mockReturnValue({
          exec: jest
            .fn()
            .mockResolvedValue({ _id: restId, tenQuan: 'Deleted Cafe' }),
        }),
      },
    });

    const deleted = await service.remove(restId.toString());
    expect(deleted._id).toEqual(restId);
    expect(menuItemModel.deleteMany).toHaveBeenCalledWith({
      restaurantId: restId,
    });
    expect(reviewModel.deleteMany).toHaveBeenCalledWith({
      restaurantId: restId,
    });
    expect(userModel.updateMany).toHaveBeenCalledWith(
      { savedRestaurants: restId },
      { $pull: { savedRestaurants: restId } },
    );
    expect(favoriteCollectionModel.updateMany).toHaveBeenCalledWith(
      { restaurantIds: restId },
      { $pull: { restaurantIds: restId } },
    );
  });
});
