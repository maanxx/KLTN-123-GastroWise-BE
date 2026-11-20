// src/users/users.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Admin: Tạo user trực tiếp từ dashboard quản trị
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post()
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  /**
   * Admin: Lấy danh sách toàn bộ người dùng hệ thống
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get()
  findAll(@Query() query: any) {
    return this.usersService.findAll(query);
  }

  /**
   * User / Admin: Xem thông tin tài khoản
   */
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  /**
   * User / Admin: Cập nhật thông tin người dùng
   * Quy tắc RBAC: Admin có quyền cập nhật mọi user. User thường chỉ được sửa tài khoản chính mình.
   * Ngăn chặn leo thang đặc quyền: User thường không được tự ý sửa role hoặc status.
   */
  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    const callerRole = req.user?.role || 'user';
    const callerId = req.user?.userId || req.user?.sub;

    if (callerRole !== 'admin') {
      if (callerId !== id) {
        throw new ForbiddenException(
          'Access Denied: You can only update your own account',
        );
      }
      // Ngăn chặn user thường tự nâng cấp vai trò hoặc gỡ bỏ lệnh cấm (privilege escalation)
      delete (updateUserDto as any).role;
      delete (updateUserDto as any).status;
    }

    return this.usersService.update(id, updateUserDto);
  }

  /**
   * Admin: Xóa tài khoản người dùng
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
