import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Mongoose, Types } from 'mongoose';
import { HttpService } from '@nestjs/axios';

import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { ReviewSchema } from './schemas/review.schema';
import { ReviewsService } from './reviews.service';
import { CreateRestaurantDto } from '../restaurants/dto/create-restaurant.dto';
import { CreateMenuItemDto } from '../restaurants/dto/create-menu-item.dto';
import { RestaurantSchema } from '../restaurants/schemas/restaurant.schema';
import { MenuItemSchema } from '../restaurants/schemas/menu-item.schema';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { UpdateUserDto } from '../users/dto/update-user.dto';
import { UpdateTasteDnaDto } from '../taste-dna/dto/update-taste-dna.dto';
import { BatchInteractionDto } from '../interactions/dto/batch-interaction.dto';
import { UpdateContactStatusDto } from '../contacts/dto/update-contact-status.dto';
import { ContactSchema } from '../contacts/schemas/contact.schema';
import { GenerateItineraryDto } from '../../../planning-service/src/itineraries/dto/generate-itinerary.dto';
import { UpdateItineraryStatusDto } from '../../../planning-service/src/itineraries/dto/update-itinerary-status.dto';
import { ItinerarySchema } from '../../../planning-service/src/itineraries/schemas/itinerary.schema';

describe('M9.3 DTO, Global ValidationPipe & Mongoose Schema Alignment Tests', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const isolatedMongoose = new Mongoose();
  const ReviewModel = isolatedMongoose.model('M93Review', ReviewSchema);
  const MenuItemModel = isolatedMongoose.model('M93MenuItem', MenuItemSchema);
  const ContactModel = isolatedMongoose.model('M93Contact', ContactSchema);
  const RestaurantModel = isolatedMongoose.model(
    'M93Restaurant',
    RestaurantSchema,
  );
  const ItineraryModel = isolatedMongoose.model(
    'M93Itinerary',
    ItinerarySchema,
  );

  describe('1-7. CreateReviewDto & UpdateReviewDto ValidationPipe Enforcement', () => {
    it('accepts valid 1-5 review payload and strips unknown fields under whitelist: true', async () => {
      const validId = new Types.ObjectId().toHexString();
      const transformed = (await pipe.transform(
        {
          restaurantId: validId,
          diemReview: 5,
          noiDung: 'Món phở rất ngon và đậm đà!',
          images: ['https://example.com/pho.jpg'],
          unknownMaliciousField: 'should-be-stripped',
        },
        { type: 'body', metatype: CreateReviewDto },
      )) as CreateReviewDto & Record<string, unknown>;

      expect(transformed.diemReview).toBe(5);
      expect(transformed.restaurantId).toBe(validId);
      expect(transformed.unknownMaliciousField).toBeUndefined();
    });

    it('rejects missing required fields (noiDung, diemReview, restaurantId) with BadRequestException (HTTP 400)', async () => {
      await expect(
        pipe.transform(
          { restaurantId: new Types.ObjectId().toHexString() },
          { type: 'body', metatype: CreateReviewDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects out-of-range ratings (< 1 or > 5) and non-numeric ratings with HTTP 400', async () => {
      const restId = new Types.ObjectId().toHexString();
      for (const badRating of [0, 6, 10, 'five', null]) {
        await expect(
          pipe.transform(
            {
              restaurantId: restId,
              diemReview: badRating,
              noiDung: 'Review content',
            },
            { type: 'body', metatype: CreateReviewDto },
          ),
        ).rejects.toThrow(BadRequestException);
      }
    });

    it('rejects malformed userId ObjectId in DTO and unresolvable restaurantId in ReviewsService', async () => {
      await expect(
        pipe.transform(
          {
            restaurantId: new Types.ObjectId().toHexString(),
            diemReview: 4,
            noiDung: 'Good food',
            userId: 'not-an-object-id',
          },
          { type: 'body', metatype: CreateReviewDto },
        ),
      ).rejects.toThrow(BadRequestException);

      process.env.INTERNAL_AI_KEY = 'test_m93_internal_ai_key_32chars';
      type ReviewCtor = ConstructorParameters<typeof ReviewsService>;
      const reviewsService = new ReviewsService(
        {} as unknown as ReviewCtor[0],
        {
          findOne: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(null),
          }),
        } as unknown as ReviewCtor[1],
        {
          post: jest.fn(),
        } as unknown as HttpService,
        {} as unknown as ReviewCtor[3],
        {} as unknown as ReviewCtor[4],
      );
      jest.spyOn(reviewsService, 'analyzeSentiment').mockResolvedValue({
        label: 'NEUTRAL',
        score: 0.5,
        hashtags: [],
      });

      await expect(
        reviewsService.create({
          restaurantId: 'non-existent-slug-or-bad-id',
          diemReview: 4,
          noiDung: 'Nice ambiance',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('supports Admin UpdateReviewDto status & nullable pinnedAt while rejecting invalid dates/statuses', async () => {
      const validPinClear = (await pipe.transform(
        { isFeatured: false, pinnedAt: null },
        { type: 'body', metatype: UpdateReviewDto },
      )) as UpdateReviewDto;
      expect(validPinClear.isFeatured).toBe(false);
      expect(validPinClear.pinnedAt).toBeNull();

      const validStatus = (await pipe.transform(
        { status: 'hidden', pinnedAt: '2026-11-26T05:00:00.000Z' },
        { type: 'body', metatype: UpdateReviewDto },
      )) as UpdateReviewDto;
      expect(validStatus.status).toBe('hidden');

      await expect(
        pipe.transform(
          { status: 'deleted' },
          { type: 'body', metatype: UpdateReviewDto },
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        pipe.transform(
          { pinnedAt: 'not-a-date' },
          { type: 'body', metatype: UpdateReviewDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('5-10. Nested DTOs, Enum & Schema Type Parity, and Compatibility', () => {
    it('rejects invalid nested objects in BatchInteractionDto', async () => {
      await expect(
        pipe.transform(
          {
            events: [
              {
                eventType: 'invalid_event',
                targetType: 'restaurant',
                targetId: '123',
              },
            ],
          },
          { type: 'body', metatype: BatchInteractionDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('enforces numeric bounds and enums identically across DTOs and Mongoose schemas', async () => {
      // Review [1, 5] schema parity
      const badReviewDoc = new ReviewModel({
        restaurantId: new Types.ObjectId(),
        diemReview: 9,
      });
      expect(badReviewDoc.validateSync()?.errors.diemReview).toBeDefined();

      // MenuItem min: 0 parity
      await expect(
        pipe.transform(
          { name: 'Pho', price: -5000 },
          { type: 'body', metatype: CreateMenuItemDto },
        ),
      ).rejects.toThrow(BadRequestException);
      const badMenuDoc = new MenuItemModel({
        restaurantId: new Types.ObjectId(),
        name: 'Pho',
        price: -1,
      });
      expect(badMenuDoc.validateSync()?.errors.price).toBeDefined();

      // Contact status enum parity
      await expect(
        pipe.transform(
          { status: 'ARBITRARY_STATUS' },
          { type: 'body', metatype: UpdateContactStatusDto },
        ),
      ).rejects.toThrow(BadRequestException);
      const badContactDoc = new ContactModel({
        name: 'A',
        phone: '0912345678',
        email: 'a@example.com',
        topic: 'FEEDBACK',
        message: 'Valid length contact message',
        status: 'ARBITRARY_STATUS',
      });
      expect(badContactDoc.validateSync()?.errors.status).toBeDefined();

      // TasteDNA budgetPreference enum parity
      await expect(
        pipe.transform(
          { budgetPreference: 'ultra_luxury' },
          { type: 'body', metatype: UpdateTasteDnaDto },
        ),
      ).rejects.toThrow(BadRequestException);

      // Itinerary routing_mode & status enum parity + coordinate bounds
      await expect(
        pipe.transform(
          {
            prompt: 'Tour',
            start_time: '18:00',
            end_time: '21:00',
            routing_mode: 'airplane',
          },
          { type: 'body', metatype: GenerateItineraryDto },
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        pipe.transform(
          { status: 'invalid_state' },
          { type: 'body', metatype: UpdateItineraryStatusDto },
        ),
      ).rejects.toThrow(BadRequestException);

      const badItinDoc = new ItineraryModel({
        user_id: 'u1',
        status: 'invalid_state',
      });
      expect(badItinDoc.validateSync()?.errors.status).toBeDefined();
    });

    it('preserves existing Admin-FE restaurant & user update contracts under whitelist: true', async () => {
      const adminRestPayload = (await pipe.transform(
        {
          tenQuan: 'Phở Thìn',
          diaChi: '123 Lê Lợi',
          gioMoCua: '07:00 - 22:00',
          giaCa: '50.000đ - 80.000đ',
          tags: 'Phở, Món Việt',
          moTa: 'Phở truyền thống',
          status: 'open',
          isVerified: true,
          isFeatured: false,
          diemTrungBinh: 5.0,
        },
        { type: 'body', metatype: CreateRestaurantDto },
      )) as CreateRestaurantDto;
      expect(adminRestPayload.moTa).toBe('Phở truyền thống');
      expect(adminRestPayload.status).toBe('open');

      const restDoc = new RestaurantModel({
        tenQuan: adminRestPayload.tenQuan,
        status: adminRestPayload.status,
      });
      expect(restDoc.validateSync()).toBeUndefined();

      const adminUserPatch = (await pipe.transform(
        { role: 'owner', status: 'active' },
        { type: 'body', metatype: UpdateUserDto },
      )) as UpdateUserDto;
      expect(adminUserPatch.role).toBe('owner');
      expect(adminUserPatch.status).toBe('active');

      const validUser = (await pipe.transform(
        {
          username: 'thien',
          email: 'thien@example.com',
          password: 'Password123',
          firstName: 'Thien',
          picture: 'https://example.com/avatar.png',
        },
        { type: 'body', metatype: CreateUserDto },
      )) as CreateUserDto;
      expect(validUser.firstName).toBe('Thien');
      expect(validUser.picture).toBe('https://example.com/avatar.png');
    });
  });
});
