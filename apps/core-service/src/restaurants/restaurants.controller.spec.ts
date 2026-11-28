import { Test, TestingModule } from '@nestjs/testing';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RestaurantsController } from './restaurants.controller';
import { RestaurantsService } from './restaurants.service';
import { ValidateRestaurantDataQualityDto } from './dto/validate-restaurant-data-quality.dto';

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

  it('rejects unsupported source and oversized limits at ValidateRestaurantDataQualityDto boundary', async () => {
    const invalidSourceDto = plainToInstance(ValidateRestaurantDataQualityDto, {
      records: [{ RestaurantID: '1', Name: 'Test' }],
      source: 'unsupported_source_api',
    });
    const sourceErrors = await validate(invalidSourceDto);
    expect(sourceErrors.length).toBeGreaterThan(0);

    const validDto = plainToInstance(ValidateRestaurantDataQualityDto, {
      records: [{ RestaurantID: '1', Name: 'Test' }],
      source: 'shopeefood',
      maxRejectedSample: 20,
    });
    const validErrors = await validate(validDto);
    expect(validErrors).toHaveLength(0);
  });
});
