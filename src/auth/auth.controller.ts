// src/auth/auth.controller.ts
import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
  Get,
  Res,
  Patch,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Request } from 'express';
import type { Response } from 'express'; // Import Response từ express
import { AuthGuard } from '@nestjs/passport';
import { UpdateUserDto } from 'src/users/dto/update-user.dto';

// Interface mở rộng Request để TypeScript hiểu req.user
interface RequestWithUser extends Request {
  user: {
    sub: string;
    email: string;
  };
}

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // --- 1. GOOGLE LOGIN ---
  @Get('google')
  @UseGuards(AuthGuard('google'))
  async googleAuth(@Req() req) {
    // Hàm này chỉ để kích hoạt Guard, Passport sẽ tự chuyển hướng sang Google
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleAuthRedirect(@Req() req, @Res() res: Response) {
    // 1. Xử lý đăng nhập, tạo Token
    const { accessToken, refreshToken } = await this.authService.signInWithGoogle(req.user);

    // 2. [QUAN TRỌNG] Xác định URL Frontend để chuyển hướng về
    // Nếu chạy trên Render (có biến ENV), nó sẽ dùng link Vercel.
    // Nếu chạy Local (không có biến ENV), nó sẽ dùng localhost:3000.
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    // [DEBUG LOG] In ra để kiểm tra trên Render Logs
    console.log("🚀 Redirecting Google User to:", frontendUrl);

    // 3. Chuyển hướng về Frontend kèm theo Token trên URL
    res.redirect(
      `${frontendUrl}/auth/callback?accessToken=${accessToken}&refreshToken=${refreshToken}`,
    );
  }

  // --- 2. ĐĂNG KÝ / ĐĂNG NHẬP THƯỜNG ---
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  // --- 3. ĐĂNG XUẤT & REFRESH TOKEN ---
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Req() req: RequestWithUser) {
    const userId = req.user.sub;
    return this.authService.logout(userId);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() body: { userId: string; refreshToken: string }) {
    return this.authService.refresh(body.userId, body.refreshToken);
  }

  // --- 4. PROFILE USER (GET & UPDATE) ---
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@Req() req: RequestWithUser) {
    const userId = req.user.sub;
    return this.authService.getProfile(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('profile')
  updateProfile(
    @Req() req: RequestWithUser,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    const userId = req.user.sub;
    return this.authService.updateProfile(userId, updateUserDto);
  }
}