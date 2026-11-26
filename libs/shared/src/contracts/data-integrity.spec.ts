import 'reflect-metadata';
import { Mongoose, Types } from 'mongoose';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { UserSchema } from '../../../../apps/core-service/src/users/schemas/user.schema';
import { RestaurantSchema } from '../../../../apps/core-service/src/restaurants/schemas/restaurant.schema';
import { MenuItemSchema } from '../../../../apps/core-service/src/restaurants/schemas/menu-item.schema';
import { ReviewSchema } from '../../../../apps/core-service/src/reviews/schemas/review.schema';
import {
  ContactSchema,
  ContactTopic,
} from '../../../../apps/core-service/src/contacts/schemas/contact.schema';
import {
  InteractionEventType,
  InteractionSchema,
  TargetType,
} from '../../../../apps/core-service/src/interactions/schemas/interaction.schema';
import { TasteDnaSchema } from '../../../../apps/core-service/src/taste-dna/schemas/taste-dna.schema';
import { ItinerarySchema } from '../../../../apps/planning-service/src/itineraries/schemas/itinerary.schema';

import { CreateContactDto } from '../../../../apps/core-service/src/contacts/dto/create-contact.dto';
import { UpdateTasteDnaDto } from '../../../../apps/core-service/src/taste-dna/dto/update-taste-dna.dto';
import { CreateInteractionDto } from '../../../../apps/core-service/src/interactions/dto/create-interaction.dto';
import { CreateReviewDto } from '../../../../apps/core-service/src/reviews/dto/create-review.dto';
import { CreateUserDto } from '../../../../apps/core-service/src/users/dto/create-user.dto';
import { GenerateItineraryDto } from '../../../../apps/planning-service/src/itineraries/dto/generate-itinerary.dto';

function detectDuplicateUserRestaurantReviews(
  reviews: Array<{ userId?: string; restaurantId: string }>,
): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const review of reviews) {
    if (!review.userId) continue;
    const key = `${review.userId}::${review.restaurantId}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ key, count }));
}

function detectCaseVariantDuplicateEmails(
  users: Array<{ email: string }>,
): Array<{ normalizedEmail: string; variants: string[] }> {
  const grouped = new Map<string, string[]>();
  for (const user of users) {
    const normalized = user.email.trim().toLowerCase();
    const list = grouped.get(normalized) ?? [];
    list.push(user.email);
    grouped.set(normalized, list);
  }
  return Array.from(grouped.entries())
    .filter(([, variants]) => variants.length > 1)
    .map(([normalizedEmail, variants]) => ({ normalizedEmail, variants }));
}

describe('M8.6 Data Integrity & Consistency Fixture Tests (In-Memory Only)', () => {
  const isolatedMongoose = new Mongoose();

  const UserModel = isolatedMongoose.model('IntegrityTestUser', UserSchema);
  const RestaurantModel = isolatedMongoose.model(
    'IntegrityTestRestaurant',
    RestaurantSchema,
  );
  const MenuItemModel = isolatedMongoose.model(
    'IntegrityTestMenuItem',
    MenuItemSchema,
  );
  const ReviewModel = isolatedMongoose.model(
    'IntegrityTestReview',
    ReviewSchema,
  );
  const ContactModel = isolatedMongoose.model(
    'IntegrityTestContact',
    ContactSchema,
  );
  const InteractionModel = isolatedMongoose.model(
    'IntegrityTestInteraction',
    InteractionSchema,
  );
  const TasteDnaModel = isolatedMongoose.model(
    'IntegrityTestTasteDna',
    TasteDnaSchema,
  );
  const ItineraryModel = isolatedMongoose.model(
    'IntegrityTestItinerary',
    ItinerarySchema,
  );

  describe('1. Mongoose Schema Required Fields & ObjectId References', () => {
    it('rejects User missing required username, email, or password', () => {
      const doc = new UserModel({});
      const err = doc.validateSync();
      expect(err).toBeDefined();
      expect(err?.errors.username).toBeDefined();
      expect(err?.errors.email).toBeDefined();
      expect(err?.errors.password).toBeDefined();
    });

    it('rejects MenuItem missing restaurantId, name, or price and rejects malformed ObjectId', () => {
      const missingDoc = new MenuItemModel({});
      const missingErr = missingDoc.validateSync();
      expect(missingErr).toBeDefined();
      expect(missingErr?.errors.restaurantId).toBeDefined();
      expect(missingErr?.errors.name).toBeDefined();
      expect(missingErr?.errors.price).toBeDefined();

      const invalidRefDoc = new MenuItemModel({
        restaurantId: 'not-an-object-id',
        name: 'Pho Bo',
        price: 55000,
      });
      const invalidRefErr = invalidRefDoc.validateSync();
      expect(invalidRefErr).toBeDefined();
      expect(invalidRefErr?.errors.restaurantId).toBeDefined();
    });

    it('rejects Review missing restaurantId or containing invalid restaurantId ObjectId', () => {
      const missingDoc = new ReviewModel({ comment: 'Great food' });
      const missingErr = missingDoc.validateSync();
      expect(missingErr?.errors.restaurantId).toBeDefined();

      const badIdDoc = new ReviewModel({
        restaurantId: 'invalid-object-id',
        diemReview: 5,
      });
      const badIdErr = badIdDoc.validateSync();
      expect(badIdErr?.errors.restaurantId).toBeDefined();
    });

    it('rejects TasteDnaProfile missing userId or containing invalid userId ObjectId', () => {
      const missingDoc = new TasteDnaModel({});
      expect(missingDoc.validateSync()?.errors.userId).toBeDefined();

      const badIdDoc = new TasteDnaModel({ userId: 'bad-id' });
      expect(badIdDoc.validateSync()?.errors.userId).toBeDefined();
    });

    it('rejects Itinerary missing user_id or embedded stop missing restaurant_id', () => {
      const doc = new ItineraryModel({
        stops: [{ meal_type: 'main' }],
      });
      const err = doc.validateSync();
      expect(err).toBeDefined();
      expect(err?.errors.user_id).toBeDefined();
      expect(err?.errors['stops.0.restaurant_id']).toBeDefined();
    });
  });

  describe('2. Mongoose Schema Enum & Numeric Boundary Constraints', () => {
    it('enforces Restaurant.status enum and sets default GeoJSON coordinates', () => {
      const validDoc = new RestaurantModel({ name: 'Quan An Ngon' });
      expect(validDoc.validateSync()).toBeUndefined();
      expect(validDoc.status).toBe('open');
      expect(validDoc.location?.coordinates).toEqual([106.7009, 10.7769]);

      const badDoc = new RestaurantModel({ status: 'archived' });
      expect(badDoc.validateSync()?.errors.status).toBeDefined();
    });

    it('enforces Review.status enum', () => {
      const validId = new Types.ObjectId();
      const okDoc = new ReviewModel({ restaurantId: validId, status: 'active' });
      expect(okDoc.validateSync()).toBeUndefined();

      const badDoc = new ReviewModel({
        restaurantId: validId,
        status: 'deleted',
      });
      expect(badDoc.validateSync()?.errors.status).toBeDefined();
    });

    it('enforces Contact required fields and ContactTopic enum', () => {
      const okDoc = new ContactModel({
        name: 'Nguyen Van A',
        phone: '0912345678',
        email: 'a@example.com',
        topic: ContactTopic.FEEDBACK,
        message: 'Great platform experience!',
      });
      expect(okDoc.validateSync()).toBeUndefined();

      const badDoc = new ContactModel({
        name: 'Nguyen Van A',
        phone: '0912345678',
        email: 'a@example.com',
        topic: 'INVALID_TOPIC',
        message: 'Great platform experience!',
      });
      expect(badDoc.validateSync()?.errors.topic).toBeDefined();
    });

    it('enforces Interaction eventType and targetType enums', () => {
      const badDoc = new InteractionModel({
        userId: new Types.ObjectId(),
        eventType: 'unknown_event',
        targetType: 'unknown_target',
      });
      const err = badDoc.validateSync();
      expect(err?.errors.eventType).toBeDefined();
      expect(err?.errors.targetType).toBeDefined();

      const okDoc = new InteractionModel({
        userId: new Types.ObjectId(),
        eventType: InteractionEventType.VIEW,
        targetType: TargetType.RESTAURANT,
        targetId: new Types.ObjectId().toHexString(),
      });
      expect(okDoc.validateSync()).toBeUndefined();

      const missingTargetDoc = new InteractionModel({
        userId: new Types.ObjectId(),
        eventType: InteractionEventType.VIEW,
        targetType: TargetType.RESTAURANT,
      });
      expect(missingTargetDoc.validateSync()?.errors.targetId).toBeDefined();
    });

    it('enforces TasteDnaProfile 6-D vector [0.0, 1.0], confidenceScore [0.0, 1.0], and budgetPreference enum', () => {
      const userId = new Types.ObjectId();
      const outOfBounds = new TasteDnaModel({
        userId,
        spicy: 1.5,
        sweet: -0.1,
        sour: 0.5,
        salty: 0.5,
        umami: 0.5,
        bitter: 0.5,
        confidenceScore: 2.0,
        budgetPreference: 'luxury',
      });
      const err = outOfBounds.validateSync();
      expect(err?.errors.spicy).toBeDefined();
      expect(err?.errors.sweet).toBeDefined();
      expect(err?.errors.confidenceScore).toBeDefined();
      expect(err?.errors.budgetPreference).toBeDefined();
    });

    it('enforces Itinerary routing_mode and embedded ItineraryStop meal_type enums', () => {
      const badDoc = new ItineraryModel({
        user_id: new Types.ObjectId().toHexString(),
        routing_mode: 'helicopter',
        stops: [
          {
            restaurant_id: new Types.ObjectId().toHexString(),
            meal_type: 'brunch',
          },
        ],
      });
      const err = badDoc.validateSync();
      expect(err?.errors.routing_mode).toBeDefined();
      expect(err?.errors['stops.0.meal_type']).toBeDefined();
    });
  });

  describe('3. DTO Validation (class-validator) & Audited Drift Findings', () => {
    it('validates CreateContactDto Vietnamese phone regex and message length', () => {
      const badDto = plainToInstance(CreateContactDto, {
        name: 'Thien',
        phone: '12345',
        email: 'not-an-email',
        topic: ContactTopic.FEEDBACK,
        message: 'short',
      });
      const errors = validateSync(badDto);
      const props = errors.map((e) => e.property);
      expect(props).toEqual(
        expect.arrayContaining(['phone', 'email', 'message']),
      );
    });

    it('validates UpdateTasteDnaDto [0.0, 1.0] vector bounds and CreateInteractionDto enums', () => {
      const badTaste = plainToInstance(UpdateTasteDnaDto, { spicy: 1.2 });
      expect(validateSync(badTaste).map((e) => e.property)).toContain('spicy');

      const badInteraction = plainToInstance(CreateInteractionDto, {
        eventType: 'bad_event',
        targetType: 'bad_target',
        targetId: '123',
      });
      expect(validateSync(badInteraction).map((e) => e.property)).toEqual(
        expect.arrayContaining(['eventType', 'targetType']),
      );
    });

    it('validates GenerateItineraryDto required fields', () => {
      const emptyDto = plainToInstance(GenerateItineraryDto, {});
      expect(validateSync(emptyDto).map((e) => e.property)).toEqual(
        expect.arrayContaining(['prompt', 'start_time', 'end_time']),
      );
    });

    it('confirms M9.2 remediation: UserSchema defines hashedRefreshToken and resetOtpExpiresAt paths', () => {
      expect(UserSchema.path('hashedRefreshToken')).toBeDefined();
      expect(UserSchema.path('resetOtpExpiresAt')).toBeDefined();
    });

    it('confirms M9.3 remediation: CreateReviewDto rejects diemReview > 5 and enforces 1-5 scale', () => {
      const dto = plainToInstance(CreateReviewDto, {
        restaurantId: new Types.ObjectId().toHexString(),
        diemReview: 10,
        noiDung: 'Food was amazing',
      });
      expect(validateSync(dto).map((e) => e.property)).toContain('diemReview');

      const validDto = plainToInstance(CreateReviewDto, {
        restaurantId: new Types.ObjectId().toHexString(),
        diemReview: 5,
        noiDung: 'Food was amazing',
      });
      expect(validateSync(validDto)).toHaveLength(0);
    });

    it('confirms M9.3 remediation: CreateUserDto validates picture URL instead of firstName', () => {
      const dto = plainToInstance(CreateUserDto, {
        username: 'thien',
        email: 'thien@example.com',
        password: 'Password123',
        firstName: 'Thien',
        picture: 'not-a-url',
      });
      const errors = validateSync(dto);
      const props = errors.map((e) => e.property);
      expect(props).not.toContain('firstName');
      expect(props).toContain('picture');
    });
  });

  describe('4. Duplicate & Case-Sensitivity Integrity Helpers (Fixture Detection)', () => {
    it('detects duplicate (userId, restaurantId) review fixtures that lack a schema unique index', () => {
      const duplicates = detectDuplicateUserRestaurantReviews([
        { userId: 'u1', restaurantId: 'r1' },
        { userId: 'u1', restaurantId: 'r1' },
        { userId: 'u2', restaurantId: 'r1' },
      ]);
      expect(duplicates).toEqual([{ key: 'u1::r1', count: 2 }]);
    });

    it('detects case-variant duplicate email fixtures caused by case-sensitive unique index', () => {
      const collisions = detectCaseVariantDuplicateEmails([
        { email: 'Alice@Example.com' },
        { email: 'alice@example.com' },
        { email: 'bob@example.com' },
      ]);
      expect(collisions).toEqual([
        {
          normalizedEmail: 'alice@example.com',
          variants: ['Alice@Example.com', 'alice@example.com'],
        },
      ]);
    });
  });
});
