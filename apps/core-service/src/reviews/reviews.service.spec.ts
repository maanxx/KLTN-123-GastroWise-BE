import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { HttpService } from '@nestjs/axios';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { ReviewsService } from './reviews.service';
import { Review } from './schemas/review.schema';
import { Restaurant } from '../restaurants/schemas/restaurant.schema';
import { TasteDnaService } from '../taste-dna/taste-dna.service';
import { InteractionsService } from '../interactions/interactions.service';

describe('ReviewsService', () => {
  let service: ReviewsService;
  let mockHttpService: { post: jest.Mock };
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    process.env.INTERNAL_AI_KEY = 'test_reviews_internal_ai_key_32!';
    process.env.AI_SERVICE_URL = 'http://127.0.0.1:5000';
    mockHttpService = { post: jest.fn() };

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
          useValue: mockHttpService,
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

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should fail fast in constructor if INTERNAL_AI_KEY is missing or whitespace', () => {
    delete process.env.INTERNAL_AI_KEY;
    expect(
      () =>
        new ReviewsService(
          {} as any,
          {} as any,
          mockHttpService as any,
          {} as any,
          {} as any,
        ),
    ).toThrow(/INTERNAL_AI_KEY must be set/);

    process.env.INTERNAL_AI_KEY = '   ';
    expect(
      () =>
        new ReviewsService(
          {} as any,
          {} as any,
          mockHttpService as any,
          {} as any,
          {} as any,
        ),
    ).toThrow(/INTERNAL_AI_KEY must be set/);
  });

  it('should attach X-Internal-AI-Key header on /analyze-sentiment calls when configured', async () => {
    mockHttpService.post.mockReturnValueOnce(
      of({
        data: { label: 'POSITIVE', score: 0.92, hashtags: ['#monngon'] },
      }),
    );

    const res = await service.analyzeSentiment('Phở ngon tuyệt vời');
    expect(res).toEqual({
      label: 'POSITIVE',
      score: 0.92,
      hashtags: ['#monngon'],
    });
    expect(mockHttpService.post).toHaveBeenCalledWith(
      'http://127.0.0.1:5000/analyze-sentiment',
      { review: 'Phở ngon tuyệt vời' },
      expect.objectContaining({
        headers: {
          'X-Internal-AI-Key': 'test_reviews_internal_ai_key_32!',
        },
      }),
    );
  });

  it('should throw UnauthorizedException on 401 and ForbiddenException on 403 from AI service', async () => {
    const err401: any = new Error('Unauthorized');
    err401.response = { status: 401 };
    mockHttpService.post.mockReturnValueOnce(throwError(() => err401));
    await expect(service.analyzeSentiment('ngon')).rejects.toThrow(
      UnauthorizedException,
    );

    const err403: any = new Error('Forbidden');
    err403.response = { status: 403 };
    mockHttpService.post.mockReturnValueOnce(throwError(() => err403));
    await expect(service.analyzeSentiment('ngon')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('should fall back to local rule-based sentiment when AI service is offline', async () => {
    const netErr: any = new Error('connect ECONNREFUSED 127.0.0.1:5000');
    netErr.code = 'ECONNREFUSED';
    mockHttpService.post.mockReturnValueOnce(throwError(() => netErr));

    const res = await service.analyzeSentiment('Quán rất ngon và tuyệt');
    expect(res.label).toBe('POSITIVE');
    expect(res.hashtags).toContain('#monngon');
  });
});
