import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(configService: ConfigService) {
    const secret = configService.get<string>('JWT_SECRET');

    if (!secret) {
      throw new Error(
        'Missing mandatory security configuration: JWT_SECRET must be set in environment variables',
      );
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
      issuer: 'gastrowise-auth',
      audience: 'gastrowise-api',
    });
  }

  async validate(payload: any) {
    if (!payload || !payload.sub) {
      throw new UnauthorizedException('Token payload is invalid');
    }
    return {
      userId: payload.sub,
      sub: payload.sub,
      email: payload.email,
      role: payload.role || 'user',
    };
  }
}
