import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  console.log('========================================');
  console.log('🔍 DEBUG ENV VARIABLES:');
  console.log('👉 PORT:', process.env.PORT);
  console.log('👉 AI_SERVICE_URL:', process.env.AI_SERVICE_URL);
  console.log('👉 FRONTEND_URL:', process.env.FRONTEND_URL);
  console.log('👉 ALLOWED_ORIGINS:', process.env.ALLOWED_ORIGINS);
  console.log('========================================');
  app.useGlobalPipes(new ValidationPipe());

  // Phục vụ các file tĩnh trong thư mục uploads
  app.useStaticAssets(join(__dirname, '..', 'uploads'), {
    prefix: '/uploads/',
  });

  // [TASK-SEC-02] CORS Whitelist Configuration
  const defaultAllowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:8081',
    'http://localhost:19006',
    process.env.FRONTEND_URL,
  ].filter(Boolean) as string[];

  const customAllowed = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : [];

  const allowedOrigins = Array.from(new Set([...defaultAllowedOrigins, ...customAllowed]));

  app.enableCors({
    origin: (origin, callback) => {
      // Cho phép requests không có header origin (mobile apps native, Postman, server-to-server)
      if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by GastroWise CORS policy`));
      }
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3001, '0.0.0.0');
  console.log(`🚀 NestJS Backend is listening on 0.0.0.0:${process.env.PORT ?? 3001}`);
}
bootstrap();
