import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ItinerariesModule } from './itineraries/itineraries.module';
import { HealthModule } from './health/health.module';
import { AclModule } from './acl/acl.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const uri =
          configService.get<string>('MONGODB_URI_PLANNING') ||
          configService.get<string>('MONGODB_URI');
        if (!uri) {
          throw new Error(
            'MONGODB_URI_PLANNING or MONGODB_URI environment variable is required',
          );
        }
        return {
          uri,
          dbName:
            configService.get<string>('PLANNING_DB_NAME') || 'gastro_planning',
          serverSelectionTimeoutMS: 5000,
        };
      },
      inject: [ConfigService],
    }),
    AuthModule,
    AclModule,
    ItinerariesModule,
    HealthModule,
  ],
})
export class AppModule {}
