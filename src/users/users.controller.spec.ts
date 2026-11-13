import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { ForbiddenException } from '@nestjs/common';

describe('UsersController (RBAC & Ownership)', () => {
  let controller: UsersController;

  const mockUsersService = {
    create: jest.fn().mockImplementation((dto) => Promise.resolve({ _id: 'new_id', ...dto })),
    findAll: jest.fn().mockResolvedValue([{ _id: 'user_1', email: 'test1@example.com' }]),
    findOne: jest.fn().mockImplementation((id) => Promise.resolve({ _id: id, email: 'test@example.com' })),
    update: jest.fn().mockImplementation((id, dto) => Promise.resolve({ _id: id, ...dto })),
    remove: jest.fn().mockResolvedValue({ message: 'User deleted successfully' }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('update', () => {
    it('should allow regular user to update their own profile and strip privileged role/status fields', async () => {
      const myId = '64b8f0000000000000000001';
      const req = {
        user: { userId: myId, role: 'user' },
      };
      const dto: any = {
        firstName: 'John',
        role: 'admin', // Malicious attempt to escalate role
        status: 'active',
      };

      await controller.update(req, myId, dto);

      expect(mockUsersService.update).toHaveBeenCalledWith(
        myId,
        expect.not.objectContaining({ role: 'admin' }),
      );
      expect(mockUsersService.update).toHaveBeenCalledWith(
        myId,
        expect.objectContaining({ firstName: 'John' }),
      );
    });

    it('should throw ForbiddenException when regular user attempts to update another user profile', async () => {
      const myId = '64b8f0000000000000000001';
      const otherId = '64b8f0000000000000000099';
      const req = {
        user: { userId: myId, role: 'user' },
      };

      expect(() => controller.update(req, otherId, { firstName: 'Hacker' })).toThrow(
        ForbiddenException,
      );
      expect(() => controller.update(req, otherId, { firstName: 'Hacker' })).toThrow(
        'Access Denied: You can only update your own account',
      );
    });

    it('should allow admin to update any user profile including role/status', async () => {
      const targetUserId = '64b8f0000000000000000099';
      const req = {
        user: { userId: 'admin_id', role: 'admin' },
      };
      const dto: any = {
        role: 'owner',
        status: 'banned',
      };

      const result = await controller.update(req, targetUserId, dto);
      expect(result).toBeDefined();
      expect(mockUsersService.update).toHaveBeenCalledWith(
        targetUserId,
        expect.objectContaining({ role: 'owner', status: 'banned' }),
      );
    });
  });
});
