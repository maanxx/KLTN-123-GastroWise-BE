import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
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
});
