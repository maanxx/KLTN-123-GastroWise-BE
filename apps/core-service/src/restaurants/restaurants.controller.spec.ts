import { Test, TestingModule } from '@nestjs/testing';
import { RestaurantsController } from './restaurants.controller';
import { RestaurantsService } from './restaurants.service';

describe('RestaurantsController', () => {
  let controller: RestaurantsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RestaurantsController],
      providers: [
        {
          provide: RestaurantsService,
          useValue: {
            findAll: jest.fn(),
            findOne: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
            validateDataQuality: jest.fn().mockReturnValue({
              dryRun: true,
              validationStatus: 'PASSED',
            }),
          },
        },
      ],
    }).compile();

    controller = module.get<RestaurantsController>(RestaurantsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates data-quality validation requests to RestaurantsService', () => {
    const payload = { records: [{ RestaurantID: '1', Name: 'Test' }] };
    const result = controller.validateDataQuality(payload);
    expect(result).toEqual({ dryRun: true, validationStatus: 'PASSED' });
  });
});
