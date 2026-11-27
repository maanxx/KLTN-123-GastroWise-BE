import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ItinerariesModule } from './itineraries/itineraries.module';
import { HealthModule } from './health/health.module';
import { AclModule } from './acl/acl.module';
import { AuthModule } from './auth/auth.module';
import { resolveServiceMongoUri } from '@shared/database/mongo-uri.util';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const { uri, dbName } = resolveServiceMongoUri(configService, {
          uriEnvKeys: ['PLANNING_MONGODB_URI', 'MONGODB_URI_PLANNING'],
          userEnvKey: 'PLANNING_DB_USER',
          passwordEnvKey: 'PLANNING_DB_PASSWORD',
          dbNameEnvKey: 'PLANNING_DB_NAME',
          defaultDbName: 'gastro_planning',
        });
        return {
          uri,
          dbName,
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
