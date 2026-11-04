import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { CreateContactDto } from './dto/create-contact.dto';

@Controller('contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Post()
  async create(@Body() createContactDto: CreateContactDto) {
    return this.contactsService.createContact(createContactDto);
  }

  @Get()
  async findAll() {
    return this.contactsService.findAll();
  }

  /**
   * Admin cập nhật trạng thái + ghi audit trail
   * PATCH /contacts/:id
   * Body: { status: 'ĐANG XỬ LÝ' | 'ĐÃ GIẢI QUYẾT', resolvedBy?: string }
   */
  @Patch(':id')
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string; resolvedBy?: string },
  ) {
    return this.contactsService.updateStatus(id, body.status, body.resolvedBy);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.contactsService.remove(id);
  }
}
