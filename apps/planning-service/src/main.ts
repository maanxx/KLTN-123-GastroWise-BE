import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { CorrelationIdMiddleware } from '@shared/utils/correlation-id.middleware';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const port = process.env.PLANNING_SERVICE_PORT || 3003;

  console.log('========================================');
  console.log('🚀 GASTROWISE PLANNING SERVICE BOOTSTRAP');
  console.log('👉 PORT:', port);
  console.log(
    '👉 CORE_SERVICE_URL:',
    process.env.CORE_SERVICE_URL || 'http://127.0.0.1:3001',
  );
  console.log(
    '👉 AI_SERVICE_URL:',
    process.env.AI_SERVICE_URL || 'http://127.0.0.1:5000',
  );
  console.log(
    '👉 PLANNING_DB_NAME:',
    process.env.PLANNING_DB_NAME || 'gastro_planning',
  );
  console.log('========================================');

  app.use(new CorrelationIdMiddleware().use);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Global prefix for API versioning (aligns with Mobile /api/v1 prefix)
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] });

  const defaultAllowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3003',
    'http://localhost:8080',
    'http://localhost:8081',
    'http://localhost:19006',
    process.env.FRONTEND_URL,
  ].filter(Boolean) as string[];

  const customAllowed = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : [];

  const allowedOrigins = Array.from(
    new Set([...defaultAllowedOrigins, ...customAllowed]),
  );

  app.enableCors({
    origin: (origin, callback) => {
      if (
        !origin ||
        allowedOrigins.includes(origin) ||
        allowedOrigins.includes('*')
      ) {
        callback(null, true);
      } else {
        callback(
          new Error(`Origin ${origin} not allowed by GastroWise CORS policy`),
        );
      }
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  await app.listen(port, '0.0.0.0');
  console.log(`🚀 GastroWise Planning Service is listening on 0.0.0.0:${port}`);
}

bootstrap();
