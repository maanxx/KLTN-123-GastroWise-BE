import { InternalAuthGuard } from './internal-auth.guard';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';

describe('InternalAuthGuard (Mutual Service Auth)', () => {
  let guard: InternalAuthGuard;
  const originalEnv = process.env.INTERNAL_SERVICE_KEY;

  beforeEach(() => {
    guard = new InternalAuthGuard();
    process.env.INTERNAL_SERVICE_KEY = 'valid-test-internal-secret-key-123';
  });

  afterEach(() => {
    process.env.INTERNAL_SERVICE_KEY = originalEnv;
  });

  function createMockContext(
    headers: Record<string, string>,
  ): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ headers }),
      }),
    } as any;
  }

  it('should allow access when X-Internal-Service-Key matches exactly', () => {
    const context = createMockContext({
      'x-internal-service-key': 'valid-test-internal-secret-key-123',
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should throw UnauthorizedException when header is missing', () => {
    const context = createMockContext({});
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException when key does not match', () => {
    const context = createMockContext({
      'x-internal-service-key': 'tampered-or-invalid-key-xyz',
    });
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException when key has different length', () => {
    const context = createMockContext({
      'x-internal-service-key': 'short',
    });
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });
});
