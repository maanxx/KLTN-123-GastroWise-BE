import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class InternalAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const provided = request.headers['x-internal-service-key'] as
      | string
      | undefined;
    const expected = process.env.INTERNAL_SERVICE_KEY;

    if (!provided || !expected) {
      throw new UnauthorizedException(
        'Missing internal service key credentials',
      );
    }

    const aBuffer = Buffer.from(provided);
    const bBuffer = Buffer.from(expected);

    if (aBuffer.length !== bBuffer.length) {
      throw new UnauthorizedException('Invalid internal service key');
    }

    if (!timingSafeEqual(aBuffer, bBuffer)) {
      throw new UnauthorizedException('Invalid internal service key');
    }

    return true;
  }
}
