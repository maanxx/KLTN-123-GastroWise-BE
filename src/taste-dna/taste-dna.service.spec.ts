import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { TasteDnaService } from './taste-dna.service';
import { TasteDnaProfile } from './schemas/taste-dna.schema';
import { Types } from 'mongoose';

describe('TasteDnaService (TASK-P1-01 & TASK-P1-02)', () => {
  let service: TasteDnaService;
  let mockProfileDoc: any;
  let mockModel: any;

  beforeEach(async () => {
    mockProfileDoc = {
      userId: new Types.ObjectId('64b8f0000000000000000001'),
      spicy: 0.5,
      sweet: 0.5,
      sour: 0.5,
      salty: 0.5,
      umami: 0.5,
      bitter: 0.5,
      favoriteCuisines: ['Món Việt'],
      dietaryRestrictions: [],
      budgetPreference: 'medium',
      confidenceScore: 0.3,
      interactionCount: 0,
      save: jest.fn().mockImplementation(function () {
        return Promise.resolve(this);
      }),
    };

    mockModel = jest.fn().mockImplementation((dto) => ({
      ...dto,
      save: jest.fn().mockResolvedValue(dto),
    }));

    mockModel.findOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(mockProfileDoc),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasteDnaService,
        {
          provide: getModelToken(TasteDnaProfile.name),
          useValue: mockModel,
        },
      ],
    }).compile();

    service = module.get<TasteDnaService>(TasteDnaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return existing profile with 6-D flavor coordinates', async () => {
    const profile = await service.getProfile('64b8f0000000000000000001');
    expect(profile).toBeDefined();
    expect(profile.spicy).toBe(0.5);
    expect(profile.sweet).toBe(0.5);
    expect(profile.confidenceScore).toBe(0.3);
  });

  it('should update 6-D taste sliders and boost confidence', async () => {
    const updated = await service.updateProfile('64b8f0000000000000000001', {
      spicy: 0.85,
      sweet: 0.3,
      favoriteCuisines: ['Lẩu & Nướng', 'Món Việt'],
    });

    expect(updated.spicy).toBe(0.85);
    expect(updated.sweet).toBe(0.3);
    expect(updated.confidenceScore).toBe(0.4);
    expect(mockProfileDoc.save).toHaveBeenCalled();
  });

  it('should apply feedback EMA reinforcement correctly (TASK-P1-02)', async () => {
    // Ban đầu spicy = 0.5. Sau khi ăn lẩu cay (target = 0.85, alpha = 0.15)
    // expected = (1 - 0.15) * 0.5 + 0.15 * 0.85 = 0.425 + 0.1275 = 0.5525
    const res = await service.applyFeedbackEma(
      '64b8f0000000000000000001',
      { spicy: 0.85 },
      0.15
    );

    expect(res?.spicy).toBeCloseTo(0.5525, 4);
    expect(res?.interactionCount).toBe(1);
    expect(res?.confidenceScore).toBeGreaterThan(0.4);
  });

  it('should convert onboarding quiz responses into initial continuous vector', async () => {
    const quizResult = await service.submitQuiz('64b8f0000000000000000001', {
      spicyLevel: 'hot', // map to 0.85
      sweetTooth: 'low', // map to 0.25
      savoryPreference: 'rich_umami', // map to 0.9
      cuisines: ['Món Việt', 'Hải Sản'],
      dietary: ['Không mì chính'],
      budget: 'medium',
    });

    expect(quizResult.spicy).toBe(0.85);
    expect(quizResult.sweet).toBe(0.25);
    expect(quizResult.umami).toBe(0.9);
    expect(quizResult.confidenceScore).toBe(0.55);
  });
});

