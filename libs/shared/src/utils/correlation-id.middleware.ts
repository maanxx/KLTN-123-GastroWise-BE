import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const existingId = req.headers['x-correlation-id'] as string;
    const correlationId = existingId || `req_${uuidv4().replace(/-/g, '')}`;
    req.headers['x-correlation-id'] = correlationId;
    res.setHeader('X-Correlation-Id', correlationId);
    next();
  }
}
