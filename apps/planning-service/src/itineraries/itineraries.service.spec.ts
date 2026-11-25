import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { UnauthorizedException } from '@nestjs/common';
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
  });
});
