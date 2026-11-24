import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { HttpService } from '@nestjs/axios';
import { ReviewsService } from './reviews.service';
import { Review } from './schemas/review.schema';
import { Restaurant } from '../restaurants/schemas/restaurant.schema';
import { TasteDnaService } from '../taste-dna/taste-dna.service';
import { InteractionsService } from '../interactions/interactions.service';

describe('ReviewsService', () => {
  let service: ReviewsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewsService,
        {
          provide: getModelToken(Review.name),
          useValue: {
            find: jest.fn(),
            findById: jest.fn(),
            create: jest.fn(),
          },
        },
        {
          provide: getModelToken(Restaurant.name),
          useValue: {
            findById: jest.fn(),
            findByIdAndUpdate: jest.fn(),
          },
        },
        {
          provide: HttpService,
          useValue: {
            post: jest.fn(),
          },
        },
        {
          provide: TasteDnaService,
          useValue: {
            recordReview: jest.fn(),
          },
        },
        {
          provide: InteractionsService,
          useValue: {
            recordEvent: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ReviewsService>(ReviewsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
