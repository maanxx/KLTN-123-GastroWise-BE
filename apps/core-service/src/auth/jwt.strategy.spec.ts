import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy (Core Service)', () => {
  it('should fail fast if JWT_SECRET is not configured', () => {
    const mockConfigService = {
      get: jest.fn().mockReturnValue(undefined),
    };

    expect(
      () => new JwtStrategy(mockConfigService as unknown as ConfigService),
    ).toThrow(/JWT_SECRET must be set/);
  });

  it('should validate and extract standardized user payload', async () => {
    const mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'JWT_SECRET') return 'test-valid-secret-key-32chars!';
        return undefined;
      }),
    };

    const strategy = new JwtStrategy(
      mockConfigService as unknown as ConfigService,
    );

    const payload = {
      sub: 'user-id-456',
      email: 'user@gastrowise.com',
      role: 'admin',
    };

    const user = await strategy.validate(payload);
    expect(user).toEqual({
      userId: 'user-id-456',
      sub: 'user-id-456',
      email: 'user@gastrowise.com',
      role: 'admin',
    });
  });

  it('should throw UnauthorizedException when payload lacks sub', async () => {
    const mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'JWT_SECRET') return 'test-valid-secret-key-32chars!';
        return undefined;
      }),
    };

    const strategy = new JwtStrategy(
      mockConfigService as unknown as ConfigService,
    );

    await expect(strategy.validate({ email: 'bad@token' })).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

