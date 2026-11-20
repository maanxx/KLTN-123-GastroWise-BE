import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { CorrelationIdMiddleware } from '@shared/utils/correlation-id.middleware';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const port = process.env.CORE_SERVICE_PORT || process.env.PORT || 3001;

  console.log('========================================');
  console.log('🚀 GASTROWISE CORE SERVICE BOOTSTRAP');
  console.log('👉 PORT:', port);
  console.log('👉 AI_SERVICE_URL:', process.env.AI_SERVICE_URL);
  console.log('👉 CORE_DB_NAME:', process.env.CORE_DB_NAME || 'gastro_core');
  console.log('========================================');

  app.use(new CorrelationIdMiddleware().use);
  app.useGlobalPipes(new ValidationPipe({ whitelist: false, transform: true }));

  // Global prefix for API versioning (aligns with Mobile /api/v1 prefix)
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  // Static assets for uploaded files
  app.useStaticAssets(join(__dirname, '..', '..', '..', 'uploads'), {
    prefix: '/uploads/',
  });

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
  console.log(`🚀 GastroWise Core Service is listening on 0.0.0.0:${port}`);
}

bootstrap();
