import { Test, TestingModule } from '@nestjs/testing';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Reflector } from '@nestjs/core';

describe('ContactsController (RBAC & Audit Protection)', () => {
  let controller: ContactsController;

  const mockContactsService = {
    createContact: jest.fn().mockImplementation((dto) =>
      Promise.resolve({ _id: 'contact_001', ...dto, status: 'CHỜ XỬ LÝ' }),
    ),
    findAll: jest.fn().mockResolvedValue([
      { _id: 'contact_001', name: 'Nguyen Van A', topic: 'feedback' },
    ]),
    updateStatus: jest.fn().mockImplementation((id, status, resolvedBy) =>
      Promise.resolve({
        _id: id,
        status,
        resolvedBy,
        resolvedAt: new Date(),
      }),
    ),
    remove: jest.fn().mockImplementation((id) =>
      Promise.resolve({ _id: id, message: 'Deleted successfully' }),
    ),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContactsController],
      providers: [
        {
          provide: ContactsService,
          useValue: mockContactsService,
        },
        Reflector,
      ],
    }).compile();

    controller = module.get<ContactsController>(ContactsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create (Public Ingress)', () => {
    it('should allow public contact creation without authentication', async () => {
      const dto: any = {
        name: 'Guest User',
        email: 'guest@example.com',
        phone: '0901234567',
        topic: 'feedback',
        message: 'Great service!',
      };

      const result = await controller.create(dto);

      expect(result).toBeDefined();
      expect(result._id).toBe('contact_001');
      expect(mockContactsService.createContact).toHaveBeenCalledWith(dto);
    });
  });

  describe('findAll (Admin RBAC)', () => {
    it('should have JwtAuthGuard and RolesGuard applied with admin role', () => {
      const guards = Reflect.getMetadata('__guards__', controller.findAll);
      expect(guards).toBeDefined();
      expect(guards.length).toBe(2);

      const roles = Reflect.getMetadata('roles', controller.findAll);
      expect(roles).toEqual(['admin']);
    });

    it('should return contact list for authorized admin', async () => {
      const result = await controller.findAll();
      expect(result).toBeDefined();
      expect(result.length).toBe(1);
      expect(mockContactsService.findAll).toHaveBeenCalled();
    });
  });

  describe('updateStatus (Admin RBAC & Audit Integrity)', () => {
    it('should have JwtAuthGuard and RolesGuard applied with admin role', () => {
      const guards = Reflect.getMetadata('__guards__', controller.updateStatus);
      expect(guards).toBeDefined();
      expect(guards.length).toBe(2);

      const roles = Reflect.getMetadata('roles', controller.updateStatus);
      expect(roles).toEqual(['admin']);
    });

    it('should derive resolvedBy from authenticated JWT and ignore untrusted body.resolvedBy', async () => {
      const req = {
        user: {
          email: 'admin.auditor@gastrowise.vn',
          userId: 'admin_123',
          role: 'admin',
        },
      };
      const contactId = 'contact_001';
      const body = {
        status: 'ĐÃ GIẢI QUYẾT',
        resolvedBy: 'spoofed.attacker@fake.com', // Spoofing attempt
      };

      const result = await controller.updateStatus(req, contactId, body);

      expect(result).toBeDefined();
      expect(mockContactsService.updateStatus).toHaveBeenCalledWith(
        contactId,
        'ĐÃ GIẢI QUYẾT',
        'admin.auditor@gastrowise.vn', // Strictly derived from JWT
      );
      expect(mockContactsService.updateStatus).not.toHaveBeenCalledWith(
        contactId,
        expect.anything(),
        'spoofed.attacker@fake.com',
      );
    });
  });

  describe('remove (Admin RBAC)', () => {
    it('should have JwtAuthGuard and RolesGuard applied with admin role', () => {
      const guards = Reflect.getMetadata('__guards__', controller.remove);
      expect(guards).toBeDefined();
      expect(guards.length).toBe(2);

      const roles = Reflect.getMetadata('roles', controller.remove);
      expect(roles).toEqual(['admin']);
    });

    it('should call contactsService.remove for authorized admin', async () => {
      const contactId = 'contact_001';
      const result = await controller.remove(contactId);

      expect(result).toBeDefined();
      expect(mockContactsService.remove).toHaveBeenCalledWith(contactId);
    });
  });
});
