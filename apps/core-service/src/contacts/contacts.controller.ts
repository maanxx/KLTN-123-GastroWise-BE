import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactStatusDto } from './dto/update-contact-status.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  /**
   * Public: Gửi liên hệ hoặc yêu cầu hỗ trợ từ khách hàng
   */
  @Post()
  async create(@Body() createContactDto: CreateContactDto) {
    return this.contactsService.createContact(createContactDto);
  }

  /**
   * Admin: Xem danh sách liên hệ khách hàng
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get()
  async findAll() {
    return this.contactsService.findAll();
  }

  /**
   * Admin: Cập nhật trạng thái + ghi audit trail
   * PATCH /contacts/:id
   * Body: { status: 'ĐANG XỬ LÝ' | 'ĐÃ GIẢI QUYẾT' }
   * Audit trail resolvedBy được lấy trực tiếp từ JWT của Admin đã đăng nhập.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Patch(':id')
  async updateStatus(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: UpdateContactStatusDto,
  ) {
    // Derive audit identity strictly from authenticated JWT, do not trust body.resolvedBy
    const adminIdentity =
      req.user?.email ||
      req.user?.username ||
      req.user?.userId ||
      req.user?.sub ||
      'admin';
    return this.contactsService.updateStatus(id, body.status, adminIdentity);
  }

  /**
   * Admin: Xóa liên hệ
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.contactsService.remove(id);
  }
}
