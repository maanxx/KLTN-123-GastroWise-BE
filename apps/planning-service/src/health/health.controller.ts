import {
  Controller,
  Get,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { checkMongoReadiness } from '@shared/health/mongo-readiness.util';

@Controller('health')
export class HealthController {
  constructor(
    @Optional()
    @InjectConnection()
    private readonly mongoConnection?: Connection,
  ) {}

  @Get()
  check() {
    return {
      status: 'UP',
      service: 'planning-service',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }

  @Get('ready')
  async ready() {
    const dbStatus = await checkMongoReadiness(this.mongoConnection);
    const payload = {
      status: dbStatus.ready ? 'READY' : 'NOT_READY',
      service: 'planning-service',
      database: dbStatus,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };

    if (!dbStatus.ready) {
      throw new ServiceUnavailableException(payload);
    }

    return payload;
  }
}
