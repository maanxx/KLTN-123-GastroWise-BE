// src/auth/auth.service.ts
import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { UsersService } from 'src/users/users.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UserDocument } from 'src/users/schemas/user.schema';
import { UpdateUserDto } from 'src/users/dto/update-user.dto';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  // --- HÀM ĐĂNG KÝ ---
  async register(registerDto: RegisterDto) {
    const existingUser = await this.usersService
      .findOneByEmail(registerDto.email)
      .catch(() => null);

    if (existingUser) {
      throw new BadRequestException('Email already exists');
    }

    const newUser: UserDocument = await this.usersService.create(registerDto);

    const tokens = await this._generateTokens(
      newUser._id.toString(), 
      newUser.email,
    );

    await this.usersService.updateRefreshToken(
      newUser._id.toString(), 
      tokens.refreshToken,
    );

    return {
      token: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: this._sanitizeUser(newUser)
    };
  }

  // --- HÀM ĐĂNG NHẬP ---
  async login(loginDto: LoginDto) {
    // 1. Tìm user bằng email
    const user: UserDocument = await this.usersService.findOneByEmail(
      loginDto.email,
    );

    // 2. So sánh mật khẩu
    const isMatch = await bcrypt.compare(loginDto.password, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status === 'banned') {
      throw new ForbiddenException('Tài khoản của bạn đã bị khóa bởi Quản trị viên do vi phạm điều khoản. Vui lòng liên hệ bộ phận hỗ trợ.');
    }

    // 3. Tạo tokens
    const tokens = await this._generateTokens(
      user._id.toString(),
      user.email,
    );

    // 4. Cập nhật refresh token đã băm
    await this.usersService.updateRefreshToken(
      user._id.toString(),
      tokens.refreshToken,
    );

    return {
      token: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: this._sanitizeUser(user)
    };
  }

  // --- HÀM ĐĂNG XUẤT ---
  async logout(userId: string) {
    return this.usersService.updateRefreshToken(userId, null);
  }

  // --- HÀM LÀM MỚI TOKEN ---
  async refresh(userId: string, refreshToken: string) {
    const user: UserDocument = await this.usersService.findOne(userId); // Giả định findOne trả về UserDocument
    if (!user || !user.hashedRefreshToken) {
      throw new ForbiddenException('Access Denied');
    }

    const isMatch = await bcrypt.compare(refreshToken, user.hashedRefreshToken);
    if (!isMatch) {
      throw new ForbiddenException('Access Denied');
    }

    // Tạo tokens mới
    const tokens = await this._generateTokens(
      user._id.toString(), // SỬA Ở ĐÂY 5/6
      user.email,
    );
    // Cập nhật token mới vào DB
    await this.usersService.updateRefreshToken(
      user._id.toString(), // SỬA Ở ĐÂY 6/6
      tokens.refreshToken,
    );

    return tokens;
  }

  // --- HÀM PRIVATE: Băm dữ liệu ---
  private async _hashData(data: string): Promise<string> {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(data, salt);
  }

  // --- HÀM PRIVATE: Tạo Tokens ---
  private async _generateTokens(userId: string, email: string) {
    const payload = { sub: userId, email };

    const jwtSecret = this.configService.get<string>('JWT_SECRET') || 'gastrowise_jwt_secret';
    const refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET') || jwtSecret;

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: jwtSecret,
        expiresIn: '1d',
      }),
      this.jwtService.signAsync(payload, {
        secret: refreshSecret,
        expiresIn: '7d',
      }),
    ]);

    return { accessToken, refreshToken };
  }

  async signInWithGoogle(googleUser: {
    email: string;
    firstName: string;
    lastName: string;
    picture?: string;
  }) {
    if (!googleUser) {
      throw new BadRequestException('Unauthenticated');
    }

    let user: UserDocument;

    try {
      // 1. Thử tìm user bằng email
      user = await this.usersService.findOneByEmail(googleUser.email);

      // === BỔ SUNG LOGIC CẬP NHẬT TẠI ĐÂY ===
      // Nếu user đã tồn tại, kiểm tra xem có cần cập nhật avatar từ Google không
      if (googleUser.picture && user.picture !== googleUser.picture) {
        user = await this.usersService.update(user._id.toString(), {
          picture: googleUser.picture,
        } as any); // Cast 'as any' hoặc đảm bảo UpdateUserDto có trường 'picture'
      }
      // =======================================

    } catch (error) {
      // 2. Nếu không tìm thấy (NotFoundException), thì tạo user mới
      if (error.status === 404) {
        user = await this.usersService.create({
          email: googleUser.email,
          username: googleUser.email.split('@')[0],
          firstName: googleUser.firstName,
          lastName: googleUser.lastName,
          picture: googleUser.picture,
          password: Math.random().toString(36).substring(7),
        } as any); // Cast 'as any' nếu CreateUserDto báo lỗi thiếu trường
      } else {
        throw error;
      }
    }

    if (user.status === 'banned') {
      throw new ForbiddenException('Tài khoản của bạn đã bị khóa bởi Quản trị viên do vi phạm điều khoản.');
    }

    // 3. Tạo JWT (giữ nguyên code cũ)
    const tokens = await this._generateTokens(user._id.toString(), user.email);
    
    // ... phần còn lại giữ nguyên
    await this.usersService.updateRefreshToken(
      user._id.toString(),
      tokens.refreshToken,
    );

    return tokens;
  }

  private _sanitizeUser(user: any) {
    if (!user) return null;
    const userObj = user.toObject ? user.toObject() : { ...user };
    delete (userObj as any).password;
    delete (userObj as any).hashedRefreshToken;
    return {
      id: user._id ? user._id.toString() : user.id,
      fullName: userObj.firstName ? `${userObj.lastName || ''} ${userObj.firstName}`.trim() : userObj.username || userObj.email,
      ...userObj,
    };
  }

  async getProfile(userId: string) {
    const user = await this.usersService.findOne(userId);
    if (user && user.status === 'banned') {
      throw new ForbiddenException('Tài khoản của bạn đã bị khóa bởi Quản trị viên do vi phạm điều khoản.');
    }
    return this._sanitizeUser(user);
  }

  async updateProfile(userId: string, updateUserDto: UpdateUserDto) {
    const updated = await this.usersService.updateProfile(userId, updateUserDto);
    return this._sanitizeUser(updated);
  }

  // --- HÀM QUÊN MẬT KHẨU ---
  async forgotPassword(email: string) {
    const user = await this.usersService.findOneByEmail(email).catch(() => null);
    if (!user) {
      throw new BadRequestException('Email không tồn tại trong hệ thống!');
    }
    if (user.status === 'banned') {
      throw new ForbiddenException('Tài khoản của bạn đang bị khóa bởi Quản trị viên!');
    }

    // Tạo mã OTP ngẫu nhiên 6 chữ số
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Lưu OTP vào DB
    await this.usersService.update(user._id.toString(), {
      resetOtp: otp,
    } as any);

    // Gửi Email thực tế qua Nodemailer nếu có cấu hình SMTP
    try {
      const nodemailer = require('nodemailer');
      const smtpHost = this.configService.get<string>('SMTP_HOST') || 'smtp.gmail.com';
      const smtpPort = parseInt(this.configService.get<string>('SMTP_PORT') || '587', 10);
      const smtpUser = this.configService.get<string>('SMTP_USER');
      const smtpPass = this.configService.get<string>('SMTP_PASS');

      if (smtpUser && smtpPass) {
        const transporter = nodemailer.createTransport({
          host: smtpHost,
          port: smtpPort,
          secure: smtpPort === 465,
          auth: { user: smtpUser, pass: smtpPass },
        });

        await transporter.sendMail({
          from: `"GastroWise Support" <${smtpUser}>`,
          to: email,
          subject: 'Mã xác minh khôi phục mật khẩu GastroWise',
          html: `
            <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
              <h2 style="color: #059669;">Khôi phục mật khẩu GastroWise</h2>
              <p>Mã xác minh OTP 6 chữ số của bạn là:</p>
              <h1 style="font-size: 32px; letter-spacing: 5px; color: #2563eb;">${otp}</h1>
              <p>Mã này có hiệu lực trong vòng 15 phút. Vui lòng không chia sẻ mã này cho bất kỳ ai.</p>
            </div>
          `,
        });
        console.log(`✉️ [EMAIL SENT VIA SMTP] OTP ${otp} has been sent to ${email}`);
      } else {
        // Tự tạo tài khoản Ethereal Mail miễn phí để test link gửi mail thật
        const testAccount = await nodemailer.createTestAccount();
        const transporter = nodemailer.createTransport({
          host: 'smtp.ethereal.email',
          port: 587,
          secure: false,
          auth: { user: testAccount.user, pass: testAccount.pass },
        });

        const info = await transporter.sendMail({
          from: '"GastroWise Support" <support@gastrowise.com>',
          to: email,
          subject: 'Mã xác minh khôi phục mật khẩu GastroWise',
          html: `
            <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
              <h2 style="color: #059669;">Khôi phục mật khẩu GastroWise</h2>
              <p>Mã xác minh OTP 6 chữ số của bạn là:</p>
              <h1 style="font-size: 32px; letter-spacing: 5px; color: #2563eb;">${otp}</h1>
              <p>Mã này có hiệu lực trong vòng 15 phút.</p>
            </div>
          `,
        });
        console.log(`✉️ [ETHEREAL TEST EMAIL SENT] Xem nội dung mail thật tại link: ${nodemailer.getTestMessageUrl(info)}`);
      }
    } catch (mailError) {
      console.error('Lỗi khi gửi email SMTP:', mailError);
    }

    return {
      message: `Mã xác minh OTP đã được gửi tới email ${email}. Vui lòng kiểm tra hộp thư.`,
    };
  }

  // --- HÀM ĐẶT LẠI MẬT KHẨU BẰNG EMAIL OTP ---
  async resetPassword(email: string, otp: string, newPassword: string) {
    const user = await this.usersService.findOneByEmail(email).catch(() => null);
    if (!user) {
      throw new BadRequestException('Email không tồn tại!');
    }

    // Kiểm tra mã OTP đúng tuyệt đối từ DB
    const storedUser = user as any;
    if (!storedUser.resetOtp || storedUser.resetOtp !== otp) {
      throw new BadRequestException('Mã xác minh OTP không chính xác hoặc đã hết hạn!');
    }

    const hashedPassword = await this._hashData(newPassword);

    await this.usersService.update(user._id.toString(), {
      password: hashedPassword,
      resetOtp: null,
    } as any);

    return {
      message: 'Đặt lại mật khẩu thành công! Vui lòng đăng nhập bằng mật khẩu mới.',
    };
  }

  // --- HÀM TẠO MÃ QR 2FA GOOGLE AUTHENTICATOR ---
  async generate2FA(userId: string) {
    const user = await this.usersService.findOne(userId);
    const { authenticator } = require('otplib');
    const QRCode = require('qrcode');

    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(user.email, 'GastroWise', secret);
    const qrCodeUrl = await QRCode.toDataURL(otpauthUrl);

    // Lưu tạm secret
    await this.usersService.update(userId, { twoFactorSecret: secret } as any);

    return {
      secret,
      qrCodeUrl,
    };
  }

  // --- HÀM KÍCH HOẠT 2FA ---
  async enable2FA(userId: string, code: string) {
    const user = await this.usersService.findOne(userId);
    const { authenticator } = require('otplib');

    if (!user.twoFactorSecret) {
      throw new BadRequestException('Chưa tạo secret 2FA!');
    }

    const isValid = authenticator.verify({ token: code, secret: user.twoFactorSecret });
    if (!isValid) {
      throw new BadRequestException('Mã xác minh Authenticator 6 số không đúng!');
    }

    await this.usersService.update(userId, { isTwoFactorEnabled: true } as any);
    return { message: 'Đã kích hoạt bảo mật 2 lớp Google Authenticator thành công!' };
  }

  // --- HÀM ĐẶT LẠI MẬT KHẨU BẰNG GOOGLE AUTHENTICATOR (2FA TOTP) ---
  async resetPasswordWith2FA(email: string, totpCode: string, newPassword: string) {
    const user = await this.usersService.findOneByEmail(email).catch(() => null);
    if (!user) {
      throw new BadRequestException('Email không tồn tại!');
    }
    if (!user.isTwoFactorEnabled || !user.twoFactorSecret) {
      throw new BadRequestException('Tài khoản chưa đăng ký bảo mật 2FA Authenticator!');
    }

    const { authenticator } = require('otplib');
    const isValid = authenticator.verify({ token: totpCode, secret: user.twoFactorSecret });
    if (!isValid) {
      throw new BadRequestException('Mã Google Authenticator (TOTP) không chính xác!');
    }

    const hashedPassword = await this._hashData(newPassword);
    await this.usersService.update(user._id.toString(), { password: hashedPassword } as any);

    return {
      message: 'Đặt lại mật khẩu bằng Google Authenticator thành công!',
    };
  }
}
