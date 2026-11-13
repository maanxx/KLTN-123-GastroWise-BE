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
import { Restaurant } from '../restaurants/schemas/restaurant.schema';
import { HttpService } from '@nestjs/axios';
import { TasteDnaService } from '../taste-dna/taste-dna.service';
import { InteractionsService } from '../interactions/interactions.service';
import { Types } from 'mongoose';
import { of } from 'rxjs';

describe('ItinerariesService (TASK-P3-01 & TASK-BIZ-02)', () => {
  let service: ItinerariesService;
  let mockItineraryModel: any;
  let mockRestaurantModel: any;
  let mockHttpService: any;
  let mockTasteDnaService: any;
  let mockInteractionsService: any;

  beforeEach(async () => {
    mockItineraryModel = jest.fn().mockImplementation((dto) => ({
      ...dto,
      save: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(), ...dto }),
    }));
    mockItineraryModel.findById = jest.fn();
    mockItineraryModel.findByIdAndUpdate = jest.fn();
    mockItineraryModel.findByIdAndDelete = jest.fn();
    mockItineraryModel.find = jest.fn();

    mockRestaurantModel = jest.fn();
    mockRestaurantModel.find = jest.fn();
    mockRestaurantModel.findById = jest.fn();

    mockHttpService = {
      post: jest.fn(),
    };

    mockTasteDnaService = {
      applyFeedbackEma: jest.fn().mockResolvedValue(true),
      getProfile: jest.fn().mockResolvedValue({
        spicy: 0.85,
        sweet: 0.75,
        favoriteCuisines: ['Lẩu', 'Món Việt'],
        dietaryRestrictions: [],
      }),
    };

    mockInteractionsService = {
      recordEvent: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ItinerariesService,
        {
          provide: getModelToken(Itinerary.name),
          useValue: mockItineraryModel,
        },
        {
          provide: getModelToken(Restaurant.name),
          useValue: mockRestaurantModel,
        },
        {
          provide: HttpService,
          useValue: mockHttpService,
        },
        {
          provide: TasteDnaService,
          useValue: mockTasteDnaService,
        },
        {
          provide: InteractionsService,
          useValue: mockInteractionsService,
        },
      ],
    }).compile();

    service = module.get<ItinerariesService>(ItinerariesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Route Distance & Time Helpers (BIZ-02-02 & BIZ-02-03)', () => {
    it('should calculate Haversine distance with 1.35x urban detour factor', () => {
      // Landmark 1: Ben Thanh Market (10.7721, 106.6983)
      // Landmark 2: Notre Dame Cathedral (10.7798, 106.6990) -> ~0.86 km straight line * 1.35 ≈ 1.16 km
      const dist = calculateHaversineDistanceKm(10.7721, 106.6983, 10.7798, 106.6990);
      expect(dist).toBeGreaterThan(0.9);
      expect(dist).toBeLessThan(1.5);
    });

    it('should correctly parse time strings to minutes and format back', () => {
      expect(parseTimeToMinutes('11:00')).toBe(660);
      expect(parseTimeToMinutes('Buổi Tối (18:30 - 21:00)')).toBe(1110);
      expect(formatMinutesToTime(660)).toBe('11:00');
      expect(formatMinutesToTime(1110)).toBe('18:30');
    });

    it('should calculate taste affinity score incorporating user preferences', () => {
      const profile = {
        spicy: 0.9,
        sweet: 0.3,
        favoriteCuisines: ['Lẩu'],
        dietaryRestrictions: ['chay'],
      };

      const restSpicy = { tenQuan: 'Lẩu Cay Trùng Khánh', tags: 'Lẩu, Cay' };
      const scoreSpicy = calculateTasteAffinityScore(restSpicy, profile);
      // Not vegetarian: penalty -0.3, spicy > 0.7: +0.2, favorite cuisine: +0.25 -> 0.5 - 0.3 + 0.2 + 0.25 = 0.65
      expect(scoreSpicy).toBeGreaterThan(0.5);

      const restVeg = { tenQuan: 'Cơm Chay Thanh Lương', tags: 'Đồ Chay' };
      const scoreVeg = calculateTasteAffinityScore(restVeg, profile);
      expect(scoreVeg).toBeGreaterThanOrEqual(0.5);
    });
  });

  describe('BIZ-02-06: Dynamic Stop Reordering', () => {
    it('should reorder stops and recalculate arrival times and distances', async () => {
      const itineraryId = '64b8f0000000000000000001';
      const userId = '64b8f0000000000000000002';

      const mockDoc: any = {
        _id: new Types.ObjectId(itineraryId),
        user_id: new Types.ObjectId(userId),
        start_location: { coordinates: [106.7009, 10.7769] },
        start_time: '11:00',
        budget: 300000,
        routing_mode: 'motorbike',
        stops: [
          {
            stop_id: 'stop-1',
            restaurant_name: 'Quán Khai Vị',
            restaurant_lat: 10.78,
            restaurant_lng: 106.70,
            dining_duration_mins: 30,
            estimated_cost: 40000,
          },
          {
            stop_id: 'stop-2',
            restaurant_name: 'Quán Món Chính',
            restaurant_lat: 10.79,
            restaurant_lng: 106.71,
            dining_duration_mins: 45,
            estimated_cost: 120000,
          },
        ],
        save: jest.fn().mockImplementation(function () {
          return Promise.resolve(this);
        }),
      };

      mockItineraryModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockDoc),
      });

      const updated = await service.reorderStops(
        itineraryId,
        ['stop-2', 'stop-1'],
        userId,
        'user',
      );

      expect(updated).toBeDefined();
      expect(updated.stops[0].stop_id).toBe('stop-2');
      expect(updated.stops[1].stop_id).toBe('stop-1');
      expect(updated.stops[0].order_index).toBe(1);
      expect(updated.stops[1].order_index).toBe(2);
      expect(updated.total_cost).toBe(160000);
      expect(updated.remaining_budget).toBe(140000);
      expect(mockDoc.save).toHaveBeenCalled();
    });

    it('should throw ForbiddenException if user is not the owner of the itinerary', async () => {
      const itineraryId = '64b8f0000000000000000001';
      const ownerId = '64b8f0000000000000000002';
      const intruderId = '64b8f0000000000000000099';

      mockItineraryModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: itineraryId,
          user_id: new Types.ObjectId(ownerId),
          stops: [],
        }),
      });

      await expect(
        service.reorderStops(itineraryId, ['s1'], intruderId, 'user'),
      ).rejects.toThrow('Access Denied: You do not own this itinerary.');
    });
  });

  describe('BIZ-02-06: Add & Remove Stops', () => {
    it('should add a new stop and recalculate timetable and costs', async () => {
      const itineraryId = '64b8f0000000000000000001';
      const userId = '64b8f0000000000000000002';
      const restId = '64b8f0000000000000000003';

      const mockDoc: any = {
        _id: new Types.ObjectId(itineraryId),
        user_id: new Types.ObjectId(userId),
        start_location: { coordinates: [106.7009, 10.7769] },
        start_time: '11:00',
        budget: 200000,
        routing_mode: 'motorbike',
        stops: [
          {
            stop_id: 'stop-1',
            restaurant_name: 'Phở Hòa Pasteur',
            restaurant_lat: 10.78,
            restaurant_lng: 106.70,
            dining_duration_mins: 45,
            estimated_cost: 60000,
          },
        ],
        save: jest.fn().mockImplementation(function () {
          return Promise.resolve(this);
        }),
      };

      mockItineraryModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockDoc),
      });

      mockRestaurantModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: new Types.ObjectId(restId),
          tenQuan: 'Chè Mâm Khánh Vy',
          lat: 10.785,
          lon: 106.705,
          tags: 'Chè, Tráng miệng',
        }),
      });

      const updated = await service.addStop(
        itineraryId,
        { restaurant_id: restId },
        userId,
        'user',
      );

      expect(updated).toBeDefined();
      expect(updated.stops.length).toBe(2);
      expect(updated.stops[1].restaurant_name).toBe('Chè Mâm Khánh Vy');
      expect(updated.stops[1].meal_type).toBe('dessert');
      expect(updated.total_cost).toBe(110000);
      expect(updated.remaining_budget).toBe(90000);
    });

    it('should remove a stop and re-index remaining stops', async () => {
      const itineraryId = '64b8f0000000000000000001';
      const userId = '64b8f0000000000000000002';

      const mockDoc: any = {
        _id: new Types.ObjectId(itineraryId),
        user_id: new Types.ObjectId(userId),
        start_location: { coordinates: [106.7009, 10.7769] },
        start_time: '11:00',
        budget: 250000,
        routing_mode: 'motorbike',
        stops: [
          {
            stop_id: 'stop-1',
            restaurant_name: 'Khai vị',
            restaurant_lat: 10.78,
            restaurant_lng: 106.70,
            dining_duration_mins: 30,
            estimated_cost: 50000,
          },
          {
            stop_id: 'stop-2',
            restaurant_name: 'Món chính',
            restaurant_lat: 10.79,
            restaurant_lng: 106.71,
            dining_duration_mins: 45,
            estimated_cost: 100000,
          },
        ],
        save: jest.fn().mockImplementation(function () {
          return Promise.resolve(this);
        }),
      };

      mockItineraryModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockDoc),
      });

      const updated = await service.removeStop(itineraryId, 'stop-1', userId, 'user');

      expect(updated).toBeDefined();
      expect(updated.stops.length).toBe(1);
      expect(updated.stops[0].stop_id).toBe('stop-2');
      expect(updated.stops[0].order_index).toBe(1);
      expect(updated.total_cost).toBe(100000);
      expect(updated.remaining_budget).toBe(150000);
    });
  });

  describe('BIZ-02-06: Recalculate Itinerary Constraints', () => {
    it('should update budget and transport mode then recalculate route', async () => {
      const itineraryId = '64b8f0000000000000000001';
      const userId = '64b8f0000000000000000002';

      const mockDoc: any = {
        _id: new Types.ObjectId(itineraryId),
        user_id: new Types.ObjectId(userId),
        start_location: { coordinates: [106.7009, 10.7769] },
        start_time: '11:00',
        budget: 200000,
        routing_mode: 'motorbike',
        stops: [
          {
            stop_id: 'stop-1',
            restaurant_name: 'Bún Bò Huế',
            restaurant_lat: 10.78,
            restaurant_lng: 106.70,
            dining_duration_mins: 45,
            estimated_cost: 55000,
          },
        ],
        save: jest.fn().mockImplementation(function () {
          return Promise.resolve(this);
        }),
      };

      mockItineraryModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockDoc),
      });

      // AI service fails -> local recalculate fallback
      mockHttpService.post.mockReturnValue({
        toPromise: jest.fn().mockRejectedValue(new Error('AI unavailable')),
      });

      const updated = await service.recalculateItinerary(
        itineraryId,
        { budget: 500000, routing_mode: 'car' },
        userId,
        'user',
      );

      expect(updated).toBeDefined();
      expect(updated.budget).toBe(500000);
      expect(updated.routing_mode).toBe('car');
      expect(updated.remaining_budget).toBe(445000);
    });
  });

  describe('Audit Trail & Taste DNA Reinforcement', () => {
    it('should trigger taste DNA reinforcement and record interaction when itinerary status is updated to completed', async () => {
      const itineraryId = '64b8f0000000000000000002';
      const userId = '64b8f0000000000000000001';
      const restId = new Types.ObjectId('64b8f0000000000000000003');

      const mockDoc = {
        _id: new Types.ObjectId(itineraryId),
        user_id: new Types.ObjectId(userId),
        status: 'completed',
        stops: [
          {
            restaurant_id: restId,
            restaurant_name: 'Lẩu Bò Nhà Gỗ',
          },
        ],
      };

      mockItineraryModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockDoc),
      });
      mockItineraryModel.findByIdAndUpdate.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockDoc),
        }),
      });

      mockRestaurantModel.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            { _id: restId, tenQuan: 'Lẩu Bò Nhà Gỗ', tags: 'Lẩu, Cay, Bò' },
          ]),
        }),
      });

      const res = await service.updateStatus(itineraryId, 'completed', userId);

      expect(res).toBeDefined();
      expect(res.status).toBe('completed');
      expect(mockInteractionsService.recordEvent).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          eventType: 'itinerary_complete',
          targetType: 'itinerary',
          targetId: itineraryId,
        }),
      );
      expect(mockTasteDnaService.applyFeedbackEma).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({ spicy: 0.8 }),
        0.12,
      );
    });
  });
});
