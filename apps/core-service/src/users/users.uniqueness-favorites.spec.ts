import { ConflictException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Types } from 'mongoose';
import { AuthService } from '../auth/auth.service';
import { UsersService } from './users.service';
import { FavoritesService } from '../favorites/favorites.service';
import { ReviewsService } from '../reviews/reviews.service';
import { ReviewSchema } from '../reviews/schemas/review.schema';
import { InteractionSchema } from '../interactions/schemas/interaction.schema';

describe('Identity Uniqueness, Atomic Favorites & Referential Integrity (M9.5)', () => {
  describe('Email Normalization & Case-Insensitive Lookup', () => {
    it('normalizes mixed-case whitespace emails on create and lookup', async () => {
      const savedPayload: any[] = [];
      const mockUserModel: any = Object.assign(
        jest.fn().mockImplementation((payload: any) => {
          savedPayload.push(payload);
          return {
            ...payload,
            _id: new Types.ObjectId(),
            save: jest
              .fn()
              .mockResolvedValue({ _id: new Types.ObjectId(), ...payload }),
          };
        }),
        {
          findOne: jest.fn().mockReturnValue({
            select: jest.fn().mockResolvedValue({
              _id: new Types.ObjectId(),
              email: 'alice@example.com',
              username: 'alice',
            }),
          }),
        },
      );

      const usersService = new UsersService(mockUserModel);
      await usersService.create({
        email: '  Alice.Smith@Example.COM ',
        username: ' alice_smith ',
        password: 'Password123!',
      } as any);

      expect(savedPayload[0].email).toBe('alice.smith@example.com');
      expect(savedPayload[0].username).toBe('alice_smith');

      await usersService.findOneByEmail('  ALICE@EXAMPLE.COM ');
      expect(mockUserModel.findOne).toHaveBeenCalledWith({
        email: 'alice@example.com',
      });
    });

    it('translates Mongo E11000 duplicate key error on create into ConflictException', async () => {
      const dupErr = Object.assign(new Error('E11000 duplicate key'), {
        code: 11000,
        keyPattern: { email: 1 },
      });
      const mockUserModel: any = jest.fn().mockImplementation(() => ({
        save: jest.fn().mockRejectedValue(dupErr),
      }));

      const usersService = new UsersService(mockUserModel);
      await expect(
        usersService.create({
          email: 'dup@example.com',
          username: 'dup',
          password: 'Password123!',
        } as any),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('Google OAuth Collision Prevention', () => {
    it('disambiguates colliding cross-domain usernames and preserves existing account on concurrent email race', async () => {
      process.env.INTERNAL_AI_KEY = 'test_m95_key_32_characters_minimum';
      const existingWinner = {
        _id: new Types.ObjectId(),
        email: 'alice@gmail.com',
        username: 'alice',
        role: 'user',
        status: 'active',
      };

      const mockUsersService: any = {
        findOneByEmail: jest
          .fn()
          // Initial check: not found
          .mockRejectedValueOnce(
            Object.assign(new Error('Not found'), { status: 404 }),
          )
          // Retry recovery after concurrent E11000 email collision
          .mockResolvedValueOnce(existingWinner)
          // Second test: not found initially for alice@yahoo.com
          .mockRejectedValueOnce(
            Object.assign(new Error('Not found'), { status: 404 }),
          ),
        create: jest
          .fn()
          // Race 1: email duplicate key lost the race
          .mockRejectedValueOnce(
            Object.assign(new Error('Email already exists'), {
              status: 409,
              keyPattern: { email: 1 },
            }),
          )
          // Race 2: username 'alice' taken -> retries with disambiguated username
          .mockRejectedValueOnce(
            Object.assign(new Error('Username already exists'), {
              status: 409,
              keyPattern: { username: 1 },
            }),
          )
          .mockImplementationOnce(async (dto: any) => ({
            _id: new Types.ObjectId(),
            ...dto,
            role: 'user',
            status: 'active',
          })),
        updateRefreshToken: jest.fn().mockResolvedValue(null),
      };

      const mockJwtService: any = {
        signAsync: jest.fn().mockResolvedValue('signed-jwt-token'),
      };
      const mockConfigService: any = {
        get: jest.fn((key: string) =>
          key.includes('JWT') ? 'test-jwt-secret' : undefined,
        ),
      };

      const authService = new AuthService(
        mockUsersService,
        mockJwtService,
        mockConfigService,
      );

      // 1. Concurrent email signup race returns winner account without throwing 500
      const raceRes = await authService.signInWithGoogle({
        email: '  Alice@Gmail.COM ',
        firstName: 'Alice',
        lastName: 'Nguyen',
      });
      expect(raceRes.accessToken).toBe('signed-jwt-token');

      // 2. Username collision on 'alice@yahoo.com' retries with suffixed username
      const suffixRes = await authService.signInWithGoogle({
        email: 'alice@yahoo.com',
        firstName: 'Alice',
        lastName: 'Tran',
      });
      expect(suffixRes.accessToken).toBe('signed-jwt-token');
      const secondCreateCall = mockUsersService.create.mock.calls[2][0];
      expect(secondCreateCall.username).toMatch(/^alice_[a-f0-9]{6}$/);
      expect(secondCreateCall.email).toBe('alice@yahoo.com');
    });
  });

  describe('Atomic Favorite Operations ($pull / $addToSet)', () => {
    it('uses atomic $pull and $addToSet without calling user.save() even under concurrent toggles', async () => {
      const userId = new Types.ObjectId().toString();
      const restId = new Types.ObjectId().toString();
      let isStored = false;

      const findOneAndUpdate = jest.fn(async (filter: any, update: any) => {
        if (update.$pull && isStored) {
          isStored = false;
          return { _id: filter._id, savedRestaurants: [] };
        }
        if (update.$pull && !isStored) {
          return null;
        }
        if (update.$addToSet) {
          isStored = true;
          return {
            _id: filter._id,
            savedRestaurants: [new Types.ObjectId(restId)],
          };
        }
        return null;
      });

      const favoritesService = new FavoritesService({
        findOneAndUpdate: (f: any, u: any, opts: any) => ({
          exec: () => findOneAndUpdate(f, u, opts),
        }),
      } as any);

      const first = await favoritesService.toggleFavorite(userId, restId);
      expect(first).toEqual({
        message: 'Added to favorites',
        isFavorite: true,
      });

      const second = await favoritesService.toggleFavorite(userId, restId);
      expect(second).toEqual({
        message: 'Removed from favorites',
        isFavorite: false,
      });

      // Concurrent bursts complete deterministically via atomic $addToSet/$pull
      const parallel = await Promise.all([
        favoritesService.toggleFavorite(userId, restId),
        favoritesService.toggleFavorite(userId, restId),
      ]);
      expect(parallel).toHaveLength(2);
      expect(findOneAndUpdate).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ $addToSet: expect.any(Object) }),
        expect.any(Object),
      );
    });
  });

  describe('Duplicate Review Prevention & User Deletion Integrity', () => {
    it('defines partial unique index uniq_user_restaurant_review and rejects duplicate reviews with ConflictException', async () => {
      const indexes = ReviewSchema.indexes();
      const uniqueReviewIdx = indexes.find(
        ([, opts]) => opts?.name === 'uniq_user_restaurant_review',
      );
      expect(uniqueReviewIdx).toBeDefined();
      expect(uniqueReviewIdx?.[1]?.unique).toBe(true);
      expect(uniqueReviewIdx?.[1]?.partialFilterExpression).toEqual({
        userId: { $type: 'objectId' },
      });

      process.env.INTERNAL_AI_KEY = 'test_m95_key_32_characters_minimum';
      const restId = new Types.ObjectId().toString();
      const userId = new Types.ObjectId().toString();

      const reviewsService = new ReviewsService(
        {
          findOne: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
          }),
        } as any,
        {
          findById: jest.fn().mockReturnValue({
            exec: jest
              .fn()
              .mockResolvedValue({ _id: new Types.ObjectId(restId) }),
          }),
        } as any,
        { post: jest.fn() } as any,
        {} as any,
        { recordEvent: jest.fn() } as any,
      );

      await expect(
        reviewsService.create({
          restaurantId: restId,
          userId,
          diemReview: 5,
          noiDung: 'Duplicate attempt',
        } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('cascades owned user records and anonymizes shared reviews/restaurants on user delete', async () => {
      const userId = new Types.ObjectId();
      const mockTasteDna = {
        deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      };
      const mockFavCols = {
        deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      };
      const mockNotifs = {
        deleteMany: jest.fn().mockResolvedValue({ deletedCount: 2 }),
      };
      const mockChats = {
        deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      };
      const mockReviews = {
        updateMany: jest.fn().mockResolvedValue({ modifiedCount: 2 }),
      };
      const mockRests = {
        updateMany: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      };

      const usersService = new UsersService(
        {
          findByIdAndDelete: jest.fn().mockReturnValue({
            exec: jest
              .fn()
              .mockResolvedValue({ _id: userId, email: 'u@test.com' }),
          }),
        } as any,
        mockTasteDna as any,
        mockFavCols as any,
        mockNotifs as any,
        mockChats as any,
        mockReviews as any,
        mockRests as any,
      );

      await usersService.remove(userId.toString());

      expect(mockTasteDna.deleteMany).toHaveBeenCalledWith({ userId });
      expect(mockFavCols.deleteMany).toHaveBeenCalledWith({ userId });
      expect(mockNotifs.deleteMany).toHaveBeenCalledWith({ userId });
      expect(mockChats.deleteMany).toHaveBeenCalledWith({ userId });
      expect(mockReviews.updateMany).toHaveBeenCalledWith(
        { userId },
        { $set: { userId: null, userName: 'Deleted User' } },
      );
      expect(mockRests.updateMany).toHaveBeenCalledWith(
        { ownerId: userId },
        { $set: { ownerId: null } },
      );
    });
  });

  describe('UserInteraction Model Collision Removal', () => {
    it('ensures colliding user-interaction.schema.ts files are removed and Interaction owns user_interactions', () => {
      const coreDup = path.resolve(
        __dirname,
        'schemas/user-interaction.schema.ts',
      );
      expect(fs.existsSync(coreDup)).toBe(false);
      expect(InteractionSchema.get('collection')).toBe('user_interactions');
    });
  });
});
