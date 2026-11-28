import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import {
  ItinerariesService,
  calculateHaversineDistanceKm,
  calculateTasteAffinityScore,
  parseTimeToMinutes,
  formatMinutesToTime,
} from './itineraries.service';
import { Itinerary } from './schemas/itinerary.schema';
import { CoreApiClient } from '../acl/core-api.client';
import { AiApiClient } from '../acl/ai-api.client';
import { HttpService } from '@nestjs/axios';
import { Types } from 'mongoose';

describe('ItinerariesService (Planning Microservice ACL & Heuristics)', () => {
  let service: ItinerariesService;
  let mockItineraryModel: any;
  let mockCoreApiClient: any;
  let mockAiApiClient: any;
  let mockHttpService: any;

  beforeEach(async () => {
    mockItineraryModel = jest.fn().mockImplementation((dto) => ({
      ...dto,
      save: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(), ...dto }),
    }));
    mockItineraryModel.findById = jest.fn();
    mockItineraryModel.findByIdAndUpdate = jest.fn();
    mockItineraryModel.findByIdAndDelete = jest.fn();
    mockItineraryModel.find = jest.fn();

    mockCoreApiClient = {
      getCandidates: jest.fn().mockResolvedValue([
        {
          restaurant_id: 'rest-1',
          name: 'Phở Hòa Pasteur',
          lat: 10.79,
          lng: 106.69,
          rating: 4.6,
          tags: ['Phở', 'Bò', 'Món Việt'],
          open_time: '06:00 - 22:00',
        },
        {
          restaurant_id: 'rest-2',
          name: 'Cà Phê Sữa Đá Sài Gòn',
          lat: 10.785,
          lng: 106.695,
          rating: 4.8,
          tags: ['Cà phê', 'Trà'],
          open_time: '07:00 - 23:00',
        },
      ]),
      getRestaurantById: jest.fn().mockResolvedValue({
        restaurant_id: 'rest-1',
        name: 'Phở Hòa Pasteur',
        lat: 10.79,
        lng: 106.69,
        tags: ['Phở'],
      }),
      getTasteDna: jest.fn().mockResolvedValue({
        userId: 'user-123',
        flavorProfile: {
          spicy: 0.5,
          sweet: 0.6,
          sour: 0.5,
          salty: 0.5,
          bitter: 0.3,
          umami: 0.8,
        },
      }),
      applyFeedback: jest.fn().mockResolvedValue(true),
      recordInteraction: jest.fn().mockResolvedValue(true),
    };

    mockAiApiClient = {
      optimizeRoute: jest.fn().mockResolvedValue({
        stops: [
          {
            restaurant_id: 'rest-1',
            order_index: 0,
            arrival_time: '11:30',
            departure_time: '12:15',
            transit_time_mins: 15,
            distance_km: 2.1,
          },
        ],
        total_distance_km: 2.1,
        total_duration_mins: 60,
        solver: 'OR-Tools TSPTW',
      }),
    };

    mockHttpService = {
      post: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ItinerariesService,
        {
          provide: getModelToken(Itinerary.name),
          useValue: mockItineraryModel,
        },
        {
          provide: CoreApiClient,
          useValue: mockCoreApiClient,
        },
        {
          provide: AiApiClient,
          useValue: mockAiApiClient,
        },
        {
          provide: HttpService,
          useValue: mockHttpService,
        },
      ],
    }).compile();

    service = module.get<ItinerariesService>(ItinerariesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Haversine distance & timetable math', () => {
    it('should calculate accurate distance between two Saigon coordinates', () => {
      const dist = calculateHaversineDistanceKm(
        10.7725,
        106.698,
        10.795,
        106.7219,
      );
      expect(dist).toBeGreaterThan(3.0);
    });

    it('should parse time strings to minutes and format back', () => {
      expect(parseTimeToMinutes('11:30')).toBe(690);
      expect(formatMinutesToTime(690)).toBe('11:30');
    });

    it('should calculate positive taste affinity for matched preferences', () => {
      const rest = { tags: 'lẩu, cay, nướng', tenQuan: 'Lẩu Cay Tứ Xuyên' };
      const profile = {
        flavorProfile: { spicy: 0.9, sweet: 0.5 },
        dietaryRestrictions: [],
      };
      const score = calculateTasteAffinityScore(rest, profile);
      expect(score).toBeGreaterThan(0.5);
    });
  });

  describe('generateItinerary via ACL CoreApiClient', () => {
    it('should request candidate restaurants from CoreApiClient and produce an itinerary', async () => {
      const result = await service.generateItinerary('user-123', {
        prompt: 'Tìm quán phở ngon',
        start_time: '11:00',
        end_time: '14:00',
        lat: 10.7769,
        lng: 106.7009,
        budget: 200000,
        stop_count: 2,
      });

      expect(mockCoreApiClient.getCandidates).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.stops.length).toBeGreaterThan(0);
    });

    it('should rethrow UnauthorizedException when AI Route Optimizer returns authentication error', async () => {
      mockAiApiClient.optimizeRoute.mockRejectedValueOnce(
        new UnauthorizedException(
          'AI Service authentication failed (HTTP 401)',
        ),
      );

      await expect(
        service.generateItinerary('user-123', {
          prompt: 'Tìm quán ốc ngon',
          start_time: '11:00',
          end_time: '14:00',
          lat: 10.7769,
          lng: 106.7009,
          budget: 200000,
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('addStop via ACL CoreApiClient', () => {
    it('should fetch restaurant snapshot from CoreApiClient and recalculate itinerary', async () => {
      mockItineraryModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: new Types.ObjectId(),
          user_id: 'user-123',
          stops: [],
          start_location: { coordinates: [106.7009, 10.7769] },
          save: jest.fn().mockResolvedValue({ stops: [{ stop_id: 'stop-1' }] }),
        }),
      });

      const updated = await service.addStop(
        new Types.ObjectId().toString(),
        { restaurant_id: 'rest-1' },
        'user-123',
        'user',
      );

      expect(mockCoreApiClient.getRestaurantById).toHaveBeenCalledWith(
        'rest-1',
      );
      expect(updated).toBeDefined();
    });
  });

  describe('updateStatus and non-blocking Core telemetry propagation', () => {
    it('should notify Core Service upon itinerary completion', async () => {
      const itinId = new Types.ObjectId().toString();
      mockItineraryModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: itinId,
          user_id: 'user-123',
          stops: [{ restaurant_id: 'rest-1' }],
        }),
      });

      mockItineraryModel.findByIdAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: itinId,
          user_id: 'user-123',
          stops: [{ restaurant_id: 'rest-1' }],
          status: 'completed',
        }),
      });

      await service.updateStatus(itinId, 'completed', 'user-123', 'user');

      expect(mockCoreApiClient.recordInteraction).toHaveBeenCalled();
      expect(mockCoreApiClient.applyFeedback).toHaveBeenCalled();
    });
  });

  describe('BE-02 Regression: order_index canonical 1-based indexing (no double offset)', () => {
    it('should preserve 1-based order_index [1, 2, 3] for first, middle, and last stops from AI solver', async () => {
      mockCoreApiClient.getCandidates.mockResolvedValueOnce([
        { restaurant_id: 'r1', name: 'Stop 1', lat: 10.77, lng: 106.7, rating: 4.8, tags: ['Phở'], open_time: '06:00 - 22:00' },
        { restaurant_id: 'r2', name: 'Stop 2', lat: 10.78, lng: 106.71, rating: 4.7, tags: ['Cơm'], open_time: '06:00 - 22:00' },
        { restaurant_id: 'r3', name: 'Stop 3', lat: 10.79, lng: 106.72, rating: 4.9, tags: ['Chè'], open_time: '06:00 - 22:00' },
      ]);
      mockAiApiClient.optimizeRoute.mockResolvedValueOnce({
        stops: [
          { restaurant_id: 'r1', order_index: 1, arrival_time: '11:05', departure_time: '11:50', transit_time_mins: 5, distance_km: 1.0 },
          { restaurant_id: 'r2', order_index: 2, arrival_time: '12:00', departure_time: '12:45', transit_time_mins: 10, distance_km: 1.2 },
          { restaurant_id: 'r3', order_index: 3, arrival_time: '12:55', departure_time: '13:40', transit_time_mins: 10, distance_km: 1.4 },
        ],
        total_distance_km: 3.6,
        total_duration_mins: 160,
        solver: 'OR-Tools TSPTW',
      });

      const itinerary = await service.generateItinerary('user-123', {
        prompt: 'Food tour 3 chặng',
        start_time: '11:00',
        end_time: '14:30',
        lat: 10.77,
        lng: 106.7,
        budget: 250000,
        stop_count: 3,
      });

      expect(itinerary.stops).toHaveLength(3);
      expect(itinerary.stops[0].order_index).toBe(1); // first stop
      expect(itinerary.stops[1].order_index).toBe(2); // middle stop
      expect(itinerary.stops[2].order_index).toBe(3); // last stop
    });

    it('should safely handle empty AI stops fallback with 1-based heuristic indexing and empty candidate pool', async () => {
      mockAiApiClient.optimizeRoute.mockResolvedValueOnce({
        stops: [],
        total_distance_km: 0,
        total_duration_mins: 0,
        solver: 'None',
      });

      const itinerary = await service.generateItinerary('user-123', {
        prompt: 'Food tour',
        start_time: '11:00',
        end_time: '14:00',
        lat: 10.77,
        lng: 106.7,
        budget: 200000,
        stop_count: 2,
      });

      expect(itinerary.optimizedBy).toBe('Gastronomic Progression Heuristic');
      expect(itinerary.stops.map((s) => s.order_index)).toEqual([1, 2]);

      // Completely empty candidate pool -> empty itinerary without crash
      mockCoreApiClient.getCandidates
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      mockAiApiClient.optimizeRoute.mockResolvedValueOnce({
        stops: [],
        total_distance_km: 0,
        total_duration_mins: 0,
        solver: 'None',
      });
      const emptyItinerary = await service.generateItinerary('user-123', {
        prompt: 'Empty pool',
        start_time: '11:00',
        end_time: '14:00',
        lat: 10.77,
        lng: 106.7,
        budget: 200000,
        stop_count: 2,
      });
      expect(emptyItinerary.stops).toEqual([]);
    });

    it('M10.1 Regression: forwards normalized rating, parsed price, name, tags to AiApiClient without double order_index offset', async () => {
      mockCoreApiClient.getCandidates.mockResolvedValueOnce([
        {
          restaurant_id: 'c10',
          name: 'Phở Foody 10-pt',
          lat: 10.775,
          lng: 106.701,
          rating: 8.6,
          rating_scale: '10_point',
          price_level: '65.000đ',
          tags: ['phở bò', 'nóng'],
          open_time: '06:00 - 22:00',
        },
        {
          restaurant_id: 'c5',
          name: 'Cà Phê 5-pt',
          lat: 10.778,
          lng: 106.704,
          rating: 4.5,
          rating_scale: '5_point',
          average_cost: 45000,
          tags: 'cà phê, máy lạnh',
          open_time: '07:00 - 23:00',
        },
      ]);
      mockAiApiClient.optimizeRoute.mockResolvedValueOnce({
        stops: [
          {
            restaurant_id: 'c10',
            order_index: 1,
            arrival_time: '11:05',
            departure_time: '11:50',
            transit_time_mins: 5,
            distance_km: 0.8,
            estimated_cost: 65000,
          },
          {
            restaurant_id: 'c5',
            order_index: 2,
            arrival_time: '12:00',
            departure_time: '12:45',
            transit_time_mins: 10,
            distance_km: 0.0,
            estimated_cost: 45000,
          },
        ],
        total_distance_km: 0.8,
        total_duration_mins: 100,
        solver: 'OR-Tools TSPTW',
      });

      const itinerary = await service.generateItinerary('user-123', {
        prompt: 'Phở và cà phê',
        start_time: '11:00',
        end_time: '14:00',
        lat: 10.77,
        lng: 106.7,
        budget: 200000,
        desired_stops: 2,
      });

      const optimizeArg = mockAiApiClient.optimizeRoute.mock.calls[0][0];
      expect(optimizeArg.desired_stops).toBe(2);
      // After 8.6 -> 4.3 normalization, c5 (4.5) ranks ahead of c10 (4.3)
      expect(optimizeArg.restaurants[0]).toMatchObject({
        id: 'c5',
        name: 'Cà Phê 5-pt',
        rating: 4.5,
        avg_price: 45000,
        tags: 'cà phê, máy lạnh',
      });
      expect(optimizeArg.restaurants[1]).toMatchObject({
        id: 'c10',
        name: 'Phở Foody 10-pt',
        rating: 4.3,
        avg_price: 65000,
        tags: 'phở bò, nóng',
      });
      expect(itinerary.stops.map((s) => s.order_index)).toEqual([1, 2]);
      expect(itinerary.total_cost).toBe(110000);
    });
  });

  describe('M9.5 Geospatial Integrity & Distance Regression', () => {
    it('rejects itinerary generation when starting coordinates are missing or [0, 0]', async () => {
      await expect(
        service.generateItinerary('user-123', {
          prompt: 'Missing coords',
          start_time: '11:00',
          end_time: '14:00',
        } as any),
      ).rejects.toThrow(/Valid non-zero starting coordinates/);

      await expect(
        service.generateItinerary('user-123', {
          prompt: 'Zero coords',
          start_time: '11:00',
          end_time: '14:00',
          lat: 0,
          lng: 0,
        } as any),
      ).rejects.toThrow(/Valid non-zero starting coordinates/);
    });

    it('filters out un-geocoded candidates and rejects un-geocoded addStop instead of fabricating Q1 coordinates', async () => {
      mockCoreApiClient.getCandidates.mockResolvedValueOnce([
        { restaurant_id: 'no-gps', name: 'Missing GPS Venue', rating: 4.9, tags: ['Phở'] },
        { restaurant_id: 'zero-gps', name: 'Null Island', lat: 0, lng: 0, rating: 4.9, tags: ['Phở'] },
        { restaurant_id: 'valid-gps', name: 'Valid Venue', lat: 10.78, lng: 106.69, rating: 4.5, tags: ['Phở'] },
      ]);
      mockAiApiClient.optimizeRoute.mockResolvedValueOnce({
        stops: [],
        total_distance_km: 0,
        total_duration_mins: 0,
        solver: 'None',
      });

      const itinerary = await service.generateItinerary('user-123', {
        prompt: 'Phở ngon',
        start_time: '11:00',
        end_time: '14:00',
        lat: 10.77,
        lng: 106.7,
        budget: 200000,
      });
      expect(itinerary.stops).toHaveLength(1);
      expect(itinerary.stops[0].restaurant_id).toBe('valid-gps');

      // addStop must reject a restaurant without valid coordinates
      mockItineraryModel.findById.mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue({
          _id: new Types.ObjectId(),
          user_id: 'user-123',
          stops: [],
          start_location: { type: 'Point', coordinates: [106.7, 10.77] },
        }),
      });
      mockCoreApiClient.getRestaurantById.mockResolvedValueOnce({
        restaurant_id: 'no-gps',
        name: 'No Coords Restaurant',
      });

      await expect(
        service.addStop(
          new Types.ObjectId().toString(),
          { restaurant_id: 'no-gps' },
          'user-123',
          'user',
        ),
      ).rejects.toThrow(/does not have valid non-zero coordinates/);
    });

    it('tracks previous longitude accurately across consecutive stops in recalculateTimetableAndMetrics', () => {
      const metrics = service.recalculateTimetableAndMetrics(
        [
          { restaurant_id: 's1', restaurant_name: 'Stop 1', restaurant_lat: 10.77, restaurant_lng: 106.72 },
          { restaurant_id: 's2', restaurant_name: 'Stop 2', restaurant_lat: 10.77, restaurant_lng: 106.72 },
        ],
        10.77,
        106.68,
        '11:00',
        'motorbike',
      );
      // Leg 1 moves 0.04 deg lon (~4.37 km), Leg 2 stays at same coordinates (0 km)
      expect(metrics.stops[0].distance_to_next_km).toBeGreaterThan(4.0);
      expect(metrics.stops[1].distance_to_next_km).toBe(0);
    });

    it('recalculateTimetableAndMetrics formats mixed array/unsupported stop tags and repairs duplicate/mixed AI order_index', async () => {
      const metrics = service.recalculateTimetableAndMetrics(
        [
          {
            restaurant_id: 's1',
            restaurant_name: 'Quán Cà Phê',
            restaurant_lat: 10.77,
            restaurant_lng: 106.7,
            tags: ['cà phê, sữa đá', 99 as any],
          },
        ],
        10.76,
        106.69,
        '11:00',
        'motorbike',
      );
      expect(metrics.stops[0].tags).toBe('cà phê, sữa đá');
      expect(metrics.stops[0].meal_type).toBe('cafe');
      expect(metrics.stops[0].order_index).toBe(1);

      mockCoreApiClient.getCandidates.mockResolvedValueOnce([
        {
          restaurant_id: 'r1',
          name: 'Bánh Mì Chảo',
          lat: 10.77,
          lng: 106.7,
          rating: 4.0,
          raw_rating: 4.0,
          rating_scale: 'ambiguous',
          average_cost: 55000,
          tags: ['bánh mì', 'ăn vặt'],
        },
        {
          restaurant_id: 'r2',
          name: 'Chè Khúc Bạch',
          lat: 10.78,
          lng: 106.71,
          rating: 4.5,
          average_cost: 35000,
          tags: ['chè', 'tráng miệng'],
        },
      ]);
      mockAiApiClient.optimizeRoute.mockResolvedValueOnce({
        stops: [
          { restaurant_id: 'r1', order_index: 0, arrival_time: '11:05', departure_time: '11:50', transit_time_mins: 5, distance_km: 1.0 },
          { restaurant_id: 'r2', order_index: 0, arrival_time: '12:00', departure_time: '12:45', transit_time_mins: 10, distance_km: 0.0 },
        ],
        total_distance_km: 1.0,
        total_duration_mins: 100,
        solver: 'OR-Tools TSPTW',
      });

      const itinerary = await service.generateItinerary('user-123', {
        prompt: 'Ăn nhẹ',
        start_time: '11:00',
        end_time: '14:00',
        lat: 10.76,
        lng: 106.69,
        budget: 200000,
        desired_stops: 2,
      });

      expect(itinerary.stops.map((s) => s.order_index)).toEqual([1, 2]);
      const optCall = mockAiApiClient.optimizeRoute.mock.calls[0][0];
      expect(optCall.restaurants).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'r1',
            name: 'Bánh Mì Chảo',
            meal_type: 'starter',
            avg_price: 55000,
            rating: 4.0,
            tags: 'bánh mì, ăn vặt',
            duration_mins: 45,
          }),
          expect.objectContaining({
            id: 'r2',
            name: 'Chè Khúc Bạch',
            meal_type: 'dessert',
            avg_price: 35000,
            rating: 4.5,
            tags: 'chè, tráng miệng',
            duration_mins: 45,
          }),
        ]),
      );
    });
  });

  describe('M10.12.1 P0: Fail-closed itinerary ownership authorization across all paths', () => {
    const ownerId = '6740000000000000000000a1';
    const otherUserId = '6740000000000000000000b2';
    const adminId = '6740000000000000000000ff';

    const buildItineraryDoc = (id: string, userIdValue: any) => {
      const doc: any = {
        _id: id,
        user_id: userIdValue,
        start_time: '11:00',
        routing_mode: 'motorbike',
        budget: 250000,
        status: 'generated',
        start_location: { type: 'Point', coordinates: [106.7009, 10.7769] },
        stops: [
          {
            stop_id: 'stop-1',
            restaurant_id: 'rest-1',
            order_index: 1,
            restaurant_name: 'Phở Hòa Pasteur',
            restaurant_lat: 10.7852,
            restaurant_lng: 106.6879,
            restaurant_address: '260C Pasteur, Q3',
            estimated_cost: 75000,
          },
          {
            stop_id: 'stop-2',
            restaurant_id: 'rest-2',
            order_index: 2,
            restaurant_name: 'Cà Phê Sữa Đá Sài Gòn',
            restaurant_lat: 10.785,
            restaurant_lng: 106.695,
            restaurant_address: '10 Lê Lợi, Q1',
            estimated_cost: 45000,
          },
        ],
      };
      doc.save = jest.fn().mockResolvedValue(doc);
      return doc;
    };

    const allPaths = [
      {
        name: 'getItineraryById (read)',
        invoke: (id: string, actorId?: any, actorRole?: any) =>
          service.getItineraryById(id, actorId, actorRole),
      },
      {
        name: 'updateStatus (update)',
        invoke: (id: string, actorId?: any, actorRole?: any) =>
          service.updateStatus(id, 'confirmed', actorId, actorRole),
      },
      {
        name: 'reorderStops (reorder)',
        invoke: (id: string, actorId?: any, actorRole?: any) =>
          service.reorderStops(id, ['stop-2', 'stop-1'], actorId, actorRole),
      },
      {
        name: 'recalculateItinerary (recalculate)',
        invoke: (id: string, actorId?: any, actorRole?: any) =>
          service.recalculateItinerary(
            id,
            { budget: 350000, routing_mode: 'car' },
            actorId,
            actorRole,
          ),
      },
      {
        name: 'addStop (add-stop)',
        invoke: (id: string, actorId?: any, actorRole?: any) =>
          service.addStop(id, { restaurant_id: 'rest-1' }, actorId, actorRole),
      },
      {
        name: 'removeStop (remove-stop)',
        invoke: (id: string, actorId?: any, actorRole?: any) =>
          service.removeStop(id, 'stop-2', actorId, actorRole),
      },
      {
        name: 'deleteItinerary (delete)',
        invoke: (id: string, actorId?: any, actorRole?: any) =>
          service.deleteItinerary(id, actorId, actorRole),
      },
    ];

    it('1. allows the exact itinerary owner across all 7 paths', async () => {
      for (const op of allPaths) {
        const id = new Types.ObjectId().toString();
        const doc = buildItineraryDoc(id, ownerId);
        mockItineraryModel.findById.mockReturnValueOnce({
          exec: jest.fn().mockResolvedValue(doc),
        });
        mockItineraryModel.findByIdAndUpdate.mockReturnValueOnce({
          exec: jest.fn().mockResolvedValue({ ...doc, status: 'confirmed' }),
        });
        mockItineraryModel.findByIdAndDelete.mockReturnValueOnce({
          exec: jest.fn().mockResolvedValue(doc),
        });

        await expect(op.invoke(id, ownerId, 'user')).resolves.toBeDefined();
      }
    });

    it('2. denies another non-admin user with ForbiddenException (403) across all 7 paths', async () => {
      for (const op of allPaths) {
        const id = new Types.ObjectId().toString();
        const doc = buildItineraryDoc(id, ownerId);
        mockItineraryModel.findById.mockReturnValueOnce({
          exec: jest.fn().mockResolvedValue(doc),
        });

        await expect(op.invoke(id, otherUserId, 'user')).rejects.toThrow(
          ForbiddenException,
        );
        expect(doc.save).not.toHaveBeenCalled();
      }
      expect(mockItineraryModel.findByIdAndUpdate).not.toHaveBeenCalled();
      expect(mockItineraryModel.findByIdAndDelete).not.toHaveBeenCalled();
    });

    it('3. fails closed when actorId is missing, empty, or whitespace across all 7 paths', async () => {
      for (const missingActor of [undefined, '', '   ']) {
        for (const op of allPaths) {
          const id = new Types.ObjectId().toString();
          const doc = buildItineraryDoc(id, ownerId);
          mockItineraryModel.findById.mockReturnValueOnce({
            exec: jest.fn().mockResolvedValue(doc),
          });

          await expect(op.invoke(id, missingActor, 'user')).rejects.toThrow(
            ForbiddenException,
          );
          expect(doc.save).not.toHaveBeenCalled();
        }
      }
      await expect(service.getItinerariesByUser('')).rejects.toThrow(
        ForbiddenException,
      );
      await expect(
        service.generateItinerary('   ', {
          prompt: 'Phở',
          start_time: '11:00',
          end_time: '14:00',
          lat: 10.77,
          lng: 106.7,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('4. fails closed when itinerary owner user_id is missing, null, or blank for non-admin across all 7 paths', async () => {
      for (const missingOwner of [undefined, null, '', '   ']) {
        for (const op of allPaths) {
          const id = new Types.ObjectId().toString();
          const doc = buildItineraryDoc(id, missingOwner);
          mockItineraryModel.findById.mockReturnValueOnce({
            exec: jest.fn().mockResolvedValue(doc),
          });

          await expect(op.invoke(id, ownerId, 'user')).rejects.toThrow(
            ForbiddenException,
          );
          expect(doc.save).not.toHaveBeenCalled();
        }
      }
    });

    it('5. preserves explicit admin RBAC access across all 7 paths (including non-owned and legacy unowned records)', async () => {
      for (const recordOwner of [ownerId, undefined]) {
        for (const op of allPaths) {
          const id = new Types.ObjectId().toString();
          const doc = buildItineraryDoc(id, recordOwner);
          mockItineraryModel.findById.mockReturnValueOnce({
            exec: jest.fn().mockResolvedValue(doc),
          });
          mockItineraryModel.findByIdAndUpdate.mockReturnValueOnce({
            exec: jest.fn().mockResolvedValue({ ...doc, status: 'confirmed' }),
          });
          mockItineraryModel.findByIdAndDelete.mockReturnValueOnce({
            exec: jest.fn().mockResolvedValue(doc),
          });

          await expect(op.invoke(id, adminId, 'admin')).resolves.toBeDefined();
        }
      }
    });
  });
});
