import { Test, TestingModule } from '@nestjs/testing';
import { ItinerariesController } from './itineraries.controller';
import { ItinerariesService } from './itineraries.service';
import { Reflector } from '@nestjs/core';

describe('ItinerariesController', () => {
  let controller: ItinerariesController;
  let mockItinerariesService: any;

  beforeEach(async () => {
    mockItinerariesService = {
      generateItinerary: jest.fn(),
      getItinerariesByUser: jest.fn(),
      getAllItineraries: jest.fn(),
      getItineraryById: jest.fn(),
      reorderStops: jest.fn(),
      addStop: jest.fn(),
      removeStop: jest.fn(),
      recalculateItinerary: jest.fn(),
      updateStatus: jest.fn(),
      remove: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ItinerariesController],
      providers: [
        {
          provide: ItinerariesService,
          useValue: mockItinerariesService,
        },
        Reflector,
      ],
    }).compile();

    controller = module.get<ItinerariesController>(ItinerariesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should call reorderStops on PATCH :id/reorder', async () => {
    mockItinerariesService.reorderStops.mockResolvedValue({
      _id: 'itin-1',
      status: 'generated',
    });
    const req = { user: { userId: 'user-1', role: 'user' } };
    const res = await controller.reorderStops(req, 'itin-1', {
      stop_ids: ['s2', 's1'],
    });
    expect(mockItinerariesService.reorderStops).toHaveBeenCalledWith(
      'itin-1',
      ['s2', 's1'],
      'user-1',
      'user',
    );
    expect(res).toBeDefined();
  });

  it('should call addStop on POST :id/stops', async () => {
    mockItinerariesService.addStop.mockResolvedValue({ _id: 'itin-1' });
    const req = { user: { userId: 'user-1', role: 'user' } };
    const res = await controller.addStop(req, 'itin-1', {
      restaurant_id: 'rest-1',
    });
    expect(mockItinerariesService.addStop).toHaveBeenCalledWith(
      'itin-1',
      { restaurant_id: 'rest-1' },
      'user-1',
      'user',
    );
    expect(res).toBeDefined();
  });

  it('should call removeStop on DELETE :id/stops/:stopId', async () => {
    mockItinerariesService.removeStop.mockResolvedValue({ _id: 'itin-1' });
    const req = { user: { userId: 'user-1', role: 'user' } };
    const res = await controller.removeStop(req, 'itin-1', 'stop-1');
    expect(mockItinerariesService.removeStop).toHaveBeenCalledWith(
      'itin-1',
      'stop-1',
      'user-1',
      'user',
    );
    expect(res).toBeDefined();
  });

  it('should call recalculateItinerary on POST :id/recalculate', async () => {
    mockItinerariesService.recalculateItinerary.mockResolvedValue({
      _id: 'itin-1',
    });
    const req = { user: { userId: 'user-1', role: 'user' } };
    const dto = { budget: 350000, routing_mode: 'car' };
    const res = await controller.recalculateItinerary(req, 'itin-1', dto);
    expect(mockItinerariesService.recalculateItinerary).toHaveBeenCalledWith(
      'itin-1',
      dto,
      'user-1',
      'user',
    );
    expect(res).toBeDefined();
  });
});
