import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  const createMockExecutionContext = (user?: any): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  };

  it('should allow access if no roles are required on route', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const context = createMockExecutionContext({ role: 'user' });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow access if required roles list is empty', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([]);
    const context = createMockExecutionContext({ role: 'user' });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow access if user has the required admin role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    const context = createMockExecutionContext({ role: 'admin', userId: 'admin_123' });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow access if user has owner role and route permits owner or admin', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin', 'owner']);
    const context = createMockExecutionContext({ role: 'owner', userId: 'owner_123' });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should throw ForbiddenException if regular user attempts to access admin route', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    const context = createMockExecutionContext({ role: 'user', userId: 'user_123' });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(context)).toThrow(
      'Access Denied: Insufficient permissions. Required roles: [admin], Current role: [user]',
    );
  });

  it('should throw ForbiddenException if request has no user (unauthenticated)', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    const context = createMockExecutionContext(undefined);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(context)).toThrow('Access Denied: Authentication required');
  });

  it('should default user role to user if role property is missing on user object', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    const context = createMockExecutionContext({ userId: 'user_no_role' });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(context)).toThrow(
      'Access Denied: Insufficient permissions. Required roles: [admin], Current role: [user]',
    );
  });
});
