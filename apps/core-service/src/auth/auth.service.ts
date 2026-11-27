// src/auth/auth.service.ts
import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'crypto';
import { normalizeEmail } from '@shared/utils/email.util';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UserDocument } from '../users/schemas/user.schema';
import { UpdateUserDto } from '../users/dto/update-user.dto';

const RESET_OTP_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  // --- HÀM ĐĂNG KÝ ---
  async register(registerDto: RegisterDto) {
    const normalizedEmail = normalizeEmail(registerDto.email);
    const existingUser = await this.usersService
      .findOneByEmail(normalizedEmail)
      .catch(() => null);

    if (existingUser) {
      throw new BadRequestException('Email already exists');
    }

    let newUser: UserDocument;
    try {
      newUser = await this.usersService.create({
        ...registerDto,
        email: normalizedEmail,
      });
    } catch (err: any) {
      if (err?.status === 409 || err?.code === 11000) {
        throw new BadRequestException(err.message || 'Account already exists');
      }
      throw err;
    }

    const tokens = await this._generateTokens(
      newUser._id.toString(),
      newUser.email,
      newUser.role || 'user',
    );

    const hashedRefreshToken = await this._hashRefreshToken(
      tokens.refreshToken,
    );
    await this.usersService.updateRefreshToken(
      newUser._id.toString(),
      hashedRefreshToken,
    );

    return {
      token: tokens.accessToken,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: this._sanitizeUser(newUser),
    };
  }

  // --- HÀM ĐĂNG NHẬP ---
  async login(loginDto: LoginDto) {
    // 1. Tìm user bằng email đã chuẩn hóa
    const user: UserDocument = await this.usersService.findOneByEmail(
      normalizeEmail(loginDto.email),
    );

    // 2. So sánh mật khẩu
    const isMatch = await bcrypt.compare(loginDto.password, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status === 'banned') {
      throw new ForbiddenException(
        'Tài khoản của bạn đã bị khóa bởi Quản trị viên do vi phạm điều khoản. Vui lòng liên hệ bộ phận hỗ trợ.',
      );
    }

    // 3. Tạo tokens
    const tokens = await this._generateTokens(
      user._id.toString(),
      user.email,
      user.role || 'user',
    );

    // 4. Cập nhật refresh token đã băm
    const hashedRefreshToken = await this._hashRefreshToken(
      tokens.refreshToken,
    );
    await this.usersService.updateRefreshToken(
      user._id.toString(),
      hashedRefreshToken,
    );

    return {
      token: tokens.accessToken,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: this._sanitizeUser(user),
    };
  }

  // --- HÀM ĐĂNG XUẤT ---
  async logout(userId: string) {
    return this.usersService.updateRefreshToken(userId, null);
  }

  // --- HÀM LÀM MỚI TOKEN ---
  async refresh(userId: string, refreshToken: string) {
    if (!userId || !refreshToken) {
      throw new ForbiddenException('Access Denied');
    }

    const jwtSecret = this.configService.get<string>('JWT_SECRET');
    if (!jwtSecret) {
      throw new Error(
        'Missing mandatory security configuration: JWT_SECRET must be set in environment variables',
      );
    }
    const refreshSecret =
      this.configService.get<string>('JWT_REFRESH_SECRET') || jwtSecret;

    let payload: { sub?: string } | null = null;
    try {
      payload = await this.jwtService.verifyAsync<{ sub?: string }>(
        refreshToken,
        {
          secret: refreshSecret,
          issuer: 'gastrowise-auth',
          audience: 'gastrowise-api',
        },
      );
    } catch {
      throw new ForbiddenException('Access Denied');
    }

    if (!payload || payload.sub !== userId) {
      throw new ForbiddenException('Access Denied');
    }

    const user: UserDocument | null = await this.usersService
      .findOne(userId)
      .catch(() => null);
    if (!user || !user.hashedRefreshToken || user.status === 'banned') {
      throw new ForbiddenException('Access Denied');
    }

    const tokenDigest = this._digestTokenForBcrypt(refreshToken);
    const isMatch = await bcrypt.compare(tokenDigest, user.hashedRefreshToken);
    if (!isMatch) {
      throw new ForbiddenException('Access Denied');
    }

    // Tạo tokens mới (rotation)
    const tokens = await this._generateTokens(
      user._id.toString(),
      user.email,
      user.role || 'user',
    );
    // Băm và lưu refresh token mới vào DB
    const hashedRefreshToken = await this._hashRefreshToken(
      tokens.refreshToken,
    );
    await this.usersService.updateRefreshToken(
      user._id.toString(),
      hashedRefreshToken,
    );

    return tokens;
  }

  // --- HÀM PRIVATE: Digest & Băm dữ liệu ---
  private _digestTokenForBcrypt(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async _hashRefreshToken(refreshToken: string): Promise<string> {
    return this._hashData(this._digestTokenForBcrypt(refreshToken));
  }

  private async _hashData(data: string): Promise<string> {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(data, salt);
  }

  private _verifyOtpMatch(expectedOtp: string, providedOtp: string): boolean {
    const a = Buffer.from(String(expectedOtp), 'utf8');
    const b = Buffer.from(String(providedOtp), 'utf8');
    if (a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(a, b);
  }

  // --- HÀM PRIVATE: Tạo Tokens ---
  private async _generateTokens(
    userId: string,
    email: string,
    role: string = 'user',
  ) {
    const payload = { sub: userId, email, role };
    const refreshPayload = { sub: userId, email, role, jti: randomUUID() };

    const jwtSecret = this.configService.get<string>('JWT_SECRET');
    if (!jwtSecret) {
      throw new Error(
        'Missing mandatory security configuration: JWT_SECRET must be set in environment variables',
      );
    }
    const refreshSecret =
      this.configService.get<string>('JWT_REFRESH_SECRET') || jwtSecret;

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: jwtSecret,
        expiresIn: '1d',
        issuer: 'gastrowise-auth',
        audience: 'gastrowise-api',
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: refreshSecret,
        expiresIn: '7d',
        issuer: 'gastrowise-auth',
        audience: 'gastrowise-api',
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
    if (!googleUser || !googleUser.email) {
      throw new BadRequestException('Unauthenticated');
    }

    const normalizedEmail = normalizeEmail(googleUser.email);
    const user = await this._findOrCreateGoogleUser({
      ...googleUser,
      email: normalizedEmail,
    });

    if (user.status === 'banned') {
      throw new ForbiddenException(
        'Tài khoản của bạn đã bị khóa bởi Quản trị viên do vi phạm điều khoản.',
      );
    }

    // Tạo JWT
    const tokens = await this._generateTokens(
      user._id.toString(),
      user.email,
      user.role || 'user',
    );

    const hashedRefreshToken = await this._hashRefreshToken(
      tokens.refreshToken,
    );
    await this.usersService.updateRefreshToken(
      user._id.toString(),
      hashedRefreshToken,
    );

    return tokens;
  }

  private async _findOrCreateGoogleUser(googleUser: {
    email: string;
    firstName: string;
    lastName: string;
    picture?: string;
  }): Promise<UserDocument> {
    const existing = await this.usersService
      .findOneByEmail(googleUser.email)
      .catch((err) => {
        if (err?.status === 404) return null;
        throw err;
      });

    if (existing) {
      if (googleUser.picture && existing.picture !== googleUser.picture) {
        return this.usersService.update(existing._id.toString(), {
          picture: googleUser.picture,
        } as any);
      }
      return existing;
    }

    const baseLocal =
      googleUser.email
        .split('@')[0]
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(0, 32) || 'user';
    const generatedSecret = randomBytes(32).toString('hex');

    for (let attempt = 0; attempt < 5; attempt++) {
      const candidateUsername =
        attempt === 0
          ? baseLocal
          : `${baseLocal}_${randomBytes(3).toString('hex')}`;
      try {
        return await this.usersService.create({
          email: googleUser.email,
          username: candidateUsername,
          firstName: googleUser.firstName,
          lastName: googleUser.lastName,
          picture: googleUser.picture,
          password: generatedSecret,
        } as any);
      } catch (err: any) {
        const msg = String(err?.message || '').toLowerCase();
        const isDup = err?.status === 409 || err?.code === 11000;
        if (!isDup) {
          throw err;
        }
        // Concurrent signup for the same normalized email: link cleanly without overwriting identity
        if (err?.keyPattern?.email || msg.includes('email')) {
          return this.usersService.findOneByEmail(googleUser.email);
        }
        // Username collision (same local-part across domains): retry with randomized suffix
      }
    }

    throw new BadRequestException(
      'Unable to allocate a unique username for Google account',
    );
  }

  private _sanitizeUser(user: any) {
    if (!user) return null;
    const userObj = user.toObject ? user.toObject() : { ...user };
    delete userObj.password;
    delete userObj.hashedRefreshToken;
    delete userObj.resetOtp;
    delete userObj.resetOtpExpiresAt;
    delete userObj.twoFactorSecret;
    return {
      id: user._id ? user._id.toString() : user.id,
      fullName: userObj.firstName
        ? `${userObj.lastName || ''} ${userObj.firstName}`.trim()
        : userObj.username || userObj.email,
      ...userObj,
    };
  }

  async getProfile(userId: string) {
    const user = await this.usersService.findOne(userId);
    if (user && user.status === 'banned') {
      throw new ForbiddenException(
        'Tài khoản của bạn đã bị khóa bởi Quản trị viên do vi phạm điều khoản.',
      );
    }
    return this._sanitizeUser(user);
  }

  async updateProfile(userId: string, updateUserDto: UpdateUserDto) {
    const updated = await this.usersService.updateProfile(
      userId,
      updateUserDto,
    );
    return this._sanitizeUser(updated);
  }

  // --- HÀM QUÊN MẬT KHẨU ---
  async forgotPassword(email: string) {
    const normalizedEmail = normalizeEmail(email);
    const user = await this.usersService
      .findOneByEmail(normalizedEmail)
      .catch(() => null);
    if (!user) {
      throw new BadRequestException('Email không tồn tại trong hệ thống!');
    }
    if (user.status === 'banned') {
      throw new ForbiddenException(
        'Tài khoản của bạn đang bị khóa bởi Quản trị viên!',
      );
    }

    // Tạo mã OTP ngẫu nhiên 6 chữ số (CSPRNG) + thời hạn 15 phút
    const otp = randomInt(100000, 1000000).toString();
    const resetOtpExpiresAt = new Date(Date.now() + RESET_OTP_TTL_MS);

    // Lưu OTP và thời hạn vào DB (thay thế hoàn toàn OTP cũ nếu gửi lại)
    await this.usersService.update(user._id.toString(), {
      resetOtp: otp,
      resetOtpExpiresAt,
    } as any);

    // Gửi Email thực tế qua Nodemailer nếu có cấu hình SMTP
    try {
      const nodemailer = require('nodemailer');
      const smtpHost =
        this.configService.get<string>('SMTP_HOST') || 'smtp.gmail.com';
      const smtpPort = parseInt(
        this.configService.get<string>('SMTP_PORT') || '587',
        10,
      );
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
        this.logger.log(
          JSON.stringify({
            event: 'password_reset_otp_sent',
            userId: user._id.toString(),
            transport: 'smtp',
            expiresAt: resetOtpExpiresAt.toISOString(),
          }),
        );
      } else {
        // Tự tạo tài khoản Ethereal Mail miễn phí để test mail
        const testAccount = await nodemailer.createTestAccount();
        const transporter = nodemailer.createTransport({
          host: 'smtp.ethereal.email',
          port: 587,
          secure: false,
          auth: { user: testAccount.user, pass: testAccount.pass },
        });

        await transporter.sendMail({
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
        this.logger.log(
          JSON.stringify({
            event: 'password_reset_otp_sent',
            userId: user._id.toString(),
            transport: 'ethereal',
            expiresAt: resetOtpExpiresAt.toISOString(),
          }),
        );
      }
    } catch (mailError: unknown) {
      this.logger.error(
        JSON.stringify({
          event: 'password_reset_email_failed',
          userId: user._id.toString(),
          message:
            mailError instanceof Error ? mailError.message : 'SMTP send error',
        }),
      );
    }

    return {
      message: `Mã xác minh OTP đã được gửi tới email ${email}. Vui lòng kiểm tra hộp thư.`,
    };
  }

  // --- HÀM ĐẶT LẠI MẬT KHẨU BẰNG EMAIL OTP ---
  async resetPassword(email: string, otp: string, newPassword: string) {
    const normalizedEmail = normalizeEmail(email);
    const user = await this.usersService
      .findOneByEmail(normalizedEmail)
      .catch(() => null);
    if (!user) {
      throw new BadRequestException('Email không tồn tại!');
    }

    const storedUser = user as unknown as {
      resetOtp?: string | null;
      resetOtpExpiresAt?: Date | string | null;
    };
    const invalidOtpMessage =
      'Mã xác minh OTP không chính xác hoặc đã hết hạn!';

    if (!otp || !storedUser.resetOtp || !storedUser.resetOtpExpiresAt) {
      throw new BadRequestException(invalidOtpMessage);
    }

    const expiresAtMs = new Date(storedUser.resetOtpExpiresAt).getTime();
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      throw new BadRequestException(invalidOtpMessage);
    }

    if (!this._verifyOtpMatch(storedUser.resetOtp, otp)) {
      throw new BadRequestException(invalidOtpMessage);
    }

    const hashedPassword = await this._hashData(newPassword);

    await this.usersService.update(user._id.toString(), {
      password: hashedPassword,
      resetOtp: null,
      resetOtpExpiresAt: null,
    } as any);

    return {
      message:
        'Đặt lại mật khẩu thành công! Vui lòng đăng nhập bằng mật khẩu mới.',
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

    const isValid = authenticator.verify({
      token: code,
      secret: user.twoFactorSecret,
    });
    if (!isValid) {
      throw new BadRequestException(
        'Mã xác minh Authenticator 6 số không đúng!',
      );
    }

    await this.usersService.update(userId, { isTwoFactorEnabled: true } as any);
    return {
      message: 'Đã kích hoạt bảo mật 2 lớp Google Authenticator thành công!',
    };
  }

  // --- HÀM ĐẶT LẠI MẬT KHẨU BẰNG GOOGLE AUTHENTICATOR (2FA TOTP) ---
  async resetPasswordWith2FA(
    email: string,
    totpCode: string,
    newPassword: string,
  ) {
    const user = await this.usersService
      .findOneByEmail(email)
      .catch(() => null);
    if (!user) {
      throw new BadRequestException('Email không tồn tại!');
    }
    if (!user.isTwoFactorEnabled || !user.twoFactorSecret) {
      throw new BadRequestException(
        'Tài khoản chưa đăng ký bảo mật 2FA Authenticator!',
      );
    }

    const { authenticator } = require('otplib');
    const isValid = authenticator.verify({
      token: totpCode,
      secret: user.twoFactorSecret,
    });
    if (!isValid) {
      throw new BadRequestException(
        'Mã Google Authenticator (TOTP) không chính xác!',
      );
    }

    const hashedPassword = await this._hashData(newPassword);
    await this.usersService.update(user._id.toString(), {
      password: hashedPassword,
    } as any);

    return {
      message: 'Đặt lại mật khẩu bằng Google Authenticator thành công!',
    };
  }
}
