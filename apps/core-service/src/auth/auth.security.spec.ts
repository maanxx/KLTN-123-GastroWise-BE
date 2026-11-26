import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, HttpStatus, Logger } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { Types } from 'mongoose';
import type { Db } from 'mongodb';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { UserSchema } from '../users/schemas/user.schema';
import { v002UserSecurityFieldsMigration } from '../../../../scripts/migrations/core/v002_user_security_fields.migration';
import { JsonMigrationLogger } from '@shared/migrations';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'mock-msg-id' }),
  })),
  createTestAccount: jest.fn().mockResolvedValue({
    user: 'ethereal-user',
    pass: 'ethereal-pass',
  }),
  getTestMessageUrl: jest.fn(
    () => 'https://ethereal.email/message/SECRET-OTP-URL',
  ),
}));

interface StoredUser {
  _id: string;
  username: string;
  email: string;
  password: string;
  role: string;
  status: string;
  hashedRefreshToken: string | null;
  resetOtp: string | null;
  resetOtpExpiresAt: Date | null;
  toObject: () => Record<string, unknown>;
}

describe('M9.2 Authentication, Refresh Token & OTP Security Integration Tests (Real bcrypt + JWT + Controller)', () => {
  let authController: AuthController;
  let authService: AuthService;
  let jwtService: JwtService;
  const usersStore = new Map<string, StoredUser>();

  const JWT_SECRET = 'test_jwt_secret_for_m92_32_characters_min';
  const JWT_REFRESH_SECRET = 'test_refresh_secret_for_m92_32_chars_min';

  const makeStoredUser = (
    data: Partial<StoredUser> & { email: string; password: string },
  ): StoredUser => {
    const id = data._id ?? new Types.ObjectId().toHexString();
    const record: StoredUser = {
      _id: id,
      username: data.username ?? 'user_' + id.slice(-4),
      email: data.email,
      password: data.password,
      role: data.role ?? 'user',
      status: data.status ?? 'active',
      hashedRefreshToken: data.hashedRefreshToken ?? null,
      resetOtp: data.resetOtp ?? null,
      resetOtpExpiresAt: data.resetOtpExpiresAt ?? null,
      toObject: () => ({
        _id: record._id,
        username: record.username,
        email: record.email,
        password: record.password,
        role: record.role,
        status: record.status,
        hashedRefreshToken: record.hashedRefreshToken,
        resetOtp: record.resetOtp,
        resetOtpExpiresAt: record.resetOtpExpiresAt,
      }),
    };
    return record;
  };

  const mockUsersService = {
    create: jest.fn(
      async (dto: { username: string; email: string; password: string }) => {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(dto.password, salt);
        const user = makeStoredUser({
          username: dto.username,
          email: dto.email,
          password: hashedPassword,
        });
        usersStore.set(user._id, user);
        return user;
      },
    ),
    findOneByEmail: jest.fn((email: string) => {
      for (const user of usersStore.values()) {
        if (user.email === email) return Promise.resolve(user);
      }
      const err = new Error('Not found') as Error & { status: number };
      err.status = 404;
      return Promise.reject(err);
    }),
    findOne: jest.fn((id: string) => {
      const user = usersStore.get(id);
      if (!user) return Promise.reject(new Error('User not found'));
      return Promise.resolve(user);
    }),
    updateRefreshToken: jest.fn(
      (userId: string, hashedRefreshToken: string | null) => {
        const user = usersStore.get(userId);
        if (!user) return Promise.resolve(null);
        user.hashedRefreshToken = hashedRefreshToken;
        return Promise.resolve(user);
      },
    ),
    update: jest.fn((id: string, patch: Partial<StoredUser>) => {
      const user = usersStore.get(id);
      if (!user) return Promise.reject(new Error('User not found'));
      Object.assign(user, patch);
      return Promise.resolve(user);
    }),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'JWT_SECRET') return JWT_SECRET;
      if (key === 'JWT_REFRESH_SECRET') return JWT_REFRESH_SECRET;
      return undefined;
    }),
  };

  beforeEach(async () => {
    usersStore.clear();
    jest.clearAllMocks();

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      controllers: [AuthController],
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    authController = moduleRef.get(AuthController);
    authService = moduleRef.get(AuthService);
    jwtService = moduleRef.get(JwtService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('User Schema Field Definitions', () => {
    it('defines hashedRefreshToken and resetOtpExpiresAt paths cleanly on UserSchema', () => {
      expect(UserSchema.path('hashedRefreshToken')).toBeDefined();
      expect(UserSchema.path('resetOtpExpiresAt')).toBeDefined();
    });
  });

  describe('Refresh Token Lifecycle (Controller + Real bcrypt & JWT)', () => {
    it('configures HTTP 200 OK metadata on AuthController.refresh and completes register -> login -> refresh -> logout -> refresh', async () => {
      const descriptor = Object.getOwnPropertyDescriptor(
        AuthController.prototype,
        'refresh',
      );
      const refreshHttpCode: unknown = Reflect.getMetadata(
        HTTP_CODE_METADATA,
        descriptor?.value as object,
      );
      expect(refreshHttpCode).toBe(HttpStatus.OK);

      // 1. Register synthetic user
      const regRes = await authController.register({
        username: 'm92_test_user',
        email: 'm92_user@example.com',
        password: 'StrongPassword123!',
      });

      const userDto = regRes.user as {
        id: string;
        hashedRefreshToken?: string;
      };
      const userId = userDto.id;
      const storedAfterReg = usersStore.get(userId)!;
      expect(storedAfterReg.hashedRefreshToken).toMatch(/^\$2[aby]\$/);
      expect(storedAfterReg.hashedRefreshToken).not.toBe(regRes.refreshToken);
      expect(userDto.hashedRefreshToken).toBeUndefined();

      // 2. Login -> stores new hashed refresh token
      const loginRes = await authController.login({
        email: 'm92_user@example.com',
        password: 'StrongPassword123!',
      });

      const rt1 = loginRes.refreshToken;
      const hash1 = usersStore.get(userId)!.hashedRefreshToken!;
      expect(hash1).toMatch(/^\$2[aby]\$/);
      expect(hash1).not.toBe(rt1);

      // 3. Valid refresh -> returns rotated tokens cleanly (HTTP 200 contract)
      const refreshRes = await authController.refresh({
        userId,
        refreshToken: rt1,
      });

      const rt2 = refreshRes.refreshToken;
      expect(rt2).toBeDefined();
      expect(rt2).not.toBe(rt1);
      const hash2 = usersStore.get(userId)!.hashedRefreshToken!;
      expect(hash2).not.toBe(hash1);

      // 4. Old rotated token replay -> ForbiddenException (HTTP 403)
      await expect(
        authController.refresh({ userId, refreshToken: rt1 }),
      ).rejects.toThrow(ForbiddenException);

      // 5. Invalid refresh token -> ForbiddenException (HTTP 403)
      await expect(
        authController.refresh({ userId, refreshToken: 'tampered.jwt.token' }),
      ).rejects.toThrow(ForbiddenException);

      // 6. Expired refresh token -> ForbiddenException (HTTP 403)
      const expiredRt = await jwtService.signAsync(
        { sub: userId, email: 'm92_user@example.com', role: 'user' },
        {
          secret: JWT_REFRESH_SECRET,
          expiresIn: '-10s',
          issuer: 'gastrowise-auth',
          audience: 'gastrowise-api',
        },
      );
      await expect(
        authController.refresh({ userId, refreshToken: expiredRt }),
      ).rejects.toThrow(ForbiddenException);

      // 7. Logout clears stored hash -> refresh after logout throws ForbiddenException (HTTP 403)
      await authService.logout(userId);
      expect(usersStore.get(userId)!.hashedRefreshToken).toBeNull();

      await expect(
        authController.refresh({ userId, refreshToken: rt2 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects legacy plaintext refresh tokens without trusting them', async () => {
      const user = await mockUsersService.create({
        username: 'legacy_plain',
        email: 'legacy_plain@example.com',
        password: 'StrongPassword123!',
      });
      const validJwt = await jwtService.signAsync(
        { sub: user._id, email: user.email, role: 'user' },
        {
          secret: JWT_REFRESH_SECRET,
          expiresIn: '7d',
          issuer: 'gastrowise-auth',
          audience: 'gastrowise-api',
        },
      );
      // Simulate legacy unhashed token persisted before M9.2
      user.hashedRefreshToken = validJwt;

      await expect(
        authController.refresh({ userId: user._id, refreshToken: validJwt }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Password Reset OTP Expiration & Log Sanitization', () => {
    it('enforces 15m OTP TTL, supports resend replacement, rejects expired/missing TTL, clears metadata, and never logs OTP', async () => {
      const baseTime = new Date('2026-11-26T05:00:00.000Z').getTime();
      jest.spyOn(Date, 'now').mockImplementation(() => baseTime);

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      const loggerSpy = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation();

      const user = await mockUsersService.create({
        username: 'otp_user',
        email: 'otp_user@example.com',
        password: 'OldPassword123!',
      });

      // 1. Issue OTP
      await authService.forgotPassword(user.email);
      const otp1 = user.resetOtp!;
      expect(otp1).toMatch(/^\d{6}$/);
      expect(user.resetOtpExpiresAt).toEqual(
        new Date(baseTime + 15 * 60 * 1000),
      );

      // Check logs contain ZERO raw OTP or Ethereal OTP preview URL
      const allLoggedStrings = [
        ...consoleLogSpy.mock.calls.flat().map(String),
        ...loggerSpy.mock.calls.flat().map(String),
      ].join('\n');
      expect(allLoggedStrings).not.toContain(otp1);
      expect(allLoggedStrings).not.toContain('SECRET-OTP-URL');

      // 2. Resend OTP 5 minutes later -> replaces previous OTP and extends expiry
      const tPlus5m = baseTime + 5 * 60 * 1000;
      (Date.now as jest.Mock).mockImplementation(() => tPlus5m);
      await authService.forgotPassword(user.email);
      const otp2 = user.resetOtp!;
      expect(user.resetOtpExpiresAt).toEqual(
        new Date(tPlus5m + 15 * 60 * 1000),
      );
      if (otp1 !== otp2) {
        await expect(
          authService.resetPassword(user.email, otp1, 'NewPass123!'),
        ).rejects.toThrow();
      }

      // 3. Expired OTP (advance past +15m from resend) -> rejected
      (Date.now as jest.Mock).mockImplementation(
        () => tPlus5m + 15 * 60 * 1000,
      );
      await expect(
        authService.resetPassword(user.email, otp2, 'NewPass123!'),
      ).rejects.toThrow(/hết hạn|không chính xác/);

      // 4. Missing expiration metadata -> rejected even if OTP string matches
      (Date.now as jest.Mock).mockImplementation(() => tPlus5m + 60_000);
      user.resetOtpExpiresAt = null;
      await expect(
        authService.resetPassword(user.email, otp2, 'NewPass123!'),
      ).rejects.toThrow(/hết hạn|không chính xác/);

      // 5. Valid OTP before expiration -> succeeds and clears resetOtp & resetOtpExpiresAt
      await authService.forgotPassword(user.email);
      const otp3 = user.resetOtp!;
      (Date.now as jest.Mock).mockImplementation(
        () => tPlus5m + 10 * 60 * 1000,
      );
      await authService.resetPassword(user.email, otp3, 'NewPass123!');

      expect(user.resetOtp).toBeNull();
      expect(user.resetOtpExpiresAt).toBeNull();
      expect(await bcrypt.compare('NewPass123!', user.password)).toBe(true);

      consoleLogSpy.mockRestore();
      loggerSpy.mockRestore();
      jest.restoreAllMocks();
    });
  });

  describe('V002 Migration Compatibility', () => {
    it('defines V002 idempotent backfill invalidating non-bcrypt refresh tokens and missing OTP expiry', async () => {
      const updateManyMock = jest
        .fn()
        .mockResolvedValue({ matchedCount: 2, modifiedCount: 2 });
      const fakeDb = {
        collection: jest.fn(() => ({
          updateMany: updateManyMock,
          countDocuments: jest.fn().mockResolvedValue(2),
        })),
      };

      await v002UserSecurityFieldsMigration.up({
        db: fakeDb as unknown as Db,
        scope: 'core',
        dryRun: false,
        runnerId: 'test',
        logger: new JsonMigrationLogger(true),
      });

      expect(updateManyMock).toHaveBeenCalledTimes(2);
      const calls = updateManyMock.mock.calls as Array<
        [unknown, Record<string, unknown>]
      >;
      expect(calls[0][1]).toEqual({
        $set: { hashedRefreshToken: null },
      });
      expect(calls[1][1]).toEqual({
        $set: { resetOtp: null, resetOtpExpiresAt: null },
      });
    });
  });
});
