import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-facebook';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class FacebookStrategy extends PassportStrategy(Strategy, 'facebook') {
  constructor(configService: ConfigService) {
    const backendUrl = configService.get<string>('BACKEND_URL') || 'http://localhost:3001';

    super({
      clientID: configService.get<string>('FACEBOOK_APP_ID') || '',
      clientSecret: configService.get<string>('FACEBOOK_APP_SECRET') || '',
      callbackURL: `${backendUrl}/auth/facebook/callback`,
      scope: ['email', 'public_profile'],
      profileFields: ['id', 'emails', 'name', 'picture.type(large)'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: (err: any, user: any, info?: any) => void,
  ): Promise<any> {
    const { name, emails, photos } = profile;
    const user = {
      email: emails && emails.length > 0 ? emails[0].value : null,
      firstName: name?.givenName,
      lastName: name?.familyName,
      picture: photos && photos.length > 0 ? photos[0].value : null,
    };
    
    done(null, user);
  }
}
