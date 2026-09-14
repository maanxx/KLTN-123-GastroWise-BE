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
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Request } from 'express';
import type { Response } from 'express'; // Import Response từ express
import { AuthGuard } from '@nestjs/passport';
import { UpdateUserDto } from 'src/users/dto/update-user.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';

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
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleAuthRedirect(@Req() req, @Res() res: Response) {
    const { accessToken, refreshToken } = await this.authService.signInWithGoogle(req.user);

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    console.log("🚀 Redirecting Google User to:", frontendUrl);

    res.redirect(
      `${frontendUrl}/auth/callback?accessToken=${accessToken}&refreshToken=${refreshToken}`,
    );
  }

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

  @UseGuards(JwtAuthGuard)
  @Post('avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads/avatars',
        filename: (req, file, callback) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          const ext = extname(file.originalname);
          callback(null, `${uniqueSuffix}${ext}`);
        },
      }),
      fileFilter: (req, file, callback) => {
        if (!file.mimetype.match(/\/(jpg|jpeg|png|gif|webp)$/)) {
          return callback(new BadRequestException('Only image files are allowed!'), false);
        }
        callback(null, true);
      },
    }),
  )
  uploadAvatar(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    return {
      picture: `http://localhost:3001/uploads/avatars/${file.filename}`,
    };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() body: { email: string }) {
    if (!body.email) {
      throw new BadRequestException('Vui lòng nhập Email!');
    }
    return this.authService.forgotPassword(body.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() body: { email: string; otp: string; newPassword: string }) {
    if (!body.email || !body.newPassword) {
      throw new BadRequestException('Vui lòng điền đầy đủ Email và Mật khẩu mới!');
    }
    return this.authService.resetPassword(body.email, body.otp, body.newPassword);
  }

  // --- 2FA GOOGLE AUTHENTICATOR ENDPOINTS ---
  @UseGuards(JwtAuthGuard)
  @Post('2fa/generate')
  @HttpCode(HttpStatus.OK)
  generate2FA(@Req() req: RequestWithUser) {
    return this.authService.generate2FA(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/enable')
  @HttpCode(HttpStatus.OK)
  enable2FA(@Req() req: RequestWithUser, @Body() body: { code: string }) {
    return this.authService.enable2FA(req.user.sub, body.code);
  }

  @Post('2fa/reset-password')
  @HttpCode(HttpStatus.OK)
  resetPasswordWith2FA(@Body() body: { email: string; totpCode: string; newPassword: string }) {
    if (!body.email || !body.totpCode || !body.newPassword) {
      throw new BadRequestException('Vui lòng điền đầy đủ Email, Mã 2FA và Mật khẩu mới!');
    }
    return this.authService.resetPasswordWith2FA(body.email, body.totpCode, body.newPassword);
  }
}